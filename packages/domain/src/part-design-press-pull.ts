import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import { bodyFaceRefSchema } from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const pressPullDistanceSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) >= 0.001 && Math.abs(value) <= 100_000,
  "Press Pull distance must have a magnitude between 0.001 and 100000 mm.",
)
export const pressPullFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    face: bodyFaceRefSchema,
    sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    distance: pressPullDistanceSchema,
  })
  .strict()
  .superRefine((parameters, context) => {
    if (
      parameters.face.featureId !== parameters.targetBody.featureId ||
      parameters.face.outputRole !== parameters.targetBody.outputRole
    )
      context.addIssue({
        code: "custom",
        path: ["face"],
        message: "Press Pull face must belong to the exact target body.",
      })
    if (parameters.face.signature.geometryClass !== "PLANE")
      context.addIssue({
        code: "custom",
        path: ["face"],
        message: "Press Pull supports planar faces only.",
      })
  })
export type PressPullFeatureParameters = Readonly<z.infer<typeof pressPullFeatureParametersSchema>>
export const pressPullFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.press-pull",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})
export function readPressPullFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): PressPullFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(pressPullFeatureType.type)) return null
  const parsed = pressPullFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export const pressPullFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: pressPullFeatureType.type,
  parametersSchema: pressPullFeatureParametersSchema,
  validateFeature(feature) {
    const parameters = pressPullFeatureParametersSchema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [{ path: "parameters.targetBody", message: "Press Pull must target its sole dependency." }]
  },
  resolveParameters(parameters, variables) {
    const parsed = pressPullFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const resolved = resolveQuantityExpression(parsed.data.distance, variables)
    const distance = resolved.ok ? pressPullDistanceSchema.safeParse(resolved.quantity) : null
    if (!distance?.success)
      return {
        ok: false,
        diagnostic: {
          code: "invalid-press-pull-distance",
          message: "Press Pull distance expression is invalid.",
          issues: [
            { path: "distance", message: "Distance must resolve to a nonzero bounded length." },
          ],
        },
      }
    return { ok: true, parameters: { ...parsed.data, distance: distance.data } }
  },
  contentParameters(parameters) {
    const parsed = pressPullFeatureParametersSchema.parse(parameters)
    const { featureId: _featureId, ...face } = parsed.face
    return { distance: parsed.distance.value, sourceContentHash: parsed.sourceContentHash, face }
  },
}
