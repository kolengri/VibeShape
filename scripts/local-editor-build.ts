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
        .length(2),
      sourceArchives: z
        .array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
        .length(2),
    })
    .strict()
    .parse(JSON.parse(readFileSync(join(directory, "local-build.json"), "utf8")))
  const files = distributionInventory(directory)
  verifyRecordedHashes(files, [...report.artifacts, ...report.sourceArchives])
  requireControlledSources(files)
  return distributionHash(JSON.stringify(files))
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
