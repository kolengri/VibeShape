import { z } from "zod"
import { bodyFaceRefSchema, bodyTopoRefSchema } from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { type FeatureId, featureIdSchema } from "./identifiers"

const coordinate = z.number().finite().min(-100_000).max(100_000)
export const referenceOriginSchema = z.tuple([coordinate, coordinate, coordinate])
const component = z.number().finite().min(-1).max(1)
export const referenceDirectionSchema = z
  .tuple([component, component, component])
  .refine(
    (direction) => Math.abs(Math.hypot(...direction) - 1) <= 1e-8,
    "Reference directions must be normalized.",
  )
export const referencePlaneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("origin-plane"), plane: z.enum(["XY", "XZ", "YZ"]) }).strict(),
  z.object({ kind: z.literal("datum-plane"), featureId: featureIdSchema }).strict(),
  z
    .object({
      kind: z.literal("planar-face"),
      reference: bodyFaceRefSchema.refine(
        ({ signature }) =>
          signature.geometryClass === "PLANE" &&
          signature.directionMode === "oriented" &&
          Boolean(signature.direction),
        "Plane support requires an oriented planar face.",
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit-plane"),
      origin: referenceOriginSchema,
      normal: referenceDirectionSchema,
    })
    .strict(),
])
export type ReferencePlane = Readonly<z.infer<typeof referencePlaneSchema>>
export const referenceAxisSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("origin-axis"), axis: z.enum(["X", "Y", "Z"]) }).strict(),
  z
    .object({
      kind: z.literal("datum-axis"),
      featureId: featureIdSchema,
      axis: z.enum(["x", "y", "normal"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("linear-edge"),
      reference: bodyTopoRefSchema.refine(
        ({ kind, signature }) =>
          kind === "edge" && signature.geometryClass === "LINE" && Boolean(signature.direction),
        "Axis support requires a stable straight edge with an authored direction.",
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit-axis"),
      origin: referenceOriginSchema,
      direction: referenceDirectionSchema,
    })
    .strict(),
])
export type ReferenceAxis = Readonly<z.infer<typeof referenceAxisSchema>>
type ReferenceSupport = ReferencePlane | ReferenceAxis
export function referenceFrameSupportFeatureId(support: ReferenceSupport): FeatureId | null {
  if ("featureId" in support) return support.featureId
  return "reference" in support ? support.reference.featureId : null
}
export function referenceFrameDependencyIds(
  targetFeatureId: FeatureId,
  support: ReferenceSupport,
): readonly FeatureId[] {
  const owner = referenceFrameSupportFeatureId(support)
  return owner && owner !== targetFeatureId ? [targetFeatureId, owner] : [targetFeatureId]
}
export function referenceFrameTopoReferences(
  _support: ReferenceSupport,
): FeatureRecord["references"] {
  // Body-bound topology resolves against its exact output role, never the producer aggregate.
  return []
}
export function referenceFrameInvariant(
  feature: FeatureRecord,
  targetFeatureId: FeatureId,
  support: ReferenceSupport,
) {
  const dependencies = referenceFrameDependencyIds(targetFeatureId, support)
  const references = referenceFrameTopoReferences(support)
  return JSON.stringify(feature.dependencies) === JSON.stringify(dependencies) &&
    JSON.stringify(feature.references) === JSON.stringify(references)
    ? []
    : [
        {
          path: "dependencies",
          message:
            "Reference-frame features require ordered target and support dependencies with body-bound topology stored in parameters.",
        },
      ]
}
