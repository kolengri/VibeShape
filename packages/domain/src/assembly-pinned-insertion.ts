import type { CapturedAssemblyMutation } from "./assembly-authority"
import { canonicalJson } from "./canonical-json"
import type { DocumentSnapshotV4 } from "./document-v4"
import { type SourceAsset, sourceAssetsSchema } from "./source-assets"

function sourceIdentities(asset: SourceAsset) {
  return [asset.id, ...asset.outputs]
}
function addDescriptor(
  byId: Map<string, SourceAsset>,
  identities: Set<string>,
  documentIds: ReadonlySet<string>,
  asset: SourceAsset,
) {
  const previous = byId.get(asset.id)
  if (previous) {
    if (canonicalJson(previous) !== canonicalJson(asset))
      throw new Error("A frozen insertion cannot change an immutable document source descriptor.")
    return
  }
  const ids = sourceIdentities(asset)
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => identities.has(id) || documentIds.has(id))
  )
    throw new Error("Frozen source asset and output identities collide with document authority.")
  byId.set(asset.id, asset)
  for (const id of ids) identities.add(id)
}
/** Foreign producers stay isolated in their frozen models; descriptors join the document's own authority. */
export function mergeCapturedAssemblyAssets(
  authority: DocumentSnapshotV4,
  changes: readonly CapturedAssemblyMutation[],
): readonly SourceAsset[] {
  const documentIds = new Set<string>([
    authority.id,
    ...authority.features.map(({ id }) => id),
    ...authority.sketches.map(({ id }) => id),
    ...authority.parts.map(({ id }) => id),
    ...authority.folders.map(({ id }) => id),
  ])
  const byId = new Map<string, SourceAsset>(authority.assets.map((asset) => [asset.id, asset]))
  const identities = new Set(authority.assets.flatMap(sourceIdentities))
  for (const change of changes) {
    if (!("definition" in change)) continue
    if (documentIds.has(change.definition.id))
      throw new Error("An assembly definition must not reuse a live document record identity.")
    for (const pinned of change.definition.pinnedModels)
      for (const asset of pinned.assets) addDescriptor(byId, identities, documentIds, asset)
  }
  return sourceAssetsSchema.parse([...byId.values()])
}
