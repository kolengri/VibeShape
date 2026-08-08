import { type SpawnSyncReturns, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { writeThreeMf } from "../packages/formats/src/three-mf"
import { createThreeMfInteroperabilityDocument } from "../packages/test-models/src"
import {
  assertIndependentConsumers,
  assertLocalThreeMfEnvironment,
  consumerExecutableName,
  readConsumerGeometry,
  readConsumerOutput,
  resolveThreeMfConsumers,
  sha256,
  type ThreeMfConsumer,
  threeMfConsumerResultSchema,
  threeMfEvidenceReportSchema,
} from "./three-mf-evidence"

const REQUIRED_ENTRIES = [
  "3D/3dmodel.model",
  "Metadata/thumbnail.png",
  "[Content_Types].xml",
  "_rels/.rels",
] as const

function assertArchiveEntries(files: Record<string, Uint8Array>) {
  const entries = Object.keys(files).sort()
  if (entries.length !== REQUIRED_ENTRIES.length) {
    throw new Error(`Unexpected 3MF archive entries: ${entries.join(", ")}.`)
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!files[required]) throw new Error(`3MF archive is missing ${required}.`)
  }
  return entries
}

function isXmlPart(name: string) {
  return [".xml", ".rels", ".model"].some((extension) => name.endsWith(extension))
}

function assertSafeXml(name: string, xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(`${name} contains a forbidden DTD or entity declaration.`)
  }
}

function assertWellFormedXml(name: string, outputPath: string) {
  const result = spawnSync("/usr/bin/xmllint", ["--noout", outputPath], {
    encoding: "utf8",
    timeout: 30_000,
  })
  if (result.status === 0) return
  throw new Error(
    `xmllint rejected ${name}: status=${String(result.status)}, error=${String(result.error)}, stderr=${result.stderr}`,
  )
}

function validateXmlPart(name: string, bytes: Uint8Array, extractionDirectory: string) {
  const xml = strFromU8(bytes)
  assertSafeXml(name, xml)
  const outputPath = resolve(extractionDirectory, name.replaceAll("/", "__"))
  writeFileSync(outputPath, xml)
  assertWellFormedXml(name, outputPath)
}

function validateXmlParts(files: Record<string, Uint8Array>, extractionDirectory: string) {
  const parts = Object.entries(files).filter(([name]) => isXmlPart(name))
  for (const [name, bytes] of parts) validateXmlPart(name, bytes, extractionDirectory)
  return parts.length
}

function consumerArguments(consumer: ThreeMfConsumer, artifactPath: string, workDirectory: string) {
  const argumentsList = consumer.supportsDataDirectory ? ["--datadir", workDirectory] : []
  if (consumer.family === "orca") {
    argumentsList.push("--normative-check", "--outputdir", workDirectory)
  }
  argumentsList.push("--info", artifactPath)
  return argumentsList
}

function consumerOutput(result: SpawnSyncReturns<string>, generatedResult: string) {
  return [result.stdout, result.stderr, generatedResult]
    .filter((value) => value.length > 0)
    .join("\n")
}

function assertSuccessfulConsumer(consumer: ThreeMfConsumer, result: SpawnSyncReturns<string>) {
  if (result.status === 0) return
  throw new Error(
    `${consumer.name} rejected the 3MF fixture: status=${String(result.status)}, signal=${String(result.signal)}, error=${String(result.error)}.`,
  )
}

function runConsumer(consumer: ThreeMfConsumer, artifactPath: string, workDirectory: string) {
  mkdirSync(workDirectory, { recursive: true })
  const result = spawnSync(
    consumer.command,
    consumerArguments(consumer, artifactPath, workDirectory),
    {
      cwd: workDirectory,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    },
  )
  const generatedResult = readConsumerOutput(resolve(workDirectory, "result.json"))
  const output = consumerOutput(result, generatedResult)
  writeFileSync(resolve(workDirectory, "consumer-output.log"), output)
  assertSuccessfulConsumer(consumer, result)
  const geometry = readConsumerGeometry(output)
  return threeMfConsumerResultSchema.parse({
    name: consumer.name,
    family: consumer.family,
    executable: consumerExecutableName(consumer),
    exitStatus: 0,
    ...geometry,
    outputSha256: sha256(output),
  })
}

function runBrowserProducer(repositoryRoot: string) {
  const bunCommand = process.env.VIBESHAPE_BUN_BIN || "bun"
  const result = spawnSync(
    bunCommand,
    ["x", "playwright", "test", "--config", "playwright.formats.config.ts"],
    { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
  )
  if (result.status === 0) return
  throw new Error(`Browser 3MF producer failed with status ${String(result.status)}.`)
}

export function runThreeMfEvidence() {
  assertLocalThreeMfEnvironment(process.env)
  const repositoryRoot = resolve(import.meta.dir, "..")
  const artifactDirectory = resolve(repositoryRoot, ".artifacts/3mf-spike")
  const extractionDirectory = resolve(artifactDirectory, "xml")
  const artifactPath = resolve(artifactDirectory, "vibeshape-interoperability.3mf")
  const consumers = resolveThreeMfConsumers(process.env)
  assertIndependentConsumers(consumers)

  rmSync(artifactDirectory, { force: true, recursive: true })
  runBrowserProducer(repositoryRoot)
  mkdirSync(extractionDirectory, { recursive: true })
  const document = createThreeMfInteroperabilityDocument()
  const first = writeThreeMf(document)
  const second = writeThreeMf(document)
  if (!Buffer.from(first.bytes).equals(Buffer.from(second.bytes))) {
    throw new Error("3MF writer output is not byte-identical for identical input.")
  }
  const browserBytes = readFileSync(artifactPath)
  if (!Buffer.from(first.bytes).equals(browserBytes)) {
    throw new Error("Browser and Bun 3MF output differ for identical semantic input.")
  }

  const files = unzipSync(browserBytes)
  const entries = assertArchiveEntries(files)
  const xmlPartsChecked = validateXmlParts(files, extractionDirectory)
  const consumerResults = consumers.map((consumer) =>
    runConsumer(
      consumer,
      artifactPath,
      resolve(artifactDirectory, "consumers", consumer.name.replaceAll(" ", "-")),
    ),
  )
  const report = threeMfEvidenceReportSchema.parse({
    schemaVersion: 1,
    artifact: {
      fileName: "vibeshape-interoperability.3mf",
      byteLength: browserBytes.byteLength,
      sha256: sha256(browserBytes),
    },
    archive: { entries, xmlPartsChecked },
    writer: {
      objectCount: first.report.objectCount,
      meshObjectCount: first.report.meshObjectCount,
      componentObjectCount: first.report.componentObjectCount,
      buildItemCount: first.report.buildItemCount,
      vertexCount: first.report.vertexCount,
      triangleCount: first.report.triangleCount,
      hasThumbnail: first.report.hasThumbnail,
    },
    consumers: consumerResults,
    independentConsumerFamilies: new Set(consumerResults.map((consumer) => consumer.family)).size,
  })
  writeFileSync(
    resolve(artifactDirectory, "evidence-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    `3MF evidence passed with ${report.consumers.map((consumer) => consumer.name).join(" and ")}.`,
  )
}

if (import.meta.main) {
  try {
    runThreeMfEvidence()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown 3MF evidence failure.")
    process.exitCode = 1
  }
}
