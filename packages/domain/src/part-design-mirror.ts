import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"

export const mirrorFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    plane: z.enum(["XY", "XZ", "YZ"]),
  })
  .strict()
export type MirrorFeatureParameters = Readonly<z.infer<typeof mirrorFeatureParametersSchema>>
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
export function readMirrorFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): MirrorFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(mirrorFeatureType.type)) return null
  const parsed = mirrorFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
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
