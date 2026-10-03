import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { FeatureParameterResolution, TrustedFeatureTypeHandler } from "./feature-type-registry"
import {
  angleQuantitySchema,
  lengthQuantitySchema,
  type Quantity,
  scalarQuantitySchema,
} from "./units"
import { resolveQuantityExpression } from "./variables"

export const patternCountSchema = scalarQuantitySchema.refine(
  ({ value }) => Number.isInteger(value) && value >= 2 && value <= 256,
  "Pattern count must be an integer between 2 and 256, including the seed instance.",
)
export const patternSpacingSchema = lengthQuantitySchema.refine(
  ({ value }) => value !== 0 && Math.abs(value) <= 100_000,
  "Linear pattern spacing must be nonzero and within 100,000 mm.",
)
export const patternAngleSchema = angleQuantitySchema.refine(
  ({ value }) => value !== 0 && Math.abs(value) <= 2 * Math.PI,
  "Circular pattern angle must be nonzero and within one revolution.",
)
const centerCoordinateSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 100_000,
  "Pattern center coordinates must remain within 100,000 mm.",
)
const commonParameters = {
  targetBody: bodyReferenceSchema,
  count: patternCountSchema,
  axis: z.enum(["X", "Y", "Z"]),
}
export const patternFeatureParametersSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...commonParameters, kind: z.literal("linear"), spacing: patternSpacingSchema })
    .strict()
    .refine(({ count, spacing }) => Math.abs((count.value - 1) * spacing.value) <= 100_000, {
      message: "Linear pattern total displacement must remain within 100,000 mm.",
      path: ["spacing"],
    }),
  z
    .object({
      ...commonParameters,
      kind: z.literal("circular"),
      angle: patternAngleSchema,
      center: z
        .object({ x: centerCoordinateSchema, y: centerCoordinateSchema, z: centerCoordinateSchema })
        .strict(),
    })
    .strict(),
])
export type PatternFeatureParameters = Readonly<z.infer<typeof patternFeatureParametersSchema>>
export const patternFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.pattern",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})
/** Semantic instance indices retain their roles through placement edits and count changes. */
export function patternInstanceOutputRole(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 255)
    throw new Error("Pattern instance index must be between 0 and 255.")
  return `pattern.instance.${index}`
}
export function patternOutputRoles(count: number): readonly string[] {
  if (!Number.isInteger(count) || count < 2 || count > 256)
    throw new Error("Pattern count must be an integer between 2 and 256.")
  return Array.from({ length: count }, (_, index) => patternInstanceOutputRole(index))
}
export function readPatternFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): PatternFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(patternFeatureType.type)) return null
  const parsed = patternFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
type VariableValues = Parameters<NonNullable<TrustedFeatureTypeHandler["resolveParameters"]>>[1]
type ResolutionFailure = Extract<FeatureParameterResolution, { ok: false }>
function resolveField<Q extends Quantity>(
  quantity: Q,
  schema: z.ZodType<Q>,
  path: string,
  variables: VariableValues,
): { ok: true; quantity: Q } | ResolutionFailure {
  const expression = resolveQuantityExpression(quantity, variables)
  const parsed = expression.ok ? schema.safeParse(expression.quantity) : null
  if (!expression.ok || !parsed?.success)
    return {
      ok: false,
      diagnostic: {
        code: expression.ok ? "invalid-pattern-parameter" : expression.diagnostic.code,
        message: "A pattern parameter expression is invalid.",
        issues: [
          {
            path,
            message: expression.ok
              ? "The expression must resolve to a bounded value of the required dimension."
              : expression.diagnostic.message,
          },
        ],
      },
    }
  return { ok: true, quantity: parsed.data }
}
function resolveCenter(
  center: Extract<PatternFeatureParameters, { kind: "circular" }>["center"],
  variables: VariableValues,
) {
  const resolved = { ...center }
  for (const axis of ["x", "y", "z"] as const) {
    const field = resolveField(center[axis], centerCoordinateSchema, `center.${axis}`, variables)
    if (!field.ok) return field
    resolved[axis] = field.quantity
  }
  return { ok: true as const, center: resolved }
}
function resolveGeometry(parameters: PatternFeatureParameters, variables: VariableValues) {
  if (parameters.kind === "linear") {
    const spacing = resolveField(parameters.spacing, patternSpacingSchema, "spacing", variables)
    return spacing.ok
      ? { ok: true as const, parameters: { ...parameters, spacing: spacing.quantity } }
      : spacing
  }
  const angle = resolveField(parameters.angle, patternAngleSchema, "angle", variables)
  if (!angle.ok) return angle
  const center = resolveCenter(parameters.center, variables)
  return center.ok
    ? {
        ok: true as const,
        parameters: { ...parameters, angle: angle.quantity, center: center.center },
      }
    : center
}
export const patternFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: patternFeatureType.type,
  parametersSchema: patternFeatureParametersSchema,
  resolveParameters(parameters, variables) {
    const parsed = patternFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const count = resolveField(parsed.data.count, patternCountSchema, "count", variables)
    if (!count.ok) return count
    const geometry = resolveGeometry({ ...parsed.data, count: count.quantity }, variables)
    if (!geometry.ok) return geometry
    const resolved = patternFeatureParametersSchema.safeParse(geometry.parameters)
    return resolved.success
      ? { ok: true, parameters: resolved.data }
      : {
          ok: false,
          diagnostic: {
            code: "invalid-pattern-extent",
            message: "The resolved pattern exceeds its parameter bounds.",
            issues: resolved.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        }
  },
  validateFeature(feature) {
    const { targetBody } = patternFeatureParametersSchema.parse(feature.parameters)
    return targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Pattern must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const parsed = patternFeatureParametersSchema.parse(parameters)
    const common = { kind: parsed.kind, count: parsed.count.value, axis: parsed.axis }
    return parsed.kind === "linear"
      ? { ...common, spacing: parsed.spacing.value }
      : {
          ...common,
          angle: parsed.angle.value,
          center: [parsed.center.x.value, parsed.center.y.value, parsed.center.z.value],
        }
  },
}
