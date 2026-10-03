import type { PlanarImportAuthoring } from "./planar-import-authoring"
import { type SketchRecord, sketchRecordSchema } from "./sketch"
import { sketchSourceImportSchema, validateSketchSourceImportAssets } from "./sketch-source-import"
import { type SourceAsset, sourceAssetSchema } from "./source-assets"

/** The asset's ordered output UUIDs capture path identity once, independently of parser inspection IDs. */
export function attachSketchSourceImport(
  sketchInput: SketchRecord,
  assetInput: SourceAsset,
  captures: PlanarImportAuthoring["paths"],
): SketchRecord {
  const sketch = sketchRecordSchema.parse(sketchInput)
  const asset = sourceAssetSchema.parse(assetInput)
  if (sketch.sourceImport) throw new Error("The sketch already has captured source provenance.")
  if (captures.length !== asset.outputs.length)
    throw new Error("Every imported path requires exactly one ordered source output identity.")
  const sourceImport = sketchSourceImportSchema.parse({
    schemaVersion: 0,
    assetId: asset.id,
    digest: asset.digest,
    byteLength: asset.byteLength,
    format: asset.format,
    normalization: asset.normalization,
    parserPolicyVersion: 1,
    paths: captures.map((path, index) => ({
      outputId: asset.outputs[index],
      sourceOrdinal: path.sourcePathOrdinal,
      ...(path.label ? { label: path.label } : {}),
      ...(path.layer ? { layer: path.layer } : {}),
      closed: path.closed,
      pointIds: path.pointIds,
      curves: path.curves.map((curve) => ({
        sourceOrdinal: curve.sourceCurveOrdinal,
        sourceDirection: curve.sourceDirection,
        curveId: curve.curveId,
        pointIds: curve.pointIds,
      })),
    })),
  })
  const attached = sketchRecordSchema.parse({ ...sketch, sourceImport })
  const issue = validateSketchSourceImportAssets({ sketches: [attached], assets: [asset] })
  if (issue) throw new Error(issue)
  return attached
}

export function detachSketchSourceImport(sketch: SketchRecord): SketchRecord {
  const { sourceImport: _source, ...authored } = sketchRecordSchema.parse(sketch)
  return sketchRecordSchema.parse(authored)
}
