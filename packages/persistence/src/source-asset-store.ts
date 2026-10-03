import {
  type SourceAsset,
  type SourceAssetBlob,
  sourceAssetBlobSchema,
  sourceAssetDigestSchema,
  sourceAssetSchema,
} from "@vibeshape/domain/source-assets"
import Dexie from "dexie"
import { z } from "zod"
import type { VibeShapeDatabase } from "./database"
import { classifyPersistenceError, persistenceInvariantError } from "./diagnostics"
import { sha256Bytes } from "./hash"
import type { PersistenceResult } from "./repository"

/** Copies buffers before hashing so later caller mutation cannot change prepared publication. */
export async function verifySourceAssetBlobs(input: unknown): Promise<readonly SourceAssetBlob[]> {
  const parsed = z.array(sourceAssetBlobSchema).max(1024).safeParse(input)
  if (!parsed.success)
    throw persistenceInvariantError("invalid-input", "The source asset byte payload is invalid.")
  const records: SourceAssetBlob[] = []
  const digests = new Set<string>()
  let total = 0
  for (const blob of parsed.data) {
    if (digests.has(blob.digest))
      throw persistenceInvariantError("invalid-input", "The source byte payload repeats a digest.")
    const bytes = Uint8Array.from(blob.bytes)
    total += bytes.byteLength
    if (total > 64 * 1024 * 1024)
      throw persistenceInvariantError(
        "invalid-input",
        "Source publication exceeds its aggregate byte budget.",
      )
    if ((await sha256Bytes(bytes)) !== blob.digest)
      throw persistenceInvariantError(
        "invalid-input",
        "The source asset digest does not match its bytes.",
      )
    records.push({ digest: blob.digest, bytes })
    digests.add(blob.digest)
  }
  return records
}

export async function prepareSourceAssetBytes(
  assetInput: unknown,
  bytes: unknown,
): Promise<PersistenceResult<SourceAssetBlob>> {
  try {
    const asset = sourceAssetSchema.safeParse(assetInput)
    if (
      !asset.success ||
      !(bytes instanceof Uint8Array) ||
      asset.data.byteLength !== bytes.byteLength
    )
      throw persistenceInvariantError(
        "invalid-input",
        "The source descriptor and byte length disagree.",
      )
    const blob = (await verifySourceAssetBlobs([{ digest: asset.data.digest, bytes }]))[0]
    if (!blob)
      throw persistenceInvariantError("invalid-input", "The prepared source bytes are missing.")
    return { ok: true, value: blob }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

async function verifiedStoredBytes(
  database: VibeShapeDatabase,
  asset: Pick<SourceAsset, "digest" | "byteLength">,
) {
  const stored = sourceAssetBlobSchema.safeParse(await database.assetBlobs.get(asset.digest))
  if (
    !stored.success ||
    stored.data.digest !== asset.digest ||
    stored.data.bytes.byteLength !== asset.byteLength ||
    (await sha256Bytes(stored.data.bytes)) !== asset.digest
  )
    throw persistenceInvariantError(
      "corrupt-history",
      "Required source bytes are missing or corrupt.",
    )
  return Uint8Array.from(stored.data.bytes)
}

export async function readSourceAssetBytes(
  database: VibeShapeDatabase,
  digestInput: unknown,
): Promise<PersistenceResult<Uint8Array>> {
  try {
    const digest = sourceAssetDigestSchema.safeParse(digestInput)
    if (!digest.success)
      throw persistenceInvariantError("invalid-input", "The source digest is invalid.")
    const stored = sourceAssetBlobSchema.safeParse(await database.assetBlobs.get(digest.data))
    if (!stored.success)
      throw persistenceInvariantError(
        "corrupt-history",
        "Required source bytes are missing or corrupt.",
      )
    return {
      ok: true,
      value: await verifiedStoredBytes(database, {
        digest: digest.data,
        byteLength: stored.data.bytes.byteLength,
      }),
    }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

/** Must run in the same IndexedDB transaction as events, snapshot, head and recovery marker. */
export async function publishSourceAssetBytes(
  database: VibeShapeDatabase,
  assets: readonly SourceAsset[],
  prepared: readonly SourceAssetBlob[],
) {
  const sizes = new Map(assets.map((asset) => [asset.digest, asset.byteLength]))
  for (const blob of prepared) {
    if (sizes.get(blob.digest) !== blob.bytes.byteLength)
      throw persistenceInvariantError(
        "invalid-input",
        "Source bytes must belong to the committed descriptor closure.",
      )
    const old = await database.assetBlobs.get(blob.digest)
    if (old)
      await Dexie.waitFor(
        verifiedStoredBytes(database, { digest: blob.digest, byteLength: blob.bytes.byteLength }),
      )
    else await database.assetBlobs.add(blob)
  }
  for (const [digest, byteLength] of sizes)
    await Dexie.waitFor(verifiedStoredBytes(database, { digest, byteLength }))
}

export async function requireSourceAssetBytes(
  database: VibeShapeDatabase,
  assets: readonly SourceAsset[],
) {
  for (const asset of assets) await verifiedStoredBytes(database, asset)
}
