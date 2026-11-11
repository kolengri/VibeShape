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
/** Version 2 offsets a planar or curved face along its outward normals. */
export const pressPullFeatureParametersV2Schema = z
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
  })
/** Version 1 remains planar-only so saved documents keep their original evaluation contract. */
export const pressPullFeatureParametersSchema = pressPullFeatureParametersV2Schema.superRefine(
  (parameters, context) => {
    if (parameters.face.signature.geometryClass !== "PLANE")
      context.addIssue({
        code: "custom",
        path: ["face"],
        message: "Press Pull supports planar faces only.",
      })
  },
)
export type PressPullFeatureParameters = Readonly<
  z.infer<typeof pressPullFeatureParametersV2Schema>
>
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
export const pressPullFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  ...pressPullFeatureType,
  type: { ...pressPullFeatureType.type, schemaVersion: 2 },
})
/**
 * The version a new Press Pull is authored with: planar faces keep version 1 (its prism path and
 * catalog advice), curved faces need version 2. An update keeps its saved version instead.
 */
export function pressPullFeatureTypeForFace(
  face: Pick<PressPullFeatureParameters["face"], "signature">,
) {
  return face.signature.geometryClass === "PLANE"
    ? pressPullFeatureType.type
    : pressPullFeatureTypeV2.type
}
function pressPullSchemaFor(feature: Pick<FeatureRecord, "type">) {
  const key = featureTypeKey(feature.type)
  if (key === featureTypeKey(pressPullFeatureType.type)) return pressPullFeatureParametersSchema
  if (key === featureTypeKey(pressPullFeatureTypeV2.type)) return pressPullFeatureParametersV2Schema
  return null
}
export function readPressPullFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): PressPullFeatureParameters | null {
  const parsed = pressPullSchemaFor(feature)?.safeParse(feature.parameters)
  return parsed?.success ? parsed.data : null
}
function createPressPullFeatureTypeHandler(
  type: typeof pressPullFeatureType.type,
  parametersSchema: typeof pressPullFeatureParametersV2Schema,
): TrustedFeatureTypeHandler {
  return {
    type,
    parametersSchema,
    validateFeature(feature) {
      const parameters = parametersSchema.parse(feature.parameters)
      return parameters.targetBody.featureId === feature.dependencies[0]
        ? []
        : [
            {
              path: "parameters.targetBody",
              message: "Press Pull must target its sole dependency.",
            },
          ]
    },
    resolveParameters(parameters, variables) {
      const parsed = parametersSchema.safeParse(parameters)
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
      const parsed = parametersSchema.parse(parameters)
      const { featureId: _featureId, ...face } = parsed.face
      return { distance: parsed.distance.value, sourceContentHash: parsed.sourceContentHash, face }
    },
  }
}
export const pressPullFeatureTypeHandler = createPressPullFeatureTypeHandler(
  pressPullFeatureType.type,
  pressPullFeatureParametersSchema,
)
export const pressPullFeatureTypeHandlerV2 = createPressPullFeatureTypeHandler(
  pressPullFeatureTypeV2.type,
  pressPullFeatureParametersV2Schema,
)
