import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"
import {
  requireControlledBuildOutputs,
  sha256,
  stageControlledBuildPackage,
} from "./occt-build-artifacts"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"
import { assertSuccessfulOcctProcess } from "./occt-process"

type ControlledOutput = {
  bytes: number
  file: string
  sha256: string
}

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const artifactRoot = join(repositoryRoot, ".artifacts", "occt-build")
const inputDirectory = join(artifactRoot, "input")
const packageDirectory = join(artifactRoot, "package")
const builderContextDirectory = join(artifactRoot, "builder-context")
const registryBaselineDirectory = join(artifactRoot, "registry-baseline")
const buildConfigPath = join(inputDirectory, `${OCCT_BUILD_INPUTS.outputBaseName}.yml`)
const revisionSuffix = OCCT_BUILD_INPUTS.sources.opencascadeJs.revision.slice(0, 12)
const unpatchedImage = `vibeshape/occt-builder:unpatched-${revisionSuffix}`
const patchedImage = `vibeshape/occt-builder:patched-${revisionSuffix}`
const dockerCommand = process.env.VIBESHAPE_DOCKER_BIN || "docker"

function runDocker(arguments_: string[]) {
  const result = spawnSync(dockerCommand, arguments_, { stdio: "inherit" })
  assertSuccessfulOcctProcess(result, "Docker")
}

function buildBuilderImage(target: "unpatched-builder" | "patched-builder", image: string) {
  runDocker([
    "build",
    "--platform",
    OCCT_BUILD_INPUTS.platform,
    "--target",
    target,
    "--tag",
    image,
    builderContextDirectory,
  ])
}

function createDockerUserArguments() {
  const getUserId = process.getuid
  const getGroupId = process.getgid

  if (!getUserId || !getGroupId) {
    return []
  }

  return ["--user", `${getUserId()}:${getGroupId()}`]
}

function clearControlledOutputs() {
  for (const extension of ["js", "wasm", "d.ts"]) {
    rmSync(join(inputDirectory, `${OCCT_BUILD_INPUTS.outputBaseName}.${extension}`), {
      force: true,
    })
  }
}

function runControlledBuild(image: string) {
  clearControlledOutputs()
  runDocker([
    "run",
    "--rm",
    "--platform",
    OCCT_BUILD_INPUTS.platform,
    "--volume",
    `${inputDirectory}:/src`,
    ...createDockerUserArguments(),
    image,
    basename(buildConfigPath),
  ])

  return requireControlledBuildOutputs(inputDirectory, OCCT_BUILD_INPUTS.outputBaseName)
}

function indexControlledOutputs(outputs: ControlledOutput[]) {
  return new Map(outputs.map((output) => [output.file, output]))
}

export function assertRegistryBaseline(
  registryOutputs: ControlledOutput[],
  sourceOutputs: ControlledOutput[],
) {
  const registry = indexControlledOutputs(registryOutputs)

  for (const output of sourceOutputs) {
    const baseline = registry.get(output.file)

    if (!baseline || baseline.bytes !== output.bytes) {
      throw new Error(
        `Source-built unpatched ${output.file} does not match the registry output contract.`,
      )
    }

    if (
      output.file !== `${OCCT_BUILD_INPUTS.outputBaseName}.wasm` &&
      baseline.sha256 !== output.sha256
    ) {
      throw new Error(
        `Source-built unpatched ${output.file} does not match the registry output contract.`,
      )
    }
  }

  if (sourceOutputs.length !== registryOutputs.length) {
    throw new Error("Source-built unpatched output count does not match the registry contract.")
  }
}

export function createWasmInterfaceFingerprint(path: string) {
  const module = new WebAssembly.Module(readFileSync(path))
  const normalize = <T extends { kind: string; module?: string; name: string }>(entries: T[]) =>
    entries
      .map(({ kind, module: moduleName, name }) => ({ kind, module: moduleName, name }))
      .sort((left, right) =>
        `${left.module ?? ""}:${left.name}:${left.kind}`.localeCompare(
          `${right.module ?? ""}:${right.name}:${right.kind}`,
        ),
      )

  return {
    imports: normalize(WebAssembly.Module.imports(module)),
    exports: normalize(WebAssembly.Module.exports(module)),
  }
}

