import { canonicalJson } from "./canonical-json"
import type { DocumentAuthoritySnapshot } from "./document-v2"
import type { DocumentAuthorityEvent } from "./document-v2-command-schemas"
import { validateSketchSourceImportAssets } from "./sketch-source-import"
import { type SourceAsset, sourceAssetsSchema } from "./source-assets"

function snapshotAssets(source: DocumentAuthoritySnapshot): readonly SourceAsset[] {
  if (source.schemaVersion !== 4 && source.schemaVersion !== 5 && source.schemaVersion !== 6)
    return []
  const sourceIssue = validateSketchSourceImportAssets(source)
  if (sourceIssue) throw new Error(sourceIssue)
  const pinned =
    source.assembly?.definitions.flatMap((definition) =>
      definition.pinnedModels.flatMap(({ assets }) => assets),
    ) ?? []
  return [...source.assets, ...pinned]
}
export function documentEventSourceAssets(event: DocumentAuthorityEvent): readonly SourceAsset[] {
  if (event.schemaVersion === 5 || event.schemaVersion === 6)
    return event.type === "org.vibeshape.document.authored-changed"
      ? documentEventSourceAssets(event.authoredEvent)
      : []
  if (event.schemaVersion !== 4) return []
  if (event.type === "org.vibeshape.document.source-assets-added") return event.assets
  if (event.type !== "org.vibeshape.document.assembly-changed") return []
  return event.changes.flatMap((change) =>
    "definition" in change ? change.definition.pinnedModels.flatMap(({ assets }) => assets) : [],
  )
}

/** Includes assets retained only in Undo history; immutable bytes outlive the current snapshot. */
export function documentSourceAssetClosure(
  seed: DocumentAuthoritySnapshot | null,
  events: readonly DocumentAuthorityEvent[],
  snapshot: DocumentAuthoritySnapshot,
): readonly SourceAsset[] {
  const byId = new Map<string, SourceAsset>()
  const remember = (assets: readonly SourceAsset[]) => {
    for (const asset of assets) {
      const old = byId.get(asset.id)
      if (old && canonicalJson(old) !== canonicalJson(asset))
        throw new Error("A journal changes an immutable source asset descriptor.")
      byId.set(asset.id, asset)
    }
  }
  if (seed) remember(snapshotAssets(seed))
  for (const event of events) remember(documentEventSourceAssets(event))
  remember(snapshotAssets(snapshot))
  return sourceAssetsSchema.parse([...byId.values()])
}
