import { sessionIdSchema, technicalIdentifierSchema, timestampSchema } from "@vibeshape/domain"
import { isError } from "is-what"
import { z } from "zod"
import type { VibeShapeDatabase } from "./database"
import { classifyPersistenceError, createPersistenceDiagnostic } from "./diagnostics"
import { sha256Bytes } from "./hash"
import type { PersistenceResult } from "./repository"
import { cacheIndexRecordSchema, sha256Schema } from "./schemas"

const MAX_CACHE_ENTRY_BYTES = 512 * 1024 * 1024

const cacheWriteInputSchema = z
  .object({
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength <= MAX_CACHE_ENTRY_BYTES, "Cache entry is too large."),
    engineBuildId: technicalIdentifierSchema,
    operationId: sessionIdSchema,
    lastAccessedAt: timestampSchema,
  })
  .strict()

const cacheReadInputSchema = z
  .object({
    contentHash: sha256Schema,
    engineBuildId: technicalIdentifierSchema,
  })
  .strict()

export interface DerivedCacheWriteReport {
  contentHash: string
  byteLength: number
  path: string
}

export type DerivedCacheReadResult = { status: "hit"; bytes: Uint8Array } | { status: "miss" }

async function cacheDirectory(root: FileSystemDirectoryHandle) {
  return root.getDirectoryHandle("cache", { create: true })
}

async function writeBytes(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await handle.createWritable()
  await writable.write(Uint8Array.from(bytes))
  await writable.close()
}

async function readBytes(handle: FileSystemFileHandle) {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer())
}

async function readFileBytesIfPresent(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return await readBytes(await directory.getFileHandle(name))
  } catch (error) {
    if (isError(error) && error.name === "NotFoundError") return null
    throw error
  }
}

async function verifiedFileBytes(
  directory: FileSystemDirectoryHandle,
  name: string,
  expectedHash: string,
) {
  const bytes = await readFileBytesIfPresent(directory, name)
  if (!bytes) return null
  return (await sha256Bytes(bytes)) === expectedHash ? bytes : null
}

async function removeEntryIfPresent(directory: FileSystemDirectoryHandle, name: string) {
  try {
    await directory.removeEntry(name)
  } catch {
    // Derived cache cleanup is best effort; the next orphan sweep retries it.
  }
}

function requireVerifiedBytes(bytes: Uint8Array | null, message: string) {
  if (!bytes) throw new DOMException(message, "DataError")
  return bytes
}

async function publishCacheFiles(
  directory: FileSystemDirectoryHandle,
  temporaryName: string,
  finalName: string,
  contentHash: string,
  bytes: Uint8Array,
) {
  await writeBytes(await directory.getFileHandle(temporaryName, { create: true }), bytes)
  const staged = requireVerifiedBytes(
    await verifiedFileBytes(directory, temporaryName, contentHash),
    "Staged cache checksum mismatch.",
  )
  await writeBytes(await directory.getFileHandle(finalName, { create: true }), staged)
  return requireVerifiedBytes(
    await verifiedFileBytes(directory, finalName, contentHash),
    "Published cache checksum mismatch.",
  )
}

async function executeCacheWrite(
  database: VibeShapeDatabase,
  root: FileSystemDirectoryHandle,
  input: z.output<typeof cacheWriteInputSchema>,
  contentHash: string,
) {
  const directory = await cacheDirectory(root)
  const temporaryName = `${contentHash}.${input.operationId}.tmp`
  try {
    const finalName = `${contentHash}.bin`
    const published = await publishCacheFiles(
      directory,
      temporaryName,
      finalName,
      contentHash,
      input.bytes,
    )
    const record = cacheIndexRecordSchema.parse({
      schemaVersion: 0,
      contentHash,
      path: `cache/${finalName}`,
      byteLength: published.byteLength,
      engineBuildId: input.engineBuildId,
      lastAccessedAt: input.lastAccessedAt,
    })
    await database.cacheIndex.put(record)
    return { contentHash, byteLength: published.byteLength, path: record.path }
  } finally {
    await removeEntryIfPresent(directory, temporaryName)
  }
}

export async function writeDerivedCache(
  database: VibeShapeDatabase,
  root: FileSystemDirectoryHandle,
  input: unknown,
): Promise<PersistenceResult<DerivedCacheWriteReport>> {
  const parsed = cacheWriteInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic("invalid-input", "The cache write is invalid."),
    }
  }
  const contentHash = await sha256Bytes(parsed.data.bytes)
  try {
    return { ok: true, value: await executeCacheWrite(database, root, parsed.data, contentHash) }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

async function invalidateCacheEntry(
  database: VibeShapeDatabase,
  directory: FileSystemDirectoryHandle,
  contentHash: string,
) {
  await database.cacheIndex.delete(contentHash)
  await removeEntryIfPresent(directory, `${contentHash}.bin`)
}

async function readCacheRecord(
  database: VibeShapeDatabase,
  root: FileSystemDirectoryHandle,
  input: z.output<typeof cacheReadInputSchema>,
): Promise<DerivedCacheReadResult> {
  const record = await database.cacheIndex.get(input.contentHash)
  if (!record) return { status: "miss" }
  const directory = await cacheDirectory(root)
  const bytes = await verifiedFileBytes(directory, `${input.contentHash}.bin`, input.contentHash)
  if (record.engineBuildId === input.engineBuildId && bytes) return { status: "hit", bytes }
  await invalidateCacheEntry(database, directory, input.contentHash)
  return { status: "miss" }
}

export async function readDerivedCache(
  database: VibeShapeDatabase,
  root: FileSystemDirectoryHandle,
  input: unknown,
): Promise<PersistenceResult<DerivedCacheReadResult>> {
  const parsed = cacheReadInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic("invalid-input", "The cache read is invalid."),
    }
  }
  try {
    return { ok: true, value: await readCacheRecord(database, root, parsed.data) }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

function indexedCacheFileNames(contentHashes: readonly string[]) {
  return new Set(contentHashes.map((contentHash) => `${contentHash}.bin`))
}

async function removeOrphanFiles(
  directory: FileSystemDirectoryHandle,
  indexed: ReadonlySet<string>,
) {
  const removed: string[] = []
  for await (const name of directory.keys()) {
    const isOrphan = name.endsWith(".tmp") || !indexed.has(name)
    if (!isOrphan) continue
    await directory.removeEntry(name)
    removed.push(name)
  }
  return removed.sort()
}

export async function cleanupDerivedCacheOrphans(
  database: VibeShapeDatabase,
  root: FileSystemDirectoryHandle,
): Promise<PersistenceResult<{ removed: string[] }>> {
  try {
    const directory = await cacheDirectory(root)
    const indexed = indexedCacheFileNames(await database.cacheIndex.toCollection().primaryKeys())
    return { ok: true, value: { removed: await removeOrphanFiles(directory, indexed) } }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}
