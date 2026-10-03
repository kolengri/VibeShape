import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { FeatureParameterResolution, TrustedFeatureTypeHandler } from "./feature-type-registry"
import { angleQuantitySchema, lengthQuantitySchema, type Quantity } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

const translationSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 100_000,
  "Placement translation must remain within 100,000 mm on each world axis.",
)
const rotationSchema = angleQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 2 * Math.PI,
  "Placement rotation must remain within one revolution on each world axis.",
)

export const placementFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    translation: z
      .object({ x: translationSchema, y: translationSchema, z: translationSchema })
      .strict(),
    rotation: z.object({ x: rotationSchema, y: rotationSchema, z: rotationSchema }).strict(),
  })
  .strict()

export type PlacementFeatureParameters = Readonly<z.infer<typeof placementFeatureParametersSchema>>

export const placementFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.placement",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export function readPlacementFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): PlacementFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(placementFeatureType.type)) return null
  const parsed = placementFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>
type QuantityVector = Readonly<{ x: Quantity; y: Quantity; z: Quantity }>

function resolveVector(
  vector: QuantityVector,
  schema: z.ZodType<Quantity>,
  prefix: string,
  variables: VariableValues,
) {
  const resolved = { ...vector }
  for (const axis of ["x", "y", "z"] as const) {
    const expression = resolveQuantityExpression(vector[axis], variables)
    const parsed = expression.ok ? schema.safeParse(expression.quantity) : null
    if (!expression.ok || !parsed?.success) {
      return {
        ok: false as const,
        diagnostic: {
          code: expression.ok ? "invalid-placement-bound" : expression.diagnostic.code,
          message: "A placement parameter expression is invalid.",
          issues: [
            {
              path: `${prefix}.${axis}`,
              message: expression.ok
                ? "The expression must resolve to a bounded value of the required dimension."
                : expression.diagnostic.message,
            },
          ],
        },
      }
    }
    resolved[axis] = parsed.data
  }
  return { ok: true as const, vector: resolved }
}

function resolvePlacementParameters(
  parameters: unknown,
  variables: VariableValues,
): FeatureParameterResolution {
  const parsed = placementFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true, parameters }
  const translation = resolveVector(
    parsed.data.translation,
    translationSchema,
    "translation",
    variables,
  )
  if (!translation.ok) return translation
  const rotation = resolveVector(parsed.data.rotation, rotationSchema, "rotation", variables)
  if (!rotation.ok) return rotation
  return {
    ok: true,
    parameters: placementFeatureParametersSchema.parse({
      targetBody: parsed.data.targetBody,
      translation: translation.vector,
      rotation: rotation.vector,
    }),
  }
}

export const placementFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: placementFeatureType.type,
  parametersSchema: placementFeatureParametersSchema,
  resolveParameters: resolvePlacementParameters,
  validateFeature(feature) {
    const parameters = placementFeatureParametersSchema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Placement must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const { translation, rotation } = placementFeatureParametersSchema.parse(parameters)
    // Body UUIDs are projected into the canonical input hash/role slot, not parameter identity.
    return {
      translation: [translation.x.value, translation.y.value, translation.z.value],
      rotation: [rotation.x.value, rotation.y.value, rotation.z.value],
    }
  },
}
