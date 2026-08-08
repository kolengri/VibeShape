import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"
import { requireControlledBuildOutputs, sha256 } from "./occt-build-artifacts"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"
import { assertSuccessfulOcctProcess } from "./occt-process"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const safeRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Expected a normalized relative bundle path.",
  )

const bundleFileSchema = z.strictObject({
  path: safeRelativePathSchema,
  bytes: z.number().int().nonnegative(),
  sha256: digestSchema,
})

const sourceSchema = z.strictObject({
  path: safeRelativePathSchema,
  revision: z.string().min(1),
  sha256: digestSchema,
  url: z.url(),
})

export const occtComplianceManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    bundle: z.strictObject({
      name: z.string().min(1),
      purpose: z.literal("VibeShape controlled OCCT corresponding-source bundle"),
      opencascadeRevision: z.string().length(40),
      opencascadeJsRevision: z.string().length(40),
    }),
    toolchain: z.strictObject({
      platform: z.string().min(1),
      emscriptenImage: z.string().min(1),
      pythonPackages: z.array(z.string().min(1)).min(1),
    }),
    sources: z.strictObject({
      freetype: sourceSchema,
      occt: sourceSchema,
      opencascadeJs: sourceSchema,
      rapidjson: sourceSchema,
      replicad: sourceSchema,
    }),
    modifications: z
      .array(
        z.strictObject({
          path: safeRelativePathSchema,
          sha256: digestSchema,
        }),
      )
      .min(1),
    files: z.array(bundleFileSchema).min(1),
  })
  .superRefine((manifest, context) => {
    const paths = manifest.files.map((file) => file.path)

    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: "custom", message: "Bundle manifest paths must be unique." })
    }
  })

type OcctComplianceManifest = z.infer<typeof occtComplianceManifestSchema>

const sourceBundlePaths = {
  freetype: "build/context/sources/freetype.tar.gz",
  occt: "build/context/sources/occt.tar.gz",
  opencascadeJs: "build/context/sources/opencascade-js.tar.gz",
  rapidjson: "build/context/sources/rapidjson.tar.gz",
  replicad: "build/context/sources/replicad.tar.gz",
} as const

const modificationPaths = [
  "build/context/patches/0001-preserve-public-ordinary-delete.patch",
  "build/context/patches/bindings.py",
  "build/context/config/configured-bindings.txt",
  "build/context/scripts/generate-configured-bindings.py",
  "build/input/vibeshape_occt.yml",
] as const

const requiredCompliancePayloadPaths = [
  "README.md",
  "REPLACEMENT.md",
  "THIRD_PARTY_NOTICES.md",
  "artifacts/vibeshape_occt.d.ts",
  "artifacts/vibeshape_occt.js",
  "artifacts/vibeshape_occt.wasm",
  "build/context/Dockerfile",
  "build/context/config/configured-bindings.txt",
  "build/context/patches/0001-preserve-public-ordinary-delete.patch",
  "build/context/patches/bindings.py",
  "build/context/scripts/generate-configured-bindings.py",
  "build/context/sources/freetype.tar.gz",
  "build/context/sources/occt.tar.gz",
  "build/context/sources/opencascade-js.tar.gz",
  "build/context/sources/rapidjson.tar.gz",
  "build/context/sources/replicad.tar.gz",
  "build/input/vibeshape_occt.yml",
  "build/vibeshape-scripts/build-occt-source-builder.ts",
  "build/vibeshape-scripts/occt-build-artifacts.ts",
  "build/vibeshape-scripts/occt-build-config.ts",
  "build/vibeshape-scripts/occt-builder-context.ts",
  "build/vibeshape-scripts/occt-process.ts",
  "build/vibeshape-scripts/prepare-occt-build.ts",
  "evidence/build-report.json",
  "evidence/builder-context-manifest.json",
  "evidence/source-builder-baseline-report.json",
  "licenses/FreeType-FTL.txt",
  "licenses/FreeType-LICENSE.txt",
  "licenses/OCCT-LGPL-2.1.txt",
  "licenses/OCCT-LGPL-EXCEPTION.txt",
  "licenses/OpenCascade.js-LGPL-2.1.txt",
  "licenses/RapidJSON.txt",
  "licenses/Replicad-OpenCascade.js-MIT.txt",
  "licenses/VibeShape-GPL-3.0-or-later.txt",
  "package/package.json",
  "package/src/replicad_single.d.ts",
  "package/src/replicad_single.js",
  "package/src/replicad_single.wasm",
] as const

