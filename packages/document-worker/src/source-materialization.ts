import type { DocumentSnapshot } from "@vibeshape/domain"
import { validateImportedFeatureAssets } from "@vibeshape/domain/part-design-import"
import { sourceAssetSchema } from "@vibeshape/domain/source-assets"
import type { SourceAssetMaterialization } from "@vibeshape/protocol"

/** Checks source authority on every rebuild, including when a prior geometry result is reusable. */
export async function validateRebuildSourceMaterialization(
  document: DocumentSnapshot,
  materials: readonly SourceAssetMaterialization[],
) {
  const assets = materials.map(({ asset }) => sourceAssetSchema.parse(asset))
  const invalid = validateImportedFeatureAssets({ features: document.features, assets })
  if (invalid) throw new Error(invalid)
  for (const { asset, bytes } of materials) {
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("")
    if (bytes.length !== asset.byteLength || digest !== asset.digest)
      throw new Error("Source materialization is missing or does not match its immutable digest.")
  }
}
