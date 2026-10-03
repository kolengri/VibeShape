import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const SPLIT_NEGATIVE_OUTPUT_ROLE = "split.negative"
export const SPLIT_POSITIVE_OUTPUT_ROLE = "split.positive"
const offsetSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 100_000,
  "Split plane offset must remain within 100,000 mm.",
)
export const splitFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    plane: z.enum(["XY", "XZ", "YZ"]),
    offset: offsetSchema,
  })
  .strict()
export type SplitFeatureParameters = Readonly<z.infer<typeof splitFeatureParametersSchema>>
export const splitFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.split",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})
export function readSplitFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): SplitFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(splitFeatureType.type)) return null
  const parsed = splitFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export const splitFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: splitFeatureType.type,
  parametersSchema: splitFeatureParametersSchema,
  resolveParameters(parameters, variables) {
    const parsed = splitFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const expression = resolveQuantityExpression(parsed.data.offset, variables)
    const offset = expression.ok ? offsetSchema.safeParse(expression.quantity) : null
    if (!expression.ok || !offset?.success)
      return {
        ok: false,
        diagnostic: {
          code: expression.ok ? "invalid-split-offset" : expression.diagnostic.code,
          message: "The split plane offset expression is invalid.",
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
    const parameters = splitFeatureParametersSchema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Split must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const { plane, offset } = splitFeatureParametersSchema.parse(parameters)
    // Exact input hash and role own body identity; document UUIDs are excluded here.
    return { plane, offset: offset.value }
  },
}
