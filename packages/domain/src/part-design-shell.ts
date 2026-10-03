import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import { bodyFaceRefSchema } from "./body-topology-reference"
import { canonicalJson } from "./canonical-json"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const shellThicknessSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= 100_000,
  "Shell thickness must be positive and at most 100,000 mm.",
)
export const shellFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    thickness: shellThicknessSchema,
    direction: z.enum(["inward", "outward"]),
    sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    openings: z.array(bodyFaceRefSchema).min(1).max(64),
  })
  .strict()
  .superRefine((parameters, context) => {
    const identities = new Set<string>()
    for (const [index, opening] of parameters.openings.entries()) {
      if (
        opening.featureId !== parameters.targetBody.featureId ||
        opening.outputRole !== parameters.targetBody.outputRole
      ) {
        context.addIssue({
          code: "custom",
          path: ["openings", index],
          message: "Shell openings must belong to the exact target body.",
        })
      }
      const identity = canonicalJson(opening)
      if (identities.has(identity))
        context.addIssue({
          code: "custom",
          path: ["openings", index],
          message: "Shell openings must be unique.",
        })
      identities.add(identity)
    }
  })
export type ShellFeatureParameters = Readonly<z.infer<typeof shellFeatureParametersSchema>>
export const shellFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.shell",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})
export function readShellFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): ShellFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(shellFeatureType.type)) return null
  const parsed = shellFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export const shellFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: shellFeatureType.type,
  parametersSchema: shellFeatureParametersSchema,
  resolveParameters(parameters, variables) {
    const parsed = shellFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const resolved = resolveQuantityExpression(parsed.data.thickness, variables)
    const thickness = resolved.ok ? shellThicknessSchema.safeParse(resolved.quantity) : null
    if (!resolved.ok || !thickness?.success)
      return {
        ok: false,
        diagnostic: {
          code: "invalid-shell-thickness",
          message: "Shell thickness expression is invalid.",
          issues: [
            { path: "thickness", message: "Thickness must resolve to a positive bounded length." },
          ],
        },
      }
    return { ok: true, parameters: { ...parsed.data, thickness: thickness.data } }
  },
  validateFeature(feature) {
    const parameters = shellFeatureParametersSchema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Shell must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const parsed = shellFeatureParametersSchema.parse(parameters)
    return {
      thickness: parsed.thickness.value,
      direction: parsed.direction,
      sourceContentHash: parsed.sourceContentHash,
      openings: parsed.openings
        .map(({ featureId: _featureId, ...reference }) => reference)
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    }
  },
}