const licenseEntries = {
  freetypeOverview: {
    source: "freetype",
    entry: `freetype-${OCCT_BUILD_INPUTS.sources.freetype.revision}/LICENSE.TXT`,
    output: "licenses/FreeType-LICENSE.txt",
  },
  freetypeLicense: {
    source: "freetype",
    entry: `freetype-${OCCT_BUILD_INPUTS.sources.freetype.revision}/docs/FTL.TXT`,
    output: "licenses/FreeType-FTL.txt",
  },
  occtLgpl: {
    source: "occt",
    entry: `OCCT-${OCCT_BUILD_INPUTS.sources.occt.revision}/LICENSE_LGPL_21.txt`,
    output: "licenses/OCCT-LGPL-2.1.txt",
  },
  occtException: {
    source: "occt",
    entry: `OCCT-${OCCT_BUILD_INPUTS.sources.occt.revision}/OCCT_LGPL_EXCEPTION.txt`,
    output: "licenses/OCCT-LGPL-EXCEPTION.txt",
  },
  opencascadeJs: {
    source: "opencascadeJs",
    entry: `opencascade.js-${OCCT_BUILD_INPUTS.sources.opencascadeJs.revision}/LICENSE`,
    output: "licenses/OpenCascade.js-LGPL-2.1.txt",
  },
  rapidjson: {
    source: "rapidjson",
    entry: "rapidjson-1.1.0/license.txt",
    output: "licenses/RapidJSON.txt",
  },
  replicad: {
    source: "replicad",
    entry: `replicad-${OCCT_BUILD_INPUTS.sources.replicad.revision}/packages/replicad-opencascadejs/LICENSE`,
    output: "licenses/Replicad-OpenCascade.js-MIT.txt",
  },
} as const

type SourceName = keyof typeof sourceBundlePaths

export const OCCT_COMPLIANCE_BUNDLE_NAME = `vibeshape-occt-compliance-${OCCT_BUILD_INPUTS.sources.occt.revision.slice(0, 12)}`

export function assertLocalOcctComplianceEnvironment(
  environment: Record<string, string | undefined>,
) {
  if (environment.CI) {
    throw new Error("OCCT compliance bundle generation is local-only and must not run in CI.")
  }
}

function normalizePath(path: string) {
  return path.split(sep).join("/")
}

function listFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)

    if (entry.isSymbolicLink()) {
      throw new Error(`Compliance bundles must not contain symbolic links: ${path}`)
    }

    if (entry.isDirectory()) {
      files.push(...listFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    } else {
      throw new Error(`Compliance bundles support only regular files and directories: ${path}`)
    }
  }

  return files.sort()
}

function createFileRecord(bundleDirectory: string, path: string) {
  return {
    path: normalizePath(relative(bundleDirectory, path)),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }
}

function writeText(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  chmodSync(path, 0o644)
}

function copyFile(source: string, destination: string) {
  if (!existsSync(source) || !lstatSync(source).isFile()) {
    throw new Error(`Required OCCT compliance input is missing: ${source}`)
  }

  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  chmodSync(destination, 0o644)
}

function readArchiveEntry(archivePath: string, entry: string) {
  const result = spawnSync("tar", ["-xOf", archivePath, entry], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })

  assertSuccessfulOcctProcess(result, `Archive extraction for ${entry}`)

  if (result.stdout.length === 0) {
    throw new Error(`Pinned source archive contains an empty license entry: ${entry}`)
  }

  return result.stdout
}

