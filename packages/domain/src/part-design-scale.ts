import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { FeatureParameterResolution, TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema, type Quantity, scalarQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

export const SCALE_MIN_FACTOR = 0.001
export const SCALE_MAX_FACTOR = 1000

export const scaleFactorSchema = scalarQuantitySchema.refine(
  ({ value }) => value >= SCALE_MIN_FACTOR && value <= SCALE_MAX_FACTOR,
  "Scale factor must be between 0.001 and 1000.",
)
export const scaleCoordinateSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 100_000,
  "Scale center coordinates must remain within 100,000 mm.",
)
export const scaleCenterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("origin") }).strict(),
  z.object({ kind: z.literal("bounding-box-center") }).strict(),
  z
    .object({
      kind: z.literal("point"),
      point: z
        .object({ x: scaleCoordinateSchema, y: scaleCoordinateSchema, z: scaleCoordinateSchema })
        .strict(),
    })
    .strict(),
])
export type ScaleCenter = Readonly<z.infer<typeof scaleCenterSchema>>

export const scaleFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    factor: scaleFactorSchema,
    center: scaleCenterSchema,
  })
  .strict()
export type ScaleFeatureParameters = Readonly<z.infer<typeof scaleFeatureParametersSchema>>

export const scaleFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.scale",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export function readScaleFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): ScaleFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(scaleFeatureType.type)) return null
  const parsed = scaleFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>

function resolveBounded<T extends Quantity>(
  quantity: T,
  schema: z.ZodType<T>,
  path: string,
  variables: VariableValues,
) {
  const expression = resolveQuantityExpression(quantity, variables)
  const parsed = expression.ok ? schema.safeParse(expression.quantity) : null
  if (expression.ok && parsed?.success) return { ok: true as const, quantity: parsed.data }
  return {
    ok: false as const,
    diagnostic: {
      code: expression.ok ? "invalid-scale-bound" : expression.diagnostic.code,
      message: "A Scale parameter expression is invalid.",
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
}

function resolveScaleCenter(
  center: ScaleCenter,
  variables: VariableValues,
): { ok: true; center: ScaleCenter } | Extract<FeatureParameterResolution, { ok: false }> {
  if (center.kind !== "point") return { ok: true, center }
  const point = { ...center.point }
  for (const axis of ["x", "y", "z"] as const) {
    const resolved = resolveBounded(
      center.point[axis],
      scaleCoordinateSchema,
      `center.point.${axis}`,
      variables,
    )
    if (!resolved.ok) return resolved
    point[axis] = resolved.quantity
  }
  return { ok: true, center: { kind: "point", point } }
}

function resolveScaleParameters(
  parameters: unknown,
  variables: VariableValues,
): FeatureParameterResolution {
  const parsed = scaleFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true, parameters }
  const factor = resolveBounded(parsed.data.factor, scaleFactorSchema, "factor", variables)
  if (!factor.ok) return factor
  const center = resolveScaleCenter(parsed.data.center, variables)
  if (!center.ok) return center
  return {
    ok: true,
    parameters: { ...parsed.data, factor: factor.quantity, center: center.center },
  }
}

export const scaleFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: scaleFeatureType.type,
  parametersSchema: scaleFeatureParametersSchema,
  resolveParameters: resolveScaleParameters,
  validateFeature(feature) {
    const parameters = scaleFeatureParametersSchema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0] &&
      feature.dependencies.length === 1
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Scale must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const { factor, center } = scaleFeatureParametersSchema.parse(parameters)
    // Body UUIDs are projected into the canonical input hash/role slot, not parameter identity.
    return {
      factor: factor.value,
      center:
        center.kind === "point"
          ? {
              kind: "point",
              point: [center.point.x.value, center.point.y.value, center.point.z.value],
            }
          : center,
    }
  },
}
