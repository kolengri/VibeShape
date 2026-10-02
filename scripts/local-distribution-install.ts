import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { z } from "zod"
import {
  assertDistributionPath,
  type DistributionManifest,
  distributionDirectoryEntries,
  verifyDistribution,
} from "./local-distribution-files"

const markerName = ".vibeshape-install.json"
const marker = { schemaVersion: 1, kind: "vibeshape-local-install" } as const
const markerSchema = z
  .object({ schemaVersion: z.literal(1), kind: z.literal("vibeshape-local-install") })
  .strict()
const versionPattern = /^v1-[a-f0-9]{12}-[a-f0-9]{24}$/

function createOrRequireRoot(destination: string, allowNew: boolean) {
  const root = assertDistributionPath(destination)
  if (!existsSync(root)) {
    if (!allowNew) throw new Error("The installation does not exist.")
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  if (!lstatSync(root).isDirectory()) throw new Error("The installation must be a directory.")
  const entries = distributionDirectoryEntries(root)
  if (entries.length === 0 && allowNew)
    writeFileSync(join(root, markerName), `${JSON.stringify(marker)}\n`, {
      flag: "wx",
      mode: 0o600,
    })
  const allowed = new Set([markerName, "versions", "current", ".install-lock"])
  if (entries.some((name) => !allowed.has(name)))
    throw new Error(
      "The installation contains unrelated files; choose an empty or managed directory.",
    )
  assertDistributionPath(join(root, markerName))
  markerSchema.parse(JSON.parse(readFileSync(join(root, markerName), "utf8")))
  return root
}

function requireVersions(root: string, allowNew: boolean) {
  const versions = join(root, "versions")
  assertDistributionPath(versions)
  if (!existsSync(versions)) {
    if (!allowNew) throw new Error("The installation has no versions directory.")
    mkdirSync(versions, { mode: 0o700 })
  }
  if (!lstatSync(versions).isDirectory()) throw new Error("The versions entry must be a directory.")
  for (const name of distributionDirectoryEntries(versions)) {
    if (!versionPattern.test(name))
      throw new Error("The installation contains an unknown version entry.")
    assertDistributionPath(join(versions, name))
    if (!lstatSync(join(versions, name)).isDirectory())
      throw new Error("A version entry must be a directory.")
  }
}

function requireInstallRoot(destination: string, allowNew: boolean) {
  const root = createOrRequireRoot(destination, allowNew)
  requireVersions(root, allowNew)
  validateCurrentPointer(root)
  return root
}

function validateCurrentPointer(root: string) {
  const current = join(root, "current")
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(current)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  if (!stat.isSymbolicLink()) throw new Error("The current pointer must be a managed symlink.")
  const target = readlinkSync(current)
  if (!/^versions\/v1-[a-f0-9]{12}-[a-f0-9]{24}$/.test(target))
    throw new Error("The current pointer has an unsafe target.")
  assertDistributionPath(join(root, target))
}

function withInstallLock<Value>(root: string, operation: () => Value) {
  const lock = join(root, ".install-lock")
  mkdirSync(lock, { mode: 0o700 })
  try {
    return operation()
  } finally {
    const staging = join(lock, "staging")
    if (existsSync(staging)) makeStagingWritable(staging)
    rmSync(lock, { recursive: true })
  }
}

function makeStagingWritable(directory: string) {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return
  chmodSync(directory, 0o700)
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (lstatSync(path).isDirectory()) makeStagingWritable(path)
  }
}

function pointCurrent(root: string, releaseId: string) {
  validateCurrentPointer(root)
  const pending = join(root, ".install-lock", "current")
  symlinkSync(`versions/${releaseId}`, pending)
  renameSync(pending, join(root, "current"))
}

function copyVersion(source: string, staging: string, manifest: DistributionManifest) {
  mkdirSync(staging, { mode: 0o700 })
  for (const file of [...manifest.files, { path: "manifest.json", executable: false }]) {
    const target = join(staging, file.path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(source, file.path), target)
    chmodSync(target, file.executable ? 0o555 : 0o444)
  }
  verifyDistribution(staging)
}

function makeVersionReadOnly(directory: string) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (lstatSync(path).isDirectory()) makeVersionReadOnly(path)
  }
  chmodSync(directory, 0o555)
}

export function installDistribution(source: string, destination: string) {
  const packageRoot = assertDistributionPath(source)
  const manifest = verifyDistribution(packageRoot)
  const target = resolve(destination)
  const relation = relative(packageRoot, target)
  const outside = relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)
  if (!outside) throw new Error("Install outside the package directory.")
  const root = requireInstallRoot(target, true)
  return withInstallLock(root, () => {
    const version = join(root, "versions", manifest.releaseId)
    if (existsSync(version)) {
      const installed = verifyDistribution(version)
      if (JSON.stringify(installed) !== JSON.stringify(manifest))
        throw new Error("The existing version is not this package.")
    } else {
      const staging = join(root, ".install-lock", "staging")
      copyVersion(packageRoot, staging, manifest)
      renameSync(staging, version)
    }
    makeVersionReadOnly(version)
    pointCurrent(root, manifest.releaseId)
    return manifest.releaseId
  })
}

export function rollbackDistribution(destination: string, releaseId: string) {
  if (!versionPattern.test(releaseId)) throw new Error("Invalid release identity.")
  const root = requireInstallRoot(destination, false)
  return withInstallLock(root, () => {
    const manifest = verifyDistribution(join(root, "versions", releaseId))
    if (manifest.releaseId !== releaseId)
      throw new Error("The rollback directory has a different release identity.")
    pointCurrent(root, releaseId)
    return releaseId
  })
}