function verifyRecordedDestructorPatch(options: {
  correctedPath: string
  patchPath: string
  sourceArchivePath: string
}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vibeshape-occt-patch-"))
  const sourceDirectory = join(temporaryDirectory, "src")
  const sourcePath = join(sourceDirectory, "bindings.py")
  const sourceEntry = `opencascade.js-${OCCT_BUILD_INPUTS.sources.opencascadeJs.revision}/src/bindings.py`

  try {
    mkdirSync(sourceDirectory, { recursive: true })
    writeText(sourcePath, readArchiveEntry(options.sourceArchivePath, sourceEntry))
    const result = spawnSync("patch", ["-p1", "--batch", "--input", options.patchPath], {
      cwd: temporaryDirectory,
      encoding: "utf8",
    })
    assertSuccessfulOcctProcess(result, "Recorded OpenCascade.js patch application")

    if (sha256(sourcePath) !== sha256(options.correctedPath)) {
      throw new Error(
        "Recorded OpenCascade.js patch does not produce the controlled corrected file.",
      )
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

function sourceArchivePath(artifactRoot: string, sourceName: SourceName) {
  const source = OCCT_BUILD_INPUTS.sources[sourceName]
  return join(artifactRoot, "sources", basename(new URL(source.url).pathname))
}

function copyVerifiedSources(artifactRoot: string, bundleDirectory: string) {
  const manifestSources = {} as Record<SourceName, z.infer<typeof sourceSchema>>

  for (const sourceName of Object.keys(sourceBundlePaths) as SourceName[]) {
    const source = OCCT_BUILD_INPUTS.sources[sourceName]
    const inputPath = sourceArchivePath(artifactRoot, sourceName)

    if (!existsSync(inputPath) || sha256(inputPath) !== source.sha256) {
      throw new Error(`Pinned ${sourceName} source archive is missing or has the wrong digest.`)
    }

    const bundlePath = sourceBundlePaths[sourceName]
    copyFile(inputPath, join(bundleDirectory, bundlePath))
    manifestSources[sourceName] = { ...source, path: bundlePath }
  }

  return manifestSources
}

function writeLicenseTexts(artifactRoot: string, bundleDirectory: string) {
  for (const license of Object.values(licenseEntries)) {
    const archivePath = sourceArchivePath(artifactRoot, license.source)
    writeText(join(bundleDirectory, license.output), readArchiveEntry(archivePath, license.entry))
  }
}

function createNotices() {
  return `# Third-party notices for the controlled OCCT module

This bundle corresponds to VibeShape's controlled browser CAD kernel candidate. The notices summarize provenance; the complete applicable texts are under \`licenses/\`, and the exact corresponding source archives are under \`build/context/sources/\`.

| Component | Exact identity | License used for this bundle | Source |
|---|---|---|---|
| Open CASCADE Technology | \`${OCCT_BUILD_INPUTS.sources.occt.revision}\` | LGPL-2.1 with the OCCT exception | ${OCCT_BUILD_INPUTS.sources.occt.url} |
| OpenCascade.js | \`${OCCT_BUILD_INPUTS.sources.opencascadeJs.revision}\` plus the recorded VibeShape patch | LGPL-2.1 | ${OCCT_BUILD_INPUTS.sources.opencascadeJs.url} |
| Replicad OpenCascade.js build configuration | \`${OCCT_BUILD_INPUTS.sources.replicad.revision}\` | MIT | ${OCCT_BUILD_INPUTS.sources.replicad.url} |
| RapidJSON | \`${OCCT_BUILD_INPUTS.sources.rapidjson.revision}\` | MIT for the library; the bundled source license records auxiliary third-party material | ${OCCT_BUILD_INPUTS.sources.rapidjson.url} |
| FreeType | \`${OCCT_BUILD_INPUTS.sources.freetype.revision}\` | FreeType License | ${OCCT_BUILD_INPUTS.sources.freetype.url} |

This software is based in part on the work of the FreeType Team.

VibeShape modifies the OpenCascade.js binding generator so a public ordinary delete remains usable when OCCT also declares placement delete. The exact diff is \`build/context/patches/0001-preserve-public-ordinary-delete.patch\`; the corrected file consumed by the Docker build is \`build/context/patches/bindings.py\`. VibeShape also supplies the configured binding allowlist, purpose-owned generator, and generated build configuration included in this bundle.

The RapidJSON archive contains auxiliary tools with additional terms documented in its upstream \`license.txt\`. The controlled builder uses the RapidJSON library source and does not compile \`bin/jsonchecker\`.
`
}

function createBundleReadme() {
  return `# VibeShape controlled OCCT corresponding-source bundle

This directory preserves the exact source archives, modifications, build recipe, build evidence, output hashes, license texts, notices, and replacement instructions for the controlled OCCT WebAssembly candidate identified by OCCT revision \`${OCCT_BUILD_INPUTS.sources.occt.revision}\`.

Use \`manifest.json\` and \`SHA256SUMS\` to verify every payload file. Follow \`REPLACEMENT.md\` to rebuild the supplied source or use a modified OCCT/OpenCascade.js module in a self-hosted VibeShape checkout.

The bundle covers the controlled OCCT module only. It is not a complete VibeShape release notice/SBOM, does not establish the provenance of the separate published \`replicad-opencascadejs@0.23.0\` feasibility artifact, and is not legal advice. A public release still requires the repository release checklist and legal review.
`
}

function writeManifestAndChecksums(
  bundleDirectory: string,
  sources: OcctComplianceManifest["sources"],
) {
  const manifestPath = join(bundleDirectory, "manifest.json")
  const checksumsPath = join(bundleDirectory, "SHA256SUMS")
  const payloadFiles = listFiles(bundleDirectory).filter(
    (path) => path !== manifestPath && path !== checksumsPath,
  )
  const files = payloadFiles.map((path) => createFileRecord(bundleDirectory, path))
  const manifest: OcctComplianceManifest = {
    schemaVersion: 1,
    bundle: {
      name: OCCT_COMPLIANCE_BUNDLE_NAME,
      purpose: "VibeShape controlled OCCT corresponding-source bundle",
      opencascadeRevision: OCCT_BUILD_INPUTS.sources.occt.revision,
      opencascadeJsRevision: OCCT_BUILD_INPUTS.sources.opencascadeJs.revision,
    },
    toolchain: {
      platform: OCCT_BUILD_INPUTS.platform,
      emscriptenImage: OCCT_BUILD_INPUTS.sourceBuilder.emscriptenImage,
      pythonPackages: [...OCCT_BUILD_INPUTS.sourceBuilder.pythonPackages],
    },
    sources,
    modifications: modificationPaths.map((path) => ({
      path,
      sha256: sha256(join(bundleDirectory, path)),
    })),
    files,
  }
  const parsedManifest = occtComplianceManifestSchema.parse(manifest)
  writeText(manifestPath, `${JSON.stringify(parsedManifest, null, 2)}\n`)
  const checksumFiles = [...payloadFiles, manifestPath]
    .map((path) => createFileRecord(bundleDirectory, path))
    .sort((left, right) => left.path.localeCompare(right.path))
  writeText(
    checksumsPath,
    `${checksumFiles.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
  )
}

function parseChecksums(contents: string) {
  const entries = contents
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line)

      if (!match?.[1] || !match[2]) {
        throw new Error(`Malformed OCCT compliance checksum line: ${line}`)
      }

      return [match[2], match[1]] as const
    })

  if (new Set(entries.map(([path]) => path)).size !== entries.length) {
    throw new Error("OCCT compliance checksums contain duplicate paths.")
  }

  return new Map(entries)
}

export function verifyOcctComplianceBundle(bundleDirectory: string) {
  const absoluteBundleDirectory = resolve(bundleDirectory)
  const manifestPath = join(absoluteBundleDirectory, "manifest.json")
  const checksumsPath = join(absoluteBundleDirectory, "SHA256SUMS")
  const manifest = occtComplianceManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  )
  const actualPaths = requireManifestInventory(absoluteBundleDirectory, manifest)
  verifyBuildProvenance(manifest)
  verifyRequiredPayload(manifest)
  verifyManifestPayload(absoluteBundleDirectory, manifest)
  verifySourceProvenance(manifest)
  verifyModificationProvenance(manifest)
  verifyChecksumInventory(absoluteBundleDirectory, checksumsPath, actualPaths)

  return {
    fileCount: actualPaths.length,
    manifest,
    payloadBytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
  }
}

function verifyBuildProvenance(manifest: OcctComplianceManifest) {
  const expectedPythonPackages = OCCT_BUILD_INPUTS.sourceBuilder.pythonPackages

  if (
    manifest.bundle.name !== OCCT_COMPLIANCE_BUNDLE_NAME ||
    manifest.bundle.opencascadeRevision !== OCCT_BUILD_INPUTS.sources.occt.revision ||
    manifest.bundle.opencascadeJsRevision !== OCCT_BUILD_INPUTS.sources.opencascadeJs.revision ||
    manifest.toolchain.platform !== OCCT_BUILD_INPUTS.platform ||
    manifest.toolchain.emscriptenImage !== OCCT_BUILD_INPUTS.sourceBuilder.emscriptenImage ||
    manifest.toolchain.pythonPackages.length !== expectedPythonPackages.length ||
    manifest.toolchain.pythonPackages.some(
      (value, index) => value !== expectedPythonPackages[index],
    )
  ) {
    throw new Error("OCCT compliance manifest has unexpected build provenance.")
  }
}

function verifyRequiredPayload(manifest: OcctComplianceManifest) {
  const manifestPaths = new Set(manifest.files.map((file) => file.path))
  const missingPath = requiredCompliancePayloadPaths.find((path) => !manifestPaths.has(path))

  if (missingPath) {
    throw new Error(`OCCT compliance manifest is missing required payload: ${missingPath}`)
  }
}

function requireManifestInventory(bundleDirectory: string, manifest: OcctComplianceManifest) {
  const expectedPaths = new Set([
    ...manifest.files.map((file) => file.path),
    "manifest.json",
    "SHA256SUMS",
  ])
  const actualPaths = listFiles(bundleDirectory).map((path) =>
    normalizePath(relative(bundleDirectory, path)),
  )

  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some((path) => !expectedPaths.has(path))
  ) {
    throw new Error("OCCT compliance bundle files do not match the manifest inventory.")
  }

  return actualPaths
}

function verifyManifestPayload(bundleDirectory: string, manifest: OcctComplianceManifest) {
  for (const file of manifest.files) {
    const path = join(bundleDirectory, file.path)

    if (statSync(path).size !== file.bytes || sha256(path) !== file.sha256) {
      throw new Error(`OCCT compliance payload does not match its manifest: ${file.path}`)
    }
  }
}

function verifySourceProvenance(manifest: OcctComplianceManifest) {
  for (const sourceName of Object.keys(sourceBundlePaths) as SourceName[]) {
    const source = manifest.sources[sourceName]
    const expected = OCCT_BUILD_INPUTS.sources[sourceName]
    const sourceFile = manifest.files.find((file) => file.path === source.path)

    if (
      source.path !== sourceBundlePaths[sourceName] ||
      source.revision !== expected.revision ||
      source.sha256 !== expected.sha256 ||
      source.url !== expected.url ||
      sourceFile?.sha256 !== source.sha256
    ) {
      throw new Error(`OCCT compliance manifest has unexpected ${sourceName} provenance.`)
    }
  }
}

function verifyModificationProvenance(manifest: OcctComplianceManifest) {
  const modifications = new Map(
    manifest.modifications.map((modification) => [modification.path, modification.sha256]),
  )

  if (modifications.size !== modificationPaths.length) {
    throw new Error("OCCT compliance manifest has unexpected modification provenance.")
  }

  for (const path of modificationPaths) {
    const payload = manifest.files.find((file) => file.path === path)

    if (modifications.get(path) !== payload?.sha256) {
      throw new Error(`OCCT compliance manifest has unexpected modification provenance: ${path}`)
    }
  }
}

function verifyChecksumInventory(
  bundleDirectory: string,
  checksumsPath: string,
  actualPaths: string[],
) {
  const checksums = parseChecksums(readFileSync(checksumsPath, "utf8"))
  const checksummedPaths = actualPaths.filter((path) => path !== "SHA256SUMS")

  if (
    checksums.size !== checksummedPaths.length ||
    checksummedPaths.some((path) => checksums.get(path) !== sha256(join(bundleDirectory, path)))
  ) {
    throw new Error("OCCT compliance SHA256SUMS does not match the bundle payload.")
  }
}

interface ComplianceBundlePaths {
  archivePath: string
  artifactRoot: string
  builderContext: string
  bundleDirectory: string
  complianceRoot: string
  correctedBindingsPath: string
  destructorPatchPath: string
  inputDirectory: string
  repositoryRoot: string
}

function createComplianceBundlePaths(options: {
  artifactRoot: string
  repositoryRoot: string
}): ComplianceBundlePaths {
  const artifactRoot = resolve(options.artifactRoot)
  const repositoryRoot = resolve(options.repositoryRoot)
  const complianceRoot = join(artifactRoot, "compliance")
  const bundleDirectory = join(complianceRoot, OCCT_COMPLIANCE_BUNDLE_NAME)
  const inputDirectory = join(artifactRoot, "input")
  const builderContext = join(artifactRoot, "builder-context")
  const destructorPatchPath = join(
    repositoryRoot,
    "native/occt/patches/0001-preserve-public-ordinary-delete.patch",
  )
  const correctedBindingsPath = join(builderContext, "patches/bindings.py")

  return {
    archivePath: join(complianceRoot, `${OCCT_COMPLIANCE_BUNDLE_NAME}.tar`),
    artifactRoot,
    builderContext,
    bundleDirectory,
    complianceRoot,
    correctedBindingsPath,
    destructorPatchPath,
    inputDirectory,
    repositoryRoot,
  }
}

function prepareComplianceBundle(paths: ComplianceBundlePaths) {
  const outputBaseName = OCCT_BUILD_INPUTS.outputBaseName
  const { outputFiles } = requireControlledBuildOutputs(paths.inputDirectory, outputBaseName)
  verifyRecordedDestructorPatch({
    correctedPath: paths.correctedBindingsPath,
    patchPath: paths.destructorPatchPath,
    sourceArchivePath: sourceArchivePath(paths.artifactRoot, "opencascadeJs"),
  })

  rmSync(paths.complianceRoot, { force: true, recursive: true })
  mkdirSync(paths.bundleDirectory, { recursive: true })
  return outputFiles
}

function copyComplianceBuildContract(paths: ComplianceBundlePaths, outputFiles: string[]) {
  const outputBaseName = OCCT_BUILD_INPUTS.outputBaseName
  copyFile(
    join(paths.repositoryRoot, "native/occt/Dockerfile.builder"),
    join(paths.bundleDirectory, "build/context/Dockerfile"),
  )
  copyFile(
    join(paths.builderContext, "config/configured-bindings.txt"),
    join(paths.bundleDirectory, "build/context/config/configured-bindings.txt"),
  )
  copyFile(
    paths.correctedBindingsPath,
    join(paths.bundleDirectory, "build/context/patches/bindings.py"),
  )
  copyFile(
    paths.destructorPatchPath,
    join(paths.bundleDirectory, "build/context/patches/0001-preserve-public-ordinary-delete.patch"),
  )
  copyFile(
    join(paths.repositoryRoot, "native/occt/generate-configured-bindings.py"),
    join(paths.bundleDirectory, "build/context/scripts/generate-configured-bindings.py"),
  )
  copyFile(
    join(paths.inputDirectory, `${outputBaseName}.yml`),
    join(paths.bundleDirectory, `build/input/${outputBaseName}.yml`),
  )

  for (const script of [
    "build-occt-source-builder.ts",
    "occt-build-artifacts.ts",
    "occt-build-config.ts",
    "occt-builder-context.ts",
    "occt-process.ts",
    "prepare-occt-build.ts",
  ]) {
    copyFile(
      join(paths.repositoryRoot, "scripts", script),
      join(paths.bundleDirectory, "build/vibeshape-scripts", script),
    )
  }

  for (const outputFile of outputFiles) {
    copyFile(outputFile, join(paths.bundleDirectory, "artifacts", basename(outputFile)))
  }
}

function copyComplianceEvidence(paths: ComplianceBundlePaths) {
  cpSync(join(paths.artifactRoot, "package"), join(paths.bundleDirectory, "package"), {
    recursive: true,
  })

  for (const [source, destination] of [
    [join(paths.artifactRoot, "build-report.json"), "evidence/build-report.json"],
    [
      join(paths.artifactRoot, "source-builder-baseline-report.json"),
      "evidence/source-builder-baseline-report.json",
    ],
    [join(paths.builderContext, "manifest.json"), "evidence/builder-context-manifest.json"],
  ] as const) {
    copyFile(source, join(paths.bundleDirectory, destination))
  }
}

function writeComplianceLegalMaterial(paths: ComplianceBundlePaths) {
  writeLicenseTexts(paths.artifactRoot, paths.bundleDirectory)
  copyFile(
    join(paths.repositoryRoot, "LICENSE"),
    join(paths.bundleDirectory, "licenses/VibeShape-GPL-3.0-or-later.txt"),
  )
  copyFile(
    join(paths.repositoryRoot, "native/occt/REPLACEMENT.md"),
    join(paths.bundleDirectory, "REPLACEMENT.md"),
  )
  writeText(join(paths.bundleDirectory, "README.md"), createBundleReadme())
  writeText(join(paths.bundleDirectory, "THIRD_PARTY_NOTICES.md"), createNotices())
}

function createComplianceArchive(
  paths: ComplianceBundlePaths,
  verification: ReturnType<typeof verifyOcctComplianceBundle>,
) {
  const archiveResult = spawnSync(
    "tar",
    ["-cf", paths.archivePath, "-C", paths.complianceRoot, OCCT_COMPLIANCE_BUNDLE_NAME],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: "inherit",
    },
  )
  assertSuccessfulOcctProcess(archiveResult, "OCCT compliance archive creation")
  const report = {
    schemaVersion: 1,
    bundleDirectory: OCCT_COMPLIANCE_BUNDLE_NAME,
    archive: {
      file: basename(paths.archivePath),
      bytes: statSync(paths.archivePath).size,
      sha256: sha256(paths.archivePath),
    },
    manifestSha256: sha256(join(paths.bundleDirectory, "manifest.json")),
    payloadBytes: verification.payloadBytes,
    fileCount: verification.fileCount,
  }
  const reportPath = join(paths.complianceRoot, "compliance-bundle-report.json")
  writeText(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  return { report, reportPath }
}

export function createOcctComplianceBundle(options: {
  artifactRoot: string
  repositoryRoot: string
}) {
  const paths = createComplianceBundlePaths(options)
  const outputFiles = prepareComplianceBundle(paths)
  const sources = copyVerifiedSources(paths.artifactRoot, paths.bundleDirectory)
  copyComplianceBuildContract(paths, outputFiles)
  copyComplianceEvidence(paths)
  writeComplianceLegalMaterial(paths)
  writeManifestAndChecksums(paths.bundleDirectory, sources)
  const verification = verifyOcctComplianceBundle(paths.bundleDirectory)
  const { report, reportPath } = createComplianceArchive(paths, verification)

  return {
    archivePath: paths.archivePath,
    bundleDirectory: paths.bundleDirectory,
    report,
    reportPath,
    verification,
  }
}
