import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import {
  bodyEdgeRefSchema,
  bodyFaceRefSchema,
  bodyTopoRefChecks,
  bodyTopoRefContent,
} from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { angleQuantitySchema, lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const chamferEdgeRefSchema = bodyEdgeRefSchema
export const chamferTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("edge"),
      edge: chamferEdgeRefSchema,
      sideFace: bodyFaceRefSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("face"), face: bodyFaceRefSchema }).strict(),
])
const distanceSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= 0.001 && value <= 100_000,
  "Chamfer distances must be between 0.001 and 100000 mm.",
)
const angleSchema = angleQuantitySchema.refine(
  ({ value }) => value > 0 && value < Math.PI / 2,
  "Chamfer angles must be strictly between zero and 90 degrees.",
)

export const chamferFeatureParametersV3Schema = z
  .object({
    targetBody: bodyReferenceSchema,
    mode: z.enum(["equal-distance", "two-distances", "distance-angle"]),
    distance: distanceSchema,
    secondDistance: distanceSchema.optional(),
    angle: angleSchema.optional(),
    measurement: z.enum(["offset", "tangent"]),
    flip: z.boolean(),
    tangentPropagation: z.boolean(),
    targets: z.array(chamferTargetSchema).min(1).max(256),
    directionOverrides: z.array(chamferEdgeRefSchema).max(256),
  })
  .strict()
  .superRefine((parameters, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message })
    if ((parameters.mode === "two-distances") !== (parameters.secondDistance !== undefined))
      issue(["secondDistance"], "Only two-distance Chamfer requires a second distance.")
    if ((parameters.mode === "distance-angle") !== (parameters.angle !== undefined))
      issue(["angle"], "Only distance-angle Chamfer requires an angle.")
    if (
      parameters.mode === "equal-distance" &&
      (parameters.flip || parameters.directionOverrides.length)
    )
      issue(["flip"], "Equal-distance Chamfer has no direction to flip.")
    const checks = bodyTopoRefChecks(
      parameters.targetBody,
      "Chamfer references must belong to the exact target body.",
      issue,
    )
    const checkTarget = checks.distinct("Chamfer targets must be distinct.")
    const checkOverride = checks.distinct("Chamfer direction overrides must be distinct.")
    parameters.targets.forEach((target, index) => {
      checkTarget(target.kind === "edge" ? target.edge : target.face, ["targets", index])
      if (target.kind === "edge") {
        if (parameters.mode !== "equal-distance" && !target.sideFace)
          issue(
            ["targets", index, "sideFace"],
            "Directional Chamfer requires an explicit adjacent face.",
          )
        if (target.sideFace) checks.owned(target.sideFace, ["targets", index, "sideFace"])
      }
    })
    for (const [index, reference] of parameters.directionOverrides.entries())
      checkOverride(reference, ["directionOverrides", index])
  })
export type ChamferFeatureParametersV3 = Readonly<z.infer<typeof chamferFeatureParametersV3Schema>>

export const chamferFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.chamfer",
    schemaVersion: 3,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export function readChamferFeatureParametersV3(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): ChamferFeatureParametersV3 | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(chamferFeatureTypeV3.type)) return null
  const parsed = chamferFeatureParametersV3Schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

export const chamferFeatureTypeHandlerV3: TrustedFeatureTypeHandler = {
  type: chamferFeatureTypeV3.type,
  parametersSchema: chamferFeatureParametersV3Schema,
  validateFeature(feature) {
    const parameters = chamferFeatureParametersV3Schema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [{ path: "parameters.targetBody", message: "Chamfer must target its sole dependency." }]
  },
  resolveParameters(parameters, variables) {
    const parsed = chamferFeatureParametersV3Schema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const resolved = { ...parsed.data }
    for (const key of ["distance", "secondDistance", "angle"] as const) {
      const quantity = resolved[key]
      if (!quantity) continue
      const result = resolveQuantityExpression(quantity, variables)
      const valid = result.ok
        ? (key === "angle" ? angleSchema : distanceSchema).safeParse(result.quantity)
        : null
      if (!valid?.success)
        return {
          ok: false,
          diagnostic: {
            code: "invalid-chamfer-quantity",
            message: "Chamfer quantity expression is invalid.",
            issues: [
              {
                path: key,
                message:
                  "The expression must resolve to a bounded quantity of the correct dimension.",
              },
            ],
          },
        }
      if (key === "angle") resolved.angle = angleSchema.parse(valid.data)
      else resolved[key] = distanceSchema.parse(valid.data)
    }
    return { ok: true, parameters: resolved }
  },
  contentParameters(parameters) {
    const parsed = chamferFeatureParametersV3Schema.parse(parameters)
    return {
      mode: parsed.mode,
      distance: parsed.distance.value,
      ...(parsed.secondDistance ? { secondDistance: parsed.secondDistance.value } : {}),
      ...(parsed.angle ? { angle: parsed.angle.value } : {}),
      measurement: parsed.measurement,
      flip: parsed.flip,
      tangentPropagation: parsed.tangentPropagation,
      targets: parsed.targets.map((target) =>
        target.kind === "face"
          ? { kind: "face", face: bodyTopoRefContent(target.face) }
          : {
              kind: "edge",
              edge: bodyTopoRefContent(target.edge),
              ...(target.sideFace ? { sideFace: bodyTopoRefContent(target.sideFace) } : {}),
            },
      ),
      directionOverrides: parsed.directionOverrides.map(bodyTopoRefContent),
    }
  },
}
