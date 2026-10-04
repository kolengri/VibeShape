import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const mirrorFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    plane: z.enum(["XY", "XZ", "YZ"]),
  })
  .strict()
export type MirrorFeatureParameters = Readonly<z.infer<typeof mirrorFeatureParametersSchema>>
export const mirrorFeatureParametersV2Schema = mirrorFeatureParametersSchema
  .extend({
    offset: lengthQuantitySchema.refine(
      ({ value }) => Math.abs(value) <= 100_000,
      "Mirror plane offset must remain within 100,000 mm.",
    ),
    preserveSource: z.boolean(),
  })
  .strict()
export type MirrorFeatureParametersV2 = Readonly<z.infer<typeof mirrorFeatureParametersV2Schema>>
export const mirrorFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.mirror",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})
export const mirrorFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  ...mirrorFeatureType,
  type: { ...mirrorFeatureType.type, schemaVersion: 2 },
})
export function readMirrorFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): MirrorFeatureParameters | MirrorFeatureParametersV2 | null {
  const key = featureTypeKey(feature.type)
  const schema =
    key === featureTypeKey(mirrorFeatureType.type)
      ? mirrorFeatureParametersSchema
      : key === featureTypeKey(mirrorFeatureTypeV2.type)
        ? mirrorFeatureParametersV2Schema
        : null
  if (!schema) return null
  const parsed = schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export function mirrorPreservesSource(feature: Pick<FeatureRecord, "type" | "parameters">) {
  if (featureTypeKey(feature.type) !== featureTypeKey(mirrorFeatureTypeV2.type)) return false
  const parameters = mirrorFeatureParametersV2Schema.safeParse(feature.parameters)
  return parameters.success && parameters.data.preserveSource
}
export const mirrorFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: mirrorFeatureType.type,
  parametersSchema: mirrorFeatureParametersSchema,
  validateFeature(feature) {
    const parameters = mirrorFeatureParametersSchema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Mirror must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    // The exact body hash and role own source identity; document UUIDs do not enter parameters.
    return { plane: mirrorFeatureParametersSchema.parse(parameters).plane }
  },
}
export const mirrorFeatureTypeHandlerV2: TrustedFeatureTypeHandler = {
  type: mirrorFeatureTypeV2.type,
  parametersSchema: mirrorFeatureParametersV2Schema,
  resolveParameters(parameters, variables) {
    const parsed = mirrorFeatureParametersV2Schema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const expression = resolveQuantityExpression(parsed.data.offset, variables)
    const offset = expression.ok
      ? mirrorFeatureParametersV2Schema.shape.offset.safeParse(expression.quantity)
      : null
    if (!expression.ok || !offset?.success)
      return {
        ok: false,
        diagnostic: {
          code: expression.ok ? "invalid-mirror-offset" : expression.diagnostic.code,
          message: "The mirror plane offset expression is invalid.",
          issues: [
            {
              path: "offset",
              message: expression.ok
                ? "Offset must resolve to a length within 100,000 mm."
                : expression.diagnostic.message,
            },
          ],
        },
      }
    return { ok: true, parameters: { ...parsed.data, offset: offset.data } }
  },
  validateFeature(feature) {
    const parameters = mirrorFeatureParametersV2Schema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Mirror must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const { plane, offset, preserveSource } = mirrorFeatureParametersV2Schema.parse(parameters)
    return { plane, offset: offset.value, preserveSource }
  },
}
