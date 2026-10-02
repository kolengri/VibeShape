import { createHash } from "node:crypto"
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"

export const DISTRIBUTION_BUN_VERSION = "1.3.14"
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const safeRelativePath = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      /^[A-Za-z0-9._@ /+-]+$/.test(value) &&
      value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
    "Package paths must be safe relative file paths.",
  )
const distributionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    bunVersion: z.literal(DISTRIBUTION_BUN_VERSION),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    releaseId: z.string().regex(/^v1-[a-f0-9]{12}-[a-f0-9]{24}$/),
    files: z
      .array(
        z
          .object({
            path: safeRelativePath,
            bytes: z.number().int().positive().safe(),
            sha256: hash,
            executable: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(20_000),
  })
  .strict()
export type DistributionManifest = z.infer<typeof distributionManifestSchema>

export function distributionHash(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function distributionDirectoryEntries(directory: string) {
  return readdirSync(directory)
    .sort()
    .filter((name) => {
      if (name !== ".DS_Store") return true
      const stat = lstatSync(join(directory, name))
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Finder metadata must be a regular file.")
      return false
    })
}

export function assertDistributionPath(path: string) {
  const absolute = resolve(path)
  if (absolute === dirname(absolute))
    throw new Error("A filesystem root is not a distribution destination.")
  let candidate = absolute
  for (;;) {
    if (
      existsSync(candidate) ||
      (() => {
        try {
          return lstatSync(candidate).isSymbolicLink()
        } catch {
          return false
        }
      })()
    ) {
      const stat = lstatSync(candidate)
      if (stat.isSymbolicLink()) throw new Error(`Symlink traversal is forbidden: ${candidate}`)
      if (candidate !== absolute && !stat.isDirectory())
        throw new Error(`A parent is not a directory: ${candidate}`)
    }
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return absolute
}

export function distributionInventory(directory: string): DistributionManifest["files"] {
  const root = assertDistributionPath(directory)
  const files: DistributionManifest["files"] = []
  const visit = (relative: string) => {
    for (const name of distributionDirectoryEntries(join(root, relative))) {
      const path = relative ? `${relative}/${name}` : name
      const stat = lstatSync(join(root, path))
      if (stat.isSymbolicLink()) throw new Error(`Package symlinks are forbidden: ${path}`)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) {
        if (path === "manifest.json") continue
        files.push({
          path,
          bytes: stat.size,
          sha256: distributionHash(readFileSync(join(root, path))),
          executable: (stat.mode & 0o111) !== 0,
        })
      } else throw new Error(`Unsupported package entry: ${path}`)
    }
  }
  visit("")
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

export function createDistributionManifest(
  directory: string,
  sourceCommit: string,
): DistributionManifest {
  const payload = {
    schemaVersion: 1 as const,
    bunVersion: DISTRIBUTION_BUN_VERSION,
    sourceCommit,
    files: distributionInventory(directory),
  }
  const releaseId = `v1-${sourceCommit.slice(0, 12)}-${distributionHash(JSON.stringify(payload)).slice(0, 24)}`
  return distributionManifestSchema.parse({ ...payload, releaseId })
}

export function verifyDistribution(directory: string): DistributionManifest {
  const root = assertDistributionPath(directory)
  const manifestPath = join(root, "manifest.json")
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink())
    throw new Error("The package manifest must be a regular file.")
  const manifest = distributionManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")))
  const actual = createDistributionManifest(root, manifest.sourceCommit)
  if (JSON.stringify(actual) !== JSON.stringify(manifest))
    throw new Error("Package inventory or release identity does not match its contents.")
  for (const required of [
    "vibeshape",
    "launcher.js",
    "apps/mcp-server/src/index.js",
    "apps/web/dist/index.html",
    "sources/vibeshape-source.tar",
    "LICENSE",
    "docs/local-distribution.md",
  ]) {
    if (!manifest.files.some(({ path }) => path === required))
      throw new Error(`The package is missing ${required}.`)
  }
  return manifest
}
