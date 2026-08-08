import { spawnSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  requireControlledBuildOutputs,
  sha256,
  stageControlledBuildPackage,
} from "./occt-build-artifacts"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"

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
const buildConfigPath = join(inputDirectory, `${OCCT_BUILD_INPUTS.outputBaseName}.yml`)
const revisionSuffix = OCCT_BUILD_INPUTS.sources.opencascadeJs.revision.slice(0, 12)
const unpatchedImage = `vibeshape/occt-builder:unpatched-${revisionSuffix}`
const patchedImage = `vibeshape/occt-builder:patched-${revisionSuffix}`

function runDocker(arguments_: string[]) {
  const result = spawnSync("docker", arguments_, { stdio: "inherit" })

  if (result.error) {
    throw new Error(`Docker failed to start: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(`Docker exited with status ${String(result.status)}.`)
  }
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

export function assertRegistryBaseline(outputs: ControlledOutput[]) {
  const expected = OCCT_BUILD_INPUTS.sourceBuilder.registryBaselineOutputs

  for (const output of outputs) {
    const baseline = expected[output.file as keyof typeof expected]

    if (!baseline || baseline.bytes !== output.bytes || baseline.sha256 !== output.sha256) {
      throw new Error(`Source-built unpatched ${output.file} does not match the registry baseline.`)
    }
  }

  if (outputs.length !== Object.keys(expected).length) {
    throw new Error("Source-built unpatched output count does not match the registry baseline.")
  }
}

function inspectImageId(image: string) {
  const result = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], {
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
  const unpatched = runControlledBuild(unpatchedImage)
  assertRegistryBaseline(unpatched.outputs)
  writeJson(join(artifactRoot, "source-builder-baseline-report.json"), {
    schemaVersion: 1,
    inputs: createReportInputs(),
    builder: { image: unpatchedImage, imageId: unpatchedImageId, patched: false },
    matchesRegistryBaseline: true,
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
      reproducedByUnpatchedSourceBuilder: true,
      outputs: OCCT_BUILD_INPUTS.sourceBuilder.registryBaselineOutputs,
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
