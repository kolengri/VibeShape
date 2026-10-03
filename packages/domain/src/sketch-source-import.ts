import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { sketchEntityIdSchema } from "./identifiers"
import {
  MAX_SOURCE_ASSET_BYTES,
  type SourceAsset,
  sourceAssetDigestSchema,
  sourceAssetIdSchema,
  sourceAssetOutputIdSchema,
  sourceAssetSchema,
} from "./source-assets"

const ordinal = z.number().int().nonnegative().max(1_661)
const label = z.string().min(1).max(256)
const curveSchema = z
  .object({
    sourceOrdinal: ordinal,
    sourceDirection: z.union([z.literal(1), z.literal(-1)]),
    curveId: sketchEntityIdSchema,
    pointIds: z.array(sketchEntityIdSchema).min(1).max(5),
  })
  .strict()
const pathSchema = z
  .object({
    outputId: sourceAssetOutputIdSchema,
    sourceOrdinal: ordinal,
    label: label.optional(),
    layer: label.optional(),
    closed: z.boolean(),
    pointIds: z.array(sketchEntityIdSchema).min(1).max(4_990),
    curves: z.array(curveSchema).min(1).max(1_662),
  })
  .strict()
  .superRefine((path, context) => {
    const points = new Set(path.pointIds)
    const referenced = new Set(path.curves.flatMap((curve) => curve.pointIds))
    if (points.size !== referenced.size || [...referenced].some((id) => !points.has(id)))
      context.addIssue({
        code: "custom",
        message: "Captured path points must exactly cover their curve references.",
      })
    if (
      path.curves.some(
        (curve, index) =>
          curve.sourceOrdinal !== index || new Set(curve.pointIds).size !== curve.pointIds.length,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Captured curves require ordered source ordinals and distinct point references.",
      })
  })

const unknownArray = z.custom<unknown[]>(Array.isArray)
const budgetEnvelope = z.object({ paths: unknownArray }).passthrough()
const pathBudgetEnvelope = z.object({ pointIds: unknownArray, curves: unknownArray }).passthrough()
const budgetSchema = budgetEnvelope.superRefine(({ paths }, context) => {
  if (paths.length < 1 || paths.length > 1024) {
    context.addIssue({
      code: "custom",
      message: "Imported path identities exceed the asset budget.",
    })
    return
  }
  let entities = 0
  for (const path of paths) {
    const parsed = pathBudgetEnvelope.safeParse(path)
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "Imported paths require captured entity arrays.",
      })
      return
    }
    entities += parsed.data.pointIds.length + parsed.data.curves.length
    if (entities > 4_990) {
      context.addIssue({
        code: "custom",
        message: "Imported entity captures exceed the sketch budget.",
      })
      return
    }
  }
})

/** Provenance refers to authored UUIDs; original bytes never replace edited sketch geometry. */
export const sketchSourceImportSchema = budgetSchema.pipe(
  z
    .object({
      schemaVersion: z.literal(0),
      assetId: sourceAssetIdSchema,
      digest: sourceAssetDigestSchema,
      byteLength: z.number().int().positive().max(MAX_SOURCE_ASSET_BYTES),
      format: z.enum(["dxf", "svg"]),
      normalization: sourceAssetSchema.shape.normalization,
      parserPolicyVersion: z.literal(1),
      paths: z.array(pathSchema).min(1).max(1024),
    })
    .strict()
    .superRefine((source, context) => {
      const outputs = source.paths.map(({ outputId }) => outputId)
      const entities = source.paths.flatMap((path) => [
        ...path.pointIds,
        ...path.curves.map(({ curveId }) => curveId),
      ])
      if (source.paths.some((path, index) => path.sourceOrdinal !== index))
        context.addIssue({
          code: "custom",
          message: "Imported paths require ordered source ordinals.",
        })
      if (new Set([...outputs, ...entities]).size !== outputs.length + entities.length)
        context.addIssue({
          code: "custom",
          message: "Imported outputs and captured entities require exclusive identities.",
        })
    }),
)
export type SketchSourceImport = z.infer<typeof sketchSourceImportSchema>

type SourceImportedSketch = {
  sourceImport?: SketchSourceImport | undefined
  entities: readonly { id: string; type: string }[]
}
const curveTypes = new Set(["line", "arc", "circle", "ellipse", "elliptical-arc", "cubic-bezier"])
function sourceReferencesExist(sketch: SourceImportedSketch): boolean {
  const source = sketch.sourceImport
  if (!source) return true
  const entities = new Map(sketch.entities.map(({ id, type }) => [id, type]))
  return source.paths.every(
    (path) =>
      !entities.has(path.outputId) &&
      path.pointIds.every((id) => entities.get(id) === "point") &&
      path.curves.every((curve) => curveTypes.has(entities.get(curve.curveId) ?? "")),
  )
}
export function validateSketchSourceImportReferences(
  sketch: SourceImportedSketch,
  context: z.RefinementCtx,
) {
  if (!sourceReferencesExist(sketch))
    context.addIssue({
      code: "custom",
      path: ["sourceImport"],
      message: "Imported source captures require existing typed curve and point identities.",
    })
}

/** Topology replacement explicitly detaches the entire immutable source binding. */
export function retainSketchSourceImport<T extends SourceImportedSketch>(
  sketch: T,
): T | Omit<T, "sourceImport"> {
  if (sourceReferencesExist(sketch)) return sketch
  const { sourceImport: _source, ...authored } = sketch
  return authored
}

export function validateSketchSourceImportAssets(snapshot: {
  sketches: readonly { sourceImport?: SketchSourceImport | undefined }[]
  assets: readonly SourceAsset[]
}): string | null {
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]))
  for (const sketch of snapshot.sketches) {
    const source = sketch.sourceImport
    if (!source) continue
    const asset = assets.get(source.assetId)
    if (asset?.representation !== "sketch-curves")
      return "An imported sketch requires its sketch-curve source descriptor."
    if (
      asset.digest !== source.digest ||
      asset.byteLength !== source.byteLength ||
      asset.format !== source.format ||
      canonicalJson(asset.normalization) !== canonicalJson(source.normalization) ||
      canonicalJson(asset.outputs) !== canonicalJson(source.paths.map(({ outputId }) => outputId))
    )
      return "Imported sketch provenance must match its immutable source descriptor and ordered outputs."
  }
  return null
}
