import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { patternCountSchema, patternFeatureType, resolvePatternField } from "./part-design-pattern"
import { sketchPathSelectorSchema } from "./sketch-path-selector"
import { lengthQuantitySchema } from "./units"

/** Sketch-owned path supports plus the exact target body. */
export const MAX_PATH_PATTERN_DEPENDENCIES = 9
const WORKSPACE_LIMIT_MM = 100_000

export const pathPatternDistanceSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= WORKSPACE_LIMIT_MM,
  "Path pattern spacing must be positive and within 100,000 mm.",
)
export const pathPatternStartOffsetSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= 0 && value <= WORKSPACE_LIMIT_MM,
  "Path pattern start offset must be non-negative and within 100,000 mm.",
)
const pathPatternSpacingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("equal") }).strict(),
  z.object({ mode: z.literal("fixed"), distance: pathPatternDistanceSchema }).strict(),
])

/**
 * Instance zero is the seed at its current position. The path point at `startOffset` is the
 * reference that maps to every later path station; path length bounds are checked by the kernel.
 */
export const patternFeatureParametersV3Schema = z
  .object({
    targetBody: bodyReferenceSchema,
    kind: z.literal("path"),
    count: patternCountSchema,
    path: sketchPathSelectorSchema,
    spacing: pathPatternSpacingSchema,
    startOffset: pathPatternStartOffsetSchema,
    orientation: z.enum(["translate", "follow"]),
    reverse: z.boolean(),
  })
  .strict()
  .refine(
    ({ count, spacing, startOffset }) =>
      spacing.mode === "equal" ||
      startOffset.value + (count.value - 1) * spacing.distance.value <= WORKSPACE_LIMIT_MM,
    {
      message: "Path pattern total travel must remain within 100,000 mm.",
      path: ["spacing", "distance"],
    },
  )
export type PatternFeatureParametersV3 = Readonly<z.infer<typeof patternFeatureParametersV3Schema>>

export const patternFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  ...patternFeatureType,
  type: { ...patternFeatureType.type, schemaVersion: 3 },
  dependencies: { min: 1, max: MAX_PATH_PATTERN_DEPENDENCIES },
  references: { min: 0, max: 0 },
})

export function readPatternFeatureParametersV3(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): PatternFeatureParametersV3 | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(patternFeatureTypeV3.type)) return null
  return patternFeatureParametersV3Schema.safeParse(feature.parameters).data ?? null
}

type Variables = Parameters<NonNullable<TrustedFeatureTypeHandler["resolveParameters"]>>[1]

function resolveSpacing(parameters: PatternFeatureParametersV3, variables: Variables) {
  if (parameters.spacing.mode === "equal") return { ok: true as const, spacing: parameters.spacing }
  const distance = resolvePatternField(
    parameters.spacing.distance,
    pathPatternDistanceSchema,
    "spacing.distance",
    variables,
  )
  return distance.ok
    ? { ok: true as const, spacing: { mode: "fixed" as const, distance: distance.quantity } }
    : distance
}

export const patternFeatureTypeHandlerV3: TrustedFeatureTypeHandler = {
  type: patternFeatureTypeV3.type,
  parametersSchema: patternFeatureParametersV3Schema,
  resolveParameters(parameters, variables) {
    const parsed = patternFeatureParametersV3Schema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const count = resolvePatternField(parsed.data.count, patternCountSchema, "count", variables)
    if (!count.ok) return count
    const startOffset = resolvePatternField(
      parsed.data.startOffset,
      pathPatternStartOffsetSchema,
      "startOffset",
      variables,
    )
    if (!startOffset.ok) return startOffset
    const spacing = resolveSpacing(parsed.data, variables)
    if (!spacing.ok) return spacing
    const result = patternFeatureParametersV3Schema.safeParse({
      ...parsed.data,
      count: count.quantity,
      startOffset: startOffset.quantity,
      spacing: spacing.spacing,
    })
    return result.success
      ? { ok: true, parameters: result.data }
      : {
          ok: false,
          diagnostic: {
            code: "invalid-pattern-extent",
            message: "The resolved pattern exceeds its parameter bounds.",
            issues: result.error.issues.map(({ path, message }) => ({
              path: path.join("."),
              message,
            })),
          },
        }
  },
  validateFeature(feature) {
    const { targetBody } = patternFeatureParametersV3Schema.parse(feature.parameters)
    return feature.dependencies[0] === targetBody.featureId
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Path pattern must list its target body as the first dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const parsed = patternFeatureParametersV3Schema.parse(parameters)
    return {
      kind: parsed.kind,
      count: parsed.count.value,
      path: parsed.path,
      spacing:
        parsed.spacing.mode === "equal"
          ? { mode: "equal" }
          : { mode: "fixed", distance: parsed.spacing.distance.value },
      startOffset: parsed.startOffset.value,
      orientation: parsed.orientation,
      reverse: parsed.reverse,
    }
  },
}
