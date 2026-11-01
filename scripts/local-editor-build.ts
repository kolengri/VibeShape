import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { distributionHash, distributionInventory } from "./local-distribution-files"

export function verifyControlledEditorBuild(directory: string) {
  const report = z
    .object({
      schemaVersion: z.literal(1),
      kernelRevision: z.literal("bb368e271e24f63078129283148ce83db6b9670a"),
      sourceManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      artifacts: z
        .array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
        .min(2)
        .max(3),
      sourceArchives: z
        .array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
        .length(2),
    })
    .strict()
    .parse(JSON.parse(readFileSync(join(directory, "local-build.json"), "utf8")))
  const files = distributionInventory(directory)
  verifyRuntimeArtifacts(files, report.artifacts)
  verifyRecordedHashes(files, [...report.artifacts, ...report.sourceArchives])
  requireControlledSources(files)
  return distributionHash(JSON.stringify(files))
}

// @jitl/quickjs-wasmfile-release-sync 0.31.0, exact lockfile-installed release WASM.
// Runtime upgrades require reviewing this pin rather than accepting arbitrary extra modules.
const quickJsReleaseSha256 = "0c031dd404df00f2d1ed9491a6590d014e88a50424996e5fd70feff1c931c045"

function runtimeRole(artifact: { file: string; sha256: string }) {
  if (/^assets\/replicad_single-[A-Za-z0-9_-]+\.wasm$/.test(artifact.file)) return "occt"
  if (/^assets\/vibeshape_slvs-[A-Za-z0-9_-]+\.wasm$/.test(artifact.file)) return "solver"
  if (
    /^assets\/emscripten-module-[A-Za-z0-9_-]+\.wasm$/.test(artifact.file) &&
    artifact.sha256 === quickJsReleaseSha256
  )
    return "script"
  throw new Error(`Unreviewed controlled-build WASM: ${artifact.file}`)
}

function verifyRuntimeArtifacts(
  files: ReturnType<typeof distributionInventory>,
  artifacts: { file: string; sha256: string }[],
) {
  const roles = artifacts.map(runtimeRole)
  if (
    new Set(roles).size !== roles.length ||
    !roles.includes("occt") ||
    !roles.includes("solver")
  ) {
    throw new Error(
      "Controlled build requires one kernel, one solver and at most one reviewed script runtime.",
    )
  }
  const wasmFiles = files.filter(
    ({ path }) => path.startsWith("assets/") && path.toLowerCase().endsWith(".wasm"),
  )
  if (wasmFiles.length !== artifacts.length)
    throw new Error("Controlled build contains unrecorded WASM artifacts.")
}

function verifyRecordedHashes(
  files: ReturnType<typeof distributionInventory>,
  expected: { file: string; sha256: string }[],
) {
  for (const entry of expected) {
    if (!files.some(({ path, sha256 }) => path === entry.file && sha256 === entry.sha256))
      throw new Error(`Controlled build hash mismatch: ${entry.file}`)
  }
}

function requireControlledSources(files: ReturnType<typeof distributionInventory>) {
  for (const required of [
    "sources/occt-corresponding-source.tar",
    "sources/solvespace-corresponding-source.tar.gz",
    "sources/LICENSE.txt",
    "sources/OCCT-NOTICES.txt",
    "sources/Noto-Sans-OFL.txt",
    "sources/Noto-Sans-provenance.md",
    "sources/opentype-js-MIT.txt",
    "sources/OCCT-REPLACEMENT.txt",
    "sources/index.html",
  ]) {
    if (!files.some(({ path }) => path === required))
      throw new Error(`Controlled build lacks ${required}.`)
  }
}
