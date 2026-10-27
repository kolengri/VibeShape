import { canonicalJson } from "@vibeshape/domain/canonical-json"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type { DocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import type { DocumentSnapshotV5 } from "@vibeshape/domain/document-v5"
import type { DocumentSnapshotV6 } from "@vibeshape/domain/document-v6"
import {
  type SourceAsset,
  type SourceAssetBlob,
  sourceAssetIdSchema,
} from "@vibeshape/domain/source-assets"
import {
  readSourceAssetBytes,
  type VibeShapeDatabase,
  verifySourceAssetBlobs,
} from "@vibeshape/persistence"
import {
  type SourceAssetMaterialization,
  sourceAssetMaterializationsSchema,
} from "@vibeshape/protocol"
import { z } from "zod"

const importedBinding = z.object({ sourceAssetId: sourceAssetIdSchema })

/** Resolves immutable source bytes separately from the worker's semantic document projection. */
export async function materializeDocumentSourceAssets(
  database: VibeShapeDatabase,
  readAuthority: () => Promise<DocumentAuthoritySnapshot>,
  features: readonly { parameters: unknown }[],
): Promise<readonly SourceAssetMaterialization[]> {
  const required = new Set(
    features.flatMap((feature) => {
      const binding = importedBinding.safeParse(feature.parameters)
      return binding.success ? [binding.data.sourceAssetId] : []
    }),
  )
  if (required.size === 0) return []
  const authority = await readAuthority()
  if (
    authority.schemaVersion !== 4 &&
    authority.schemaVersion !== 5 &&
    authority.schemaVersion !== 6
  )
    throw new Error("Imported geometry requires source asset authority.")
  const assets = [...required].map((id) => {
    const asset = authority.assets.find((candidate) => candidate.id === id)
    if (!asset) throw new Error("The imported feature's source descriptor is missing.")
    return asset
  })
  return readMaterializations(database, assets)
}

async function readMaterializations(
  database: VibeShapeDatabase,
  assets: readonly SourceAsset[],
  ownedBlobs: readonly SourceAssetBlob[] = [],
) {
  if (assets.length > 128) throw new Error("Source geometry exceeds its materialization budget.")
  const materials: SourceAssetMaterialization[] = []
  const prepared = new Map(
    (await verifySourceAssetBlobs(ownedBlobs)).map((blob) => [blob.digest, blob.bytes]),
  )
  const digests = new Set(assets.map((asset) => asset.digest))
  if ([...prepared.keys()].some((digest) => !digests.has(digest)))
    throw new Error("Disposable source bytes must belong to the frozen assembly closure.")
  for (const asset of assets) {
    const bytes = prepared.get(asset.digest)
    const read = bytes
      ? { ok: true as const, value: bytes }
      : await readSourceAssetBytes(database, asset.digest)
    if (!read.ok) throw new Error(read.diagnostic.message)
    if (read.value.byteLength !== asset.byteLength)
      throw new Error("Source byte length disagrees with its descriptor.")
    materials.push({ asset, bytes: Uint8Array.from(read.value) })
  }
  return sourceAssetMaterializationsSchema.parse(materials)
}

function assemblySourceDescriptors(
  authority: DocumentSnapshotV4 | DocumentSnapshotV5 | DocumentSnapshotV6,
) {
  const assets = authority.assembly.definitions.flatMap((definition) =>
    definition.pinnedModels.flatMap((model) => model.assets),
  )
  const required = new Map<string, SourceAsset>()
  for (const asset of assets) {
    const previous = required.get(asset.id)
    if (previous && canonicalJson(previous) !== canonicalJson(asset))
      throw new Error("Frozen assembly source descriptors conflict.")
    required.set(asset.id, asset)
  }
  return [...required.values()]
}

/** Frozen assembly dependencies survive deletion of their original authored Parts. */
export async function materializeAssemblySourceAssets(
  database: VibeShapeDatabase,
  authority: DocumentSnapshotV4 | DocumentSnapshotV5 | DocumentSnapshotV6,
  ownedBlobs: readonly SourceAssetBlob[] = [],
): Promise<readonly SourceAssetMaterialization[]> {
  return readMaterializations(database, assemblySourceDescriptors(authority), ownedBlobs)
}
