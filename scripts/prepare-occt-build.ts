import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import {
  requireControlledBuildOutputs,
  sha256,
  stageControlledBuildPackage,
} from "./occt-build-artifacts"
import { instrumentReplicadBuildConfig, OCCT_BUILD_INPUTS } from "./occt-build-config"
import { prepareOcctBuilderContext } from "./occt-builder-context"
import { assertSuccessfulOcctProcess } from "./occt-process"

const repositoryRoot = resolve(import.meta.dir, "..")
const artifactRoot = join(repositoryRoot, ".artifacts", "occt-build")
const sourceDirectory = join(artifactRoot, "sources")
const inputDirectory = join(artifactRoot, "input")
const packageDirectory = join(artifactRoot, "package")
const builderContextDirectory = join(artifactRoot, "builder-context")
const buildConfigPath = join(inputDirectory, `${OCCT_BUILD_INPUTS.outputBaseName}.yml`)
const builderDockerfilePath = join(repositoryRoot, "native", "occt", "Dockerfile.builder")
const configuredGeneratorPath = join(
  repositoryRoot,
  "native",
  "occt",
  "generate-configured-bindings.py",
)
const dockerCommand = process.env.VIBESHAPE_DOCKER_BIN || "docker"

function assertSourceChecksum(path: string, expected: string, url: string) {
  const digest = sha256(path)

  if (digest !== expected) {
    rmSync(path, { force: true })
    throw new Error(
      `Source checksum mismatch for ${url}: expected ${expected}, received ${digest}.`,
    )
  }
}

async function downloadSource(url: string, destination: string) {
  const response = await fetch(url, { redirect: "follow" })

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}.`)
  }

  writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
}

async function downloadVerifiedSource(source: { revision: string; sha256: string; url: string }) {
  const destination = join(sourceDirectory, basename(new URL(source.url).pathname))

  if (existsSync(destination) && sha256(destination) === source.sha256) {
    return destination
  }

  const temporaryPath = `${destination}.partial`
  await downloadSource(source.url, temporaryPath)
  assertSourceChecksum(temporaryPath, source.sha256, source.url)

  rmSync(destination, { force: true })
  renameSync(temporaryPath, destination)
  return destination
}

function readReplicadBuildConfig(archivePath: string) {
  const revision = OCCT_BUILD_INPUTS.sources.replicad.revision
  const entry = `replicad-${revision}/packages/replicad-opencascadejs/build-config/custom_build_single.yml`
  const result = spawnSync("tar", ["-xOf", archivePath, entry], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })

  if (result.error) {
    throw new Error(`Failed to read the pinned Replicad build config: ${result.error.message}`)
  }

  if (result.status !== 0 || result.stdout.length === 0) {
    throw new Error(`Failed to read the pinned Replicad build config: ${result.stderr.trim()}`)
  }

  return result.stdout
}

function requireDocker() {
  const result = spawnSync(dockerCommand, ["--version"], { encoding: "utf8" })

  if (result.error || result.status !== 0) {
    throw new Error(
      "Docker is required only for --build. Source preparation completed successfully.",
    )
  }
}

function createDockerUserArguments() {
  const getUserId = process.getuid
  const getGroupId = process.getgid

  if (!getUserId || !getGroupId) {
    return []
  }

  return ["--user", `${getUserId()}:${getGroupId()}`]
}

function invokeControlledBuild() {
  const result = spawnSync(
    dockerCommand,
    [
      "run",
      "--rm",
      "--platform",
      OCCT_BUILD_INPUTS.platform,
      "--volume",
      `${inputDirectory}:/src`,
      ...createDockerUserArguments(),
      OCCT_BUILD_INPUTS.builderImage,
      basename(buildConfigPath),
    ],
    { stdio: "inherit" },
  )

  assertSuccessfulOcctProcess(result, "Controlled OCCT build")
}

function writeBuildReport(outputs: Array<{ bytes: number; file: string; sha256: string }>) {
  const report = {
    schemaVersion: 1,
    inputs: {
      ...OCCT_BUILD_INPUTS,
      generatedConfig: {
        file: basename(buildConfigPath),
        sha256: sha256(buildConfigPath),
      },
    },
    outputs: Object.fromEntries(
      outputs.map((output) => [output.file, { bytes: output.bytes, sha256: output.sha256 }]),
    ),
  }
  writeFileSync(join(artifactRoot, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`)
}

function runBuild() {
  requireDocker()
  invokeControlledBuild()
  const { outputFiles, outputs } = requireControlledBuildOutputs(
    inputDirectory,
    OCCT_BUILD_INPUTS.outputBaseName,
  )
  writeBuildReport(outputs)
  stageControlledBuildPackage(
    outputFiles,
    packageDirectory,
    OCCT_BUILD_INPUTS.sources.occt.revision,
  )
}

async function main() {
  mkdirSync(sourceDirectory, { recursive: true })
  mkdirSync(inputDirectory, { recursive: true })

  const sourceDownloads = {
    freetype: downloadVerifiedSource(OCCT_BUILD_INPUTS.sources.freetype),
    opencascadeJs: downloadVerifiedSource(OCCT_BUILD_INPUTS.sources.opencascadeJs),
    occt: downloadVerifiedSource(OCCT_BUILD_INPUTS.sources.occt),
    rapidjson: downloadVerifiedSource(OCCT_BUILD_INPUTS.sources.rapidjson),
    replicad: downloadVerifiedSource(OCCT_BUILD_INPUTS.sources.replicad),
  }
  await Promise.all(Object.values(sourceDownloads))
  const replicadArchive = await sourceDownloads.replicad
  const upstreamConfig = readReplicadBuildConfig(replicadArchive)
  writeFileSync(buildConfigPath, instrumentReplicadBuildConfig(upstreamConfig))
  prepareOcctBuilderContext({
    buildConfigPath,
    configuredGeneratorPath,
    contextDirectory: builderContextDirectory,
    dockerfilePath: builderDockerfilePath,
    sourceArchives: {
      freetype: await sourceDownloads.freetype,
      occt: await sourceDownloads.occt,
      opencascadeJs: await sourceDownloads.opencascadeJs,
      rapidjson: await sourceDownloads.rapidjson,
    },
  })

  if (process.argv.includes("--build")) {
    runBuild()
  }

  console.log(`Controlled OCCT inputs prepared under ${artifactRoot}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown OCCT build preparation failure.")
  process.exitCode = 1
})