function preserveControlledOutputs(outputFiles: string[]) {
  rmSync(registryBaselineDirectory, { force: true, recursive: true })
  mkdirSync(registryBaselineDirectory, { recursive: true })

  for (const outputFile of outputFiles) {
    copyFileSync(outputFile, join(registryBaselineDirectory, basename(outputFile)))
  }
}

function requireEquivalentWasmInterfaces() {
  const wasmFile = `${OCCT_BUILD_INPUTS.outputBaseName}.wasm`
  const registry = createWasmInterfaceFingerprint(join(registryBaselineDirectory, wasmFile))
  const source = createWasmInterfaceFingerprint(join(inputDirectory, wasmFile))

  if (!isDeepStrictEqual(source, registry)) {
    throw new Error("Source-built unpatched WASM interface does not match the registry baseline.")
  }

  return source
}

function inspectImageId(image: string) {
  const result = spawnSync(dockerCommand, ["image", "inspect", "--format", "{{.Id}}", image], {
    encoding: "utf8",
  })

  if (result.error || result.status !== 0) {
    throw new Error(`Failed to inspect source-built image ${image}.`)
  }

  const imageId = result.stdout.trim()

  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
    throw new Error(`Source-built image ${image} returned an invalid image ID.`)
  }

  return imageId
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createReportInputs() {
  return {
    ...OCCT_BUILD_INPUTS,
    generatedConfig: {
      file: basename(buildConfigPath),
      sha256: sha256(buildConfigPath),
    },
    sourceBuilderContext: {
      file: "builder-context/manifest.json",
      sha256: sha256(join(builderContextDirectory, "manifest.json")),
      manifest: JSON.parse(readFileSync(join(builderContextDirectory, "manifest.json"), "utf8")),
    },
  }
}

function indexOutputs(outputs: ControlledOutput[]) {
  return Object.fromEntries(
    outputs.map((output) => [output.file, { bytes: output.bytes, sha256: output.sha256 }]),
  )
}

function main() {
  buildBuilderImage("unpatched-builder", unpatchedImage)
  const unpatchedImageId = inspectImageId(unpatchedImage)
  const registry = runControlledBuild(OCCT_BUILD_INPUTS.builderImage)
  preserveControlledOutputs(registry.outputFiles)
  const unpatched = runControlledBuild(unpatchedImage)
  assertRegistryBaseline(registry.outputs, unpatched.outputs)
  const wasmInterface = requireEquivalentWasmInterfaces()
  writeJson(join(artifactRoot, "source-builder-baseline-report.json"), {
    schemaVersion: 1,
    inputs: createReportInputs(),
    builder: { image: unpatchedImage, imageId: unpatchedImageId, patched: false },
    matchesRegistryOutputContract: true,
    comparison: {
      byteExactReproductionRequired: false,
      rationale:
        "The pinned upstream builder is not bit-reproducible across identical runs; output dimensions and runtime contracts are stable.",
      registryOutputs: indexOutputs(registry.outputs),
      exactJavaScriptAndDeclarations: true,
      exactOutputDimensions: true,
      wasmInterface,
    },
    outputs: indexOutputs(unpatched.outputs),
  })

  buildBuilderImage("patched-builder", patchedImage)
  const patchedImageId = inspectImageId(patchedImage)
  const patched = runControlledBuild(patchedImage)
  writeJson(join(artifactRoot, "build-report.json"), {
    schemaVersion: 2,
    inputs: createReportInputs(),
    builder: { image: patchedImage, imageId: patchedImageId, patched: true },
    registryBaseline: {
      image: OCCT_BUILD_INPUTS.builderImage,
      reproducedByUnpatchedSourceBuilder: "output-contract",
      outputs: indexOutputs(registry.outputs),
      wasmInterface,
    },
    outputs: indexOutputs(patched.outputs),
  })
  stageControlledBuildPackage(
    patched.outputFiles,
    packageDirectory,
    OCCT_BUILD_INPUTS.sources.occt.revision,
  )
}

if (import.meta.main) {
  try {
    main()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Unknown OCCT source-builder failure.")
    process.exitCode = 1
  }
}
