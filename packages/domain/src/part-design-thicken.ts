import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import { bodyFaceRefSchema, bodyTopoRefChecks, bodyTopoRefContent } from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const THICKEN_MAX_FACES = 256
/** Inclusive bounds in millimetres; thinner walls are below the modeling tolerance budget. */
export const THICKEN_MIN_THICKNESS = 0.001
export const THICKEN_MAX_THICKNESS = 10_000

export const thickenSides = ["outward", "inward", "symmetric"] as const
export type ThickenSide = (typeof thickenSides)[number]
export const thickenOperations = ["new", "add", "remove"] as const
export type ThickenOperation = (typeof thickenOperations)[number]

export const thickenThicknessSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= THICKEN_MIN_THICKNESS && value <= THICKEN_MAX_THICKNESS,
  "Thicken thickness must be between 0.001 and 10000 mm.",
)

export const thickenFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    faces: z.array(bodyFaceRefSchema).min(1).max(THICKEN_MAX_FACES),
    thickness: thickenThicknessSchema,
    /** Offset side relative to the outward face normals; symmetric splits the thickness. */
    side: z.enum(thickenSides),
    /** New keeps the source body; add and remove combine the thickened solid with it. */
    operation: z.enum(thickenOperations),
  })
  .strict()
  .superRefine((parameters, context) => {
    const { distinct } = bodyTopoRefChecks(
      parameters.targetBody,
      "Thicken faces must belong to the exact target body.",
      (path, message) => context.addIssue({ code: "custom", path, message }),
    )
    const check = distinct("Thicken faces must be unique.")
    for (const [index, face] of parameters.faces.entries()) check(face, ["faces", index])
  })
export type ThickenFeatureParameters = Readonly<z.infer<typeof thickenFeatureParametersSchema>>

export const thickenFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.thicken",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export function readThickenFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): ThickenFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(thickenFeatureType.type)) return null
  const parsed = thickenFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

/** A New Thicken adds a separate body and leaves its source body visible and unconsumed. */
export function thickenPreservesSource(feature: Pick<FeatureRecord, "type" | "parameters">) {
  return readThickenFeatureParameters(feature)?.operation === "new"
}

export const thickenFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: thickenFeatureType.type,
  parametersSchema: thickenFeatureParametersSchema,
  resolveParameters(parameters, variables) {
    const parsed = thickenFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const expression = resolveQuantityExpression(parsed.data.thickness, variables)
    const thickness = expression.ok ? thickenThicknessSchema.safeParse(expression.quantity) : null
    if (!expression.ok || !thickness?.success)
      return {
        ok: false,
        diagnostic: {
          code: expression.ok ? "invalid-thicken-thickness" : expression.diagnostic.code,
          message: "The Thicken thickness expression is invalid.",
          issues: [
            {
              path: "thickness",
              message: expression.ok
                ? "The thickness must resolve to a length between 0.001 and 10000 mm."
                : expression.diagnostic.message,
            },
          ],
        },
      }
    return { ok: true, parameters: { ...parsed.data, thickness: thickness.data } }
  },
  validateFeature(feature) {
    const { targetBody } = thickenFeatureParametersSchema.parse(feature.parameters)
    return targetBody.featureId === feature.dependencies[0]
      ? []
      : [{ path: "parameters.targetBody", message: "Thicken must target its sole dependency." }]
  },
  contentParameters(parameters) {
    const { faces, thickness, side, operation } = thickenFeatureParametersSchema.parse(parameters)
    // Face order is kept: worker diagnostics name the failing face by its 1-based position.
    return { faces: faces.map(bodyTopoRefContent), thickness: thickness.value, side, operation }
  },
}
