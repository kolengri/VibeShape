import { canonicalJson, timestampSchema } from "@vibeshape/domain"
import {
  type AssemblyLibraryItem,
  type AssemblyLibraryVersion,
  assemblyLibraryDefinitionAssets,
  assemblyLibraryDefinitionSchema,
  assemblyLibraryItemIdSchema,
  assemblyLibraryItemSchema,
  assemblyLibraryTagsSchema,
  assemblyLibraryVersionContent,
  assemblyLibraryVersionContentSchema,
  assemblyLibraryVersionNumberSchema,
  assemblyLibraryVersionSchema,
} from "@vibeshape/domain/assembly-library"
import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import {
  type SourceAsset,
  type SourceAssetBlob,
  sourceAssetBlobSchema,
} from "@vibeshape/domain/source-assets"
import Dexie, { type Table } from "dexie"
import { z } from "zod"
import {
  classifyPersistenceError,
  PersistenceInvariantError,
  persistenceInvariantError,
} from "./diagnostics"
import { sha256Bytes, sha256Text } from "./hash"
import type { PersistenceResult } from "./repository"
import { verifySourceAssetBlobs } from "./source-asset-store"

export class AssemblyLibraryDatabase extends Dexie {
  items!: Table<AssemblyLibraryItem, string>
  versions!: Table<AssemblyLibraryVersion, [string, number]>
  blobs!: Table<SourceAssetBlob, string>

  constructor(name = "vibeshape-assembly-library") {
    super(name)
    this.version(1).stores({
      items: "id,updatedAt",
      versions: "[itemId+version],itemId",
      blobs: "digest",
    })
    this.on(
      "ready",
      () => {
        // Dexie v1 uses native IndexedDB version 10; verno retains the declared version on fallback.
        if (this.backendDB().version !== 10)
          throw persistenceInvariantError(
            "unsupported-version",
            "This runtime cannot open a newer library database authority.",
          )
      },
      true,
    )
  }
}

const metadataRevisionSchema = z.number().int().positive().safe()
const publishSchema = z
  .object({
    itemId: assemblyLibraryItemIdSchema,
    expectedMetadataRevision: metadataRevisionSchema.nullable(),
    name: authoredItemNameSchema,
    tags: assemblyLibraryTagsSchema,
    definition: assemblyLibraryDefinitionSchema,
    blobs: z.array(sourceAssetBlobSchema).max(1024),
    createdAt: timestampSchema,
  })
  .strict()
const metadataSchema = z
  .object({
    itemId: assemblyLibraryItemIdSchema,
    expectedMetadataRevision: metadataRevisionSchema,
    name: authoredItemNameSchema,
    tags: assemblyLibraryTagsSchema,
    updatedAt: timestampSchema,
  })
  .strict()
const readSchema = z
  .object({
    itemId: assemblyLibraryItemIdSchema,
    version: assemblyLibraryVersionNumberSchema.optional(),
  })
  .strict()
