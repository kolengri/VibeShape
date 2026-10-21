import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { documentIdSchema, draftIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { bodyTopoRefSchema } from "@vibeshape/domain/model-body-topology"
import { topologySignatureSchema } from "@vibeshape/domain/topology"
import { angleQuantitySchema, lengthQuantitySchema } from "@vibeshape/domain/units"
import { z } from "zod"
import { serializedQueryBytes } from "./query-byte-budget"

export const measurementPointKindSchema = z.enum(["centroid", "start", "middle", "end", "center"])
const targetShape = {
  reference: bodyTopoRefSchema,
  pointKind: measurementPointKindSchema.default("centroid"),
}
const targetsSchema = z.array(z.object(targetShape).strict()).min(1).max(2)

export const measurementToolInputs = {
  measure_model: z.discriminatedUnion("source", [
    z
      .object({ source: z.literal("model"), revision: revisionSchema, targets: targetsSchema })
      .strict(),
    z
      .object({
        source: z.literal("draft"),
        draftId: draftIdSchema,
        revision: revisionSchema,
        targets: targetsSchema,
      })
      .strict(),
  ]),
} as const

export const measurementOperations = [
  z
    .object({ tool: z.literal("measure_model"), arguments: measurementToolInputs.measure_model })
    .strict(),
] as const
export const measurementOperationSchema = measurementOperations[0]
export type MeasurementOperation = z.infer<typeof measurementOperationSchema>

const lengthMmSchema = lengthQuantitySchema.shape.value.nonnegative()
const measuredTargetSchema = z
  .object({
    ...targetShape,
    pointKind: measurementPointKindSchema,
    geometryClass: topologySignatureSchema.shape.geometryClass,
    lengthMm: lengthMmSchema.optional(),
    areaMm2: topologySignatureSchema.shape.measure.optional(),
    radiusMm: lengthMmSchema.positive().nullable(),
    diameterMm: lengthMmSchema.positive().nullable(),
    /** LINE direction or PLANE normal, in the document coordinate system. */
    direction: topologySignatureSchema.shape.direction.unwrap().nullable(),
    pointMm: topologySignatureSchema.shape.centroid,
  })
  .strict()
  .refine(
    ({ reference, lengthMm, areaMm2 }) =>
      reference.kind === "edge"
        ? lengthMm !== undefined && areaMm2 === undefined
        : areaMm2 !== undefined && lengthMm === undefined,
    "Edges report length and faces report area.",
  )

const pairSchema = z
  .object({
    /** Distance between selected exact points, never minimum shape clearance. */
    pointDistanceMm: lengthMmSchema,
    /** Acute unoriented angle between LINE directions and/or PLANE normals. */
    directionAngleRad: angleQuantitySchema.shape.value
      .min(0)
      .max(Math.PI / 2)
      .nullable(),
    /** Separation of infinite parallel supporting planes, never bounded face clearance. */
    parallelPlaneSeparationMm: lengthMmSchema.nullable(),
  })
  .strict()
const resultShape = {
  schemaVersion: z.literal(1),
  documentId: documentIdSchema,
  revision: revisionSchema,
  generation: revisionSchema,
  targets: z.array(measuredTargetSchema).min(1).max(2),
  pair: pairSchema.nullable(),
}
export const measurementViewSchema = z
  .discriminatedUnion("source", [
    z.object({ ...resultShape, source: z.literal("model") }).strict(),
    z.object({ ...resultShape, source: z.literal("draft"), draftId: draftIdSchema }).strict(),
  ])
  .refine(
    ({ targets, pair }) => (targets.length === 2) === (pair !== null),
    "Pair measurements require exactly two targets.",
  )
export type MeasurementView = z.infer<typeof measurementViewSchema>

/** Shared by local and remote transports; null means this is another tool's result. */
export function measurementResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = measurementOperationSchema.safeParse(input)
  if (!operation.success) return null
  if (serializedQueryBytes(result) > 128 * 1024) return false
  if (!result.ok) return true
  const parsed = measurementViewSchema.safeParse(result.value)
  if (!parsed.success) return false
  const request = operation.data.arguments
  const view = parsed.data
  return (
    (documentId === undefined || view.documentId === documentId) &&
    view.revision === request.revision &&
    view.source === request.source &&
    (request.source !== "draft" || (view.source === "draft" && view.draftId === request.draftId)) &&
    view.targets.length === request.targets.length &&
    view.targets.every((target, index) => {
      const requested = request.targets[index]
      return (
        requested !== undefined &&
        target.pointKind === requested.pointKind &&
        canonicalJson(target.reference) === canonicalJson(requested.reference)
      )
    })
  )
}
