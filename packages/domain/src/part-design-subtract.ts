import { z } from "zod"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { isBodyCombinationV2 } from "./part-design-body-combination"

export const booleanFeatureParametersV2Schema = z
  .object({
    operation: z.literal("subtract"),
    targetBody: bodyReferenceSchema,
    toolBody: bodyReferenceSchema,
    keepTools: z.boolean().optional(),
  })
  .strict()
  .refine(
    ({ targetBody, toolBody }) =>
      targetBody.featureId !== toolBody.featureId || targetBody.outputRole !== toolBody.outputRole,
    "Subtract requires distinct target and tool bodies.",
  )
export type BooleanFeatureParametersV2 = Readonly<z.infer<typeof booleanFeatureParametersV2Schema>>
export const booleanFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.boolean",
    schemaVersion: 2,
  },
  classification: "solid",
  dependencies: { min: 1, max: 2 },
  references: { min: 0, max: 0 },
})
export function readBooleanFeatureParametersV2(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): BooleanFeatureParametersV2 | null {
  return featureTypeKey(feature.type) === featureTypeKey(booleanFeatureTypeV2.type)
    ? (booleanFeatureParametersV2Schema.safeParse(feature.parameters).data ?? null)
    : null
}
export function booleanBodyDependencyIds(bodies: readonly BodyReference[]) {
  return [...new Set(bodies.map(({ featureId }) => featureId))]
}
export function hasCompleteBooleanBodyDependencies(feature: FeatureRecord) {
  const parameters = readBooleanFeatureParametersV2(feature)
  return (
    parameters !== null &&
    feature.references.length === 0 &&
    JSON.stringify(feature.dependencies) ===
      JSON.stringify(booleanBodyDependencyIds([parameters.targetBody, parameters.toolBody]))
  )
}
export function usesSlottedBodyInputs(feature: Pick<FeatureRecord, "type" | "parameters">) {
  return isBodyCombinationV2(feature) || readBooleanFeatureParametersV2(feature) !== null
}
export const booleanFeatureTypeHandlerV2: TrustedFeatureTypeHandler = {
  type: booleanFeatureTypeV2.type,
  parametersSchema: booleanFeatureParametersV2Schema,
  validateFeature(feature) {
    return hasCompleteBooleanBodyDependencies(feature)
      ? []
      : [
          {
            path: "dependencies",
            message:
              "Subtract requires ordered exact target and tool producer dependencies without topology references.",
          },
        ]
  },
  contentParameters(parameters) {
    const { operation } = booleanFeatureParametersV2Schema.parse(parameters)
    return { operation }
  },
}
