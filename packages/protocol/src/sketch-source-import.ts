import { z } from "zod"

const sketchEntityIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const sourceAssetIdSchema = sketchEntityIdSchema
const sourceAssetOutputIdSchema = sketchEntityIdSchema
const sourceAssetDigestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const normalizationSchema = z
  .object({
    sourceUnit: z.enum([
      "micrometer",
      "millimeter",
      "centimeter",
      "meter",
      "inch",
      "foot",
      "unitless",
    ]),
    scaleToMillimeters: z.number().finite().positive().max(1_000_000),
    normalizedUnit: z.literal("millimeter"),
  })
  .strict()
const MAX_SOURCE_ASSET_BYTES = 32 * 1024 * 1024

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
export const sketchSourceImportWireSchema = budgetSchema.pipe(
  z
    .object({
      schemaVersion: z.literal(0),
      assetId: sourceAssetIdSchema,
      digest: sourceAssetDigestSchema,
      byteLength: z.number().int().positive().max(MAX_SOURCE_ASSET_BYTES),
      format: z.enum(["dxf", "svg"]),
      normalization: normalizationSchema,
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
export type SketchSourceImportWire = z.infer<typeof sketchSourceImportWireSchema>

type SourceImportedSketch = {
  sourceImport?: SketchSourceImportWire | undefined
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
export function validateSketchSourceImportWireReferences(
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
