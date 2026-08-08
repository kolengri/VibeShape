import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { assertLocalSolveSpaceBuild, SOLVESPACE_BUILD_INPUTS } from "./solvespace-build-config"

const repositoryRoot = resolve(import.meta.dir, "..")
const artifactRoot = join(repositoryRoot, ".artifacts", "solvespace-build")
const sourceDirectory = join(artifactRoot, "sources")
const contextDirectory = join(artifactRoot, "builder-context")
const outputDirectory = join(artifactRoot, "output")
const dockerCommand = process.env.VIBESHAPE_DOCKER_BIN || "docker"

export function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function assertChecksum(path: string, expected: string, url: string) {
  const actual = sha256(path)

  if (actual !== expected) {
    rmSync(path, { force: true })
    throw new Error(`Checksum mismatch for ${url}: expected ${expected}, received ${actual}.`)
  }
}

async function downloadVerifiedSource(source: { sha256: string; url: string }) {
  const destination = join(sourceDirectory, basename(new URL(source.url).pathname))

  if (existsSync(destination) && sha256(destination) === source.sha256) {
    return destination
  }

  const response = await fetch(source.url, { redirect: "follow" })
  if (!response.ok) {
    throw new Error(`Failed to download ${source.url}: HTTP ${response.status}.`)
  }

  const temporaryPath = `${destination}.partial`
  writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()))
  assertChecksum(temporaryPath, source.sha256, source.url)
  rmSync(destination, { force: true })
  renameSync(temporaryPath, destination)
  return destination
}

function prepareBuilderContext(sourceArchives: Record<string, string>) {
  rmSync(contextDirectory, { force: true, recursive: true })
  mkdirSync(join(contextDirectory, "native"), { recursive: true })
  mkdirSync(join(contextDirectory, "patches"), { recursive: true })
  mkdirSync(join(contextDirectory, "sources"), { recursive: true })

  copyFileSync(
    join(repositoryRoot, "native", "solvespace", "build.sh"),
    join(contextDirectory, "build.sh"),
  )
  copyFileSync(
    join(repositoryRoot, "native", "solvespace", "vibeshape_solver_abi.cpp"),
    join(contextDirectory, "native", "vibeshape_solver_abi.cpp"),
  )
  copyFileSync(
    join(repositoryRoot, "native", "solvespace", "solvespace-v3.2-vibeshape.patch"),
    join(contextDirectory, "patches", "solvespace-v3.2-vibeshape.patch"),
  )

  for (const [name, path] of Object.entries(sourceArchives)) {
    copyFileSync(path, join(contextDirectory, "sources", `${name}.tar.gz`))
  }
}

function requireDocker() {
  const result = spawnSync(dockerCommand, ["--version"], { encoding: "utf8" })
  if (result.error || result.status !== 0) {
    throw new Error(
      "Docker is required only for --build. The verified source context was prepared successfully.",
    )
  }
}

function invokeBuild() {
  requireDocker()
  rmSync(outputDirectory, { force: true, recursive: true })
  mkdirSync(outputDirectory, { recursive: true })

  const result = spawnSync(
    dockerCommand,
    [
      "run",
      "--rm",
      "--platform",
      SOLVESPACE_BUILD_INPUTS.platform,
      "--volume",
      `${contextDirectory}:/input:ro`,
      "--volume",
      `${outputDirectory}:/output`,
      SOLVESPACE_BUILD_INPUTS.builderImage,
      "bash",
      "/input/build.sh",
    ],
    { stdio: "inherit" },
  )

  if (result.error) {
    throw new Error(`SolveSpace build failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`SolveSpace build failed with exit code ${result.status ?? "unknown"}.`)
  }
}

function inspectOutput(file: string) {
  const path = join(outputDirectory, file)
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`SolveSpace build did not produce ${file}.`)
  }
  return { bytes: statSync(path).size, file, sha256: sha256(path) }
}

async function validateWasm() {
  const wasmPath = join(outputDirectory, SOLVESPACE_BUILD_INPUTS.outputWasm)
  await WebAssembly.compile(readFileSync(wasmPath))
  const moduleSource = readFileSync(
    join(outputDirectory, SOLVESPACE_BUILD_INPUTS.outputModule),
    "utf8",
  )
  if (!moduleSource.includes("createVibeShapeSketchSolver")) {
    throw new Error("SolveSpace JavaScript output does not expose the expected module factory.")
  }
}

async function writeBuildReport() {
  await validateWasm()
  const outputs = [
    inspectOutput(SOLVESPACE_BUILD_INPUTS.outputModule),
    inspectOutput(SOLVESPACE_BUILD_INPUTS.outputWasm),
  ]
  const patchPath = join(repositoryRoot, "native", "solvespace", "solvespace-v3.2-vibeshape.patch")
  const wrapperPath = join(repositoryRoot, "native", "solvespace", "vibeshape_solver_abi.cpp")
  const report = {
    schemaVersion: 1,
    inputs: SOLVESPACE_BUILD_INPUTS,
    modifications: {
      patchSha256: sha256(patchPath),
      wrapperSha256: sha256(wrapperPath),
    },
    outputs: Object.fromEntries(
      outputs.map((output) => [output.file, { bytes: output.bytes, sha256: output.sha256 }]),
    ),
  }
  writeFileSync(join(artifactRoot, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  assertLocalSolveSpaceBuild()
  mkdirSync(sourceDirectory, { recursive: true })

  const downloads = {
    eigen: downloadVerifiedSource(SOLVESPACE_BUILD_INPUTS.sources.eigen),
    mimalloc: downloadVerifiedSource(SOLVESPACE_BUILD_INPUTS.sources.mimalloc),
    solvespace: downloadVerifiedSource(SOLVESPACE_BUILD_INPUTS.sources.solvespace),
  }
  await Promise.all(Object.values(downloads))
  prepareBuilderContext({
    eigen: await downloads.eigen,
    mimalloc: await downloads.mimalloc,
    solvespace: await downloads.solvespace,
  })

  if (process.argv.includes("--build")) {
    invokeBuild()
    await writeBuildReport()
  }

  console.log(`Controlled local SolveSpace inputs prepared under ${artifactRoot}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown SolveSpace build failure.")
  process.exitCode = 1
})