const searchSchema = z
  .object({
    query: z.string().trim().max(256).default(""),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict()
export type AssemblyLibraryVersionRead = Readonly<{
  item: AssemblyLibraryItem
  version: AssemblyLibraryVersion
  blobs: readonly SourceAssetBlob[]
}>

function libraryDiagnostic(error: unknown) {
  let current = error
  for (let depth = 0; depth < 4; depth++) {
    if (current instanceof PersistenceInvariantError) return current.diagnostic
    if (!(current instanceof Dexie.DexieError)) break
    current = current.inner
  }
  return classifyPersistenceError(error)
}

function parsed<T>(schema: z.ZodType<T>, input: unknown, stored = false): T {
  const result = schema.safeParse(input)
  if (!result.success)
    throw persistenceInvariantError(
      stored ? "corrupt-history" : "invalid-input",
      stored ? "The local library record is invalid." : "The local library request is invalid.",
    )
  return result.data
}
function owned<T>(value: T): T {
  return JSON.parse(canonicalJson(value))
}
async function verifyVersion(version: AssemblyLibraryVersion) {
  if (
    (await sha256Text(canonicalJson(assemblyLibraryVersionContent(version)))) !==
    version.contentDigest
  )
    throw persistenceInvariantError(
      "corrupt-history",
      "The frozen library revision checksum is invalid.",
    )
}
function closureSizes(assets: readonly SourceAsset[]) {
  return new Map(assets.map(({ digest, byteLength }) => [digest, byteLength]))
}
async function verifiedBlob(
  input: unknown,
  digest: string,
  size: number,
): Promise<SourceAssetBlob> {
  const blob = parsed(sourceAssetBlobSchema, input, true)
  const bytes = Uint8Array.from(blob.bytes)
  if (blob.digest !== digest || bytes.byteLength !== size || (await sha256Bytes(bytes)) !== digest)
    throw persistenceInvariantError(
      "corrupt-history",
      "The library source bytes are missing or corrupt.",
    )
  return { digest, bytes }
}
function assertRevision(item: AssemblyLibraryItem | null, expected: number | null) {
  if ((item?.metadataRevision ?? null) !== expected)
    throw persistenceInvariantError("stale-revision", "The library item changed before this write.")
  if (item?.metadataRevision === Number.MAX_SAFE_INTEGER)
    throw persistenceInvariantError(
      "invalid-input",
      "The library metadata revision cannot advance safely.",
    )
}

function nextItem(
  request: z.infer<typeof publishSchema>,
  previous: AssemblyLibraryItem | null,
  version: number,
) {
  return parsed(assemblyLibraryItemSchema, {
    schemaVersion: 1,
    id: request.itemId,
    metadataRevision: (previous?.metadataRevision ?? 0) + 1,
    headVersion: version,
    name: request.name,
    tags: request.tags,
    createdAt: previous?.createdAt ?? request.createdAt,
    updatedAt: request.createdAt,
  })
}

/** Immutable revisions and source bytes publish with their item head in one separate IndexedDB transaction. */
export class LocalAssemblyLibraryRepository {
  constructor(readonly database: AssemblyLibraryDatabase) {}

  private async item(id: string): Promise<AssemblyLibraryItem | null> {
    const record = await this.database.items.get(id)
    if (record === undefined) return null
    const item = parsed(assemblyLibraryItemSchema, record, true)
    if (item.id !== id)
      throw persistenceInvariantError(
        "corrupt-history",
        "The library item identity is inconsistent.",
      )
    return item
  }
  private async storedVersion(itemId: string, version: number) {
    const stored = parsed(
      assemblyLibraryVersionSchema,
      await this.database.versions.get([itemId, version]),
      true,
    )
    if (stored.itemId !== itemId || stored.version !== version)
      throw persistenceInvariantError(
        "corrupt-history",
        "The library revision identity is inconsistent.",
      )
    return stored
  }
  private async publishBlobs(
    assets: readonly SourceAsset[],
    prepared: readonly SourceAssetBlob[],
    assertWritable: () => void,
  ) {
    const sizes = closureSizes(assets)
    for (const blob of prepared) {
      if (sizes.get(blob.digest) !== blob.bytes.byteLength)
        throw persistenceInvariantError(
          "invalid-input",
          "Library source bytes must belong to the frozen revision closure.",
        )
      if (!(await this.database.blobs.get(blob.digest))) {
        assertWritable()
        await this.database.blobs.add(blob)
      }
    }
    for (const [digest, size] of sizes)
      await Dexie.waitFor(verifiedBlob(await this.database.blobs.get(digest), digest, size))
  }

  private async commitVersion(
    request: z.infer<typeof publishSchema>,
    definition: AssemblyLibraryVersion["definition"],
    prepared: readonly SourceAssetBlob[],
    assets: readonly SourceAsset[],
    assertWritable: () => void,
  ): Promise<AssemblyLibraryVersionRead> {
    const previous = await this.item(request.itemId)
    assertRevision(previous, request.expectedMetadataRevision)
    if (!previous && (await this.database.items.count()) >= 10_000)
      throw persistenceInvariantError(
        "invalid-input",
        "The local library item budget is exhausted.",
      )
    if (previous)
      await Dexie.waitFor(
        verifyVersion(await this.storedVersion(previous.id, previous.headVersion)),
      )
    const content = parsed(assemblyLibraryVersionContentSchema, {
      schemaVersion: 1,
      itemId: request.itemId,
      version: (previous?.headVersion ?? 0) + 1,
      createdAt: request.createdAt,
      definition,
    })
    const version = parsed(assemblyLibraryVersionSchema, {
      ...content,
      contentDigest: await Dexie.waitFor(sha256Text(canonicalJson(content))),
    })
    const item = nextItem(request, previous, version.version)
    await this.publishBlobs(assets, prepared, assertWritable)
    assertWritable()
    await this.database.versions.add(version)
    assertWritable()
    await this.database.items.put(item)
    const blobs: SourceAssetBlob[] = []
    for (const [digest, size] of closureSizes(assets))
      blobs.push(
        await Dexie.waitFor(verifiedBlob(await this.database.blobs.get(digest), digest, size)),
      )
    assertWritable()
    return { item, version, blobs }
  }
  async publishVersion(
    input: unknown,
    assertWritable: () => void = () => {},
  ): Promise<PersistenceResult<AssemblyLibraryVersionRead>> {
    try {
      const request = parsed(publishSchema, input)
      // Capture semantic data before any await; caller-owned parameter objects must not drift during hashing.
      const definition = parsed(assemblyLibraryDefinitionSchema, owned(request.definition))
      const prepared = await verifySourceAssetBlobs(request.blobs)
      const assets = assemblyLibraryDefinitionAssets(definition)
      const result = await this.database.transaction(
        "rw",
        this.database.items,
        this.database.versions,
        this.database.blobs,
        () => this.commitVersion(request, definition, prepared, assets, assertWritable),
      )
      return { ok: true, value: result }
    } catch (error) {
      return { ok: false, diagnostic: libraryDiagnostic(error) }
    }
  }

  async updateMetadata(
    input: unknown,
    assertWritable: () => void = () => {},
  ): Promise<PersistenceResult<AssemblyLibraryItem>> {
    try {
      const request = parsed(metadataSchema, input)
      let result: AssemblyLibraryItem | undefined
      await this.database.transaction(
        "rw",
        this.database.items,
        this.database.versions,
        async () => {
          const previous = await this.item(request.itemId)
          assertRevision(previous, request.expectedMetadataRevision)
          if (!previous)
            throw persistenceInvariantError("invalid-input", "The library item is missing.")
          await Dexie.waitFor(
            verifyVersion(await this.storedVersion(previous.id, previous.headVersion)),
          )
          if (
            previous.name === request.name &&
            canonicalJson(previous.tags) === canonicalJson(request.tags)
          )
            throw persistenceInvariantError(
              "invalid-input",
              "The library metadata change is a no-op.",
            )
          result = parsed(assemblyLibraryItemSchema, {
            ...previous,
            metadataRevision: previous.metadataRevision + 1,
            name: request.name,
            tags: request.tags,
            updatedAt: request.updatedAt,
          })
          assertWritable()
          await this.database.items.put(result)
          assertWritable()
        },
      )
      if (!result)
        throw persistenceInvariantError(
          "transaction-aborted",
          "The library metadata was not published.",
        )
      return { ok: true, value: result }
    } catch (error) {
      return { ok: false, diagnostic: libraryDiagnostic(error) }
    }
  }

  async readVersion(input: unknown): Promise<PersistenceResult<AssemblyLibraryVersionRead>> {
    try {
      const request = parsed(readSchema, input)
      const result = await this.database.transaction(
        "r",
        this.database.items,
        this.database.versions,
        this.database.blobs,
        async () => {
          const item = await this.item(request.itemId)
          if (!item)
            throw persistenceInvariantError("invalid-input", "The library item is missing.")
          const versionNumber = request.version ?? item.headVersion
          if (versionNumber > item.headVersion)
            throw persistenceInvariantError(
              "invalid-input",
              "The requested library revision does not exist.",
            )
          const version = await this.storedVersion(item.id, versionNumber)
          const stored: { digest: string; size: number; blob: unknown }[] = []
          for (const [digest, size] of closureSizes(
            assemblyLibraryDefinitionAssets(version.definition),
          ))
            stored.push({ digest, size, blob: await this.database.blobs.get(digest) })
          return { item, version, stored }
        },
      )
      await verifyVersion(result.version)
      const blobs = await Promise.all(
        result.stored.map(({ digest, size, blob }) => verifiedBlob(blob, digest, size)),
      )
      return { ok: true, value: { item: result.item, version: result.version, blobs } }
    } catch (error) {
      return { ok: false, diagnostic: libraryDiagnostic(error) }
    }
  }

  async listItems(input: unknown = {}): Promise<PersistenceResult<readonly AssemblyLibraryItem[]>> {
    try {
      const request = parsed(searchSchema, input)
      const records = await this.database.items.limit(10_001).toArray()
      if (records.length > 10_000)
        throw persistenceInvariantError(
          "corrupt-history",
          "The stored library exceeds its item budget.",
        )
      const tokens = request.query.toLowerCase().split(/\s+/).filter(Boolean)
      const items = records
        .map((record) => parsed(assemblyLibraryItemSchema, record, true))
        .filter((item) => {
          const text = [item.name, ...item.tags].join(" ").toLowerCase()
          return tokens.every((token) => text.includes(token))
        })
      items.sort((a, b) =>
        a.updatedAt > b.updatedAt
          ? -1
          : a.updatedAt < b.updatedAt
            ? 1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0,
      )
      return { ok: true, value: items.slice(0, request.limit) }
    } catch (error) {
      return { ok: false, diagnostic: libraryDiagnostic(error) }
    }
  }
}
