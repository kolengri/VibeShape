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
import { type LengthQuantity, lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>

export const FILLET_V3_MIN_RADIUS_MM = 0.001
export const FILLET_V3_MAX_RADIUS_MM = 100_000

const radiusSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= FILLET_V3_MIN_RADIUS_MM && value <= FILLET_V3_MAX_RADIUS_MM,
  "Fillet radii must be between 0.001 and 100000 mm.",
)

/**
 * Linear radius law along one open edge. `start` is the edge endpoint that sorts first by x, then
 * y, then z in the target body's model coordinates (coordinates within 1e-3 mm compare equal);
 * `reverse` swaps start and end. The rule never depends on native edge orientation.
 */
export const filletVariableRadiusSchema = z
  .object({ startRadius: radiusSchema, endRadius: radiusSchema, reverse: z.boolean() })
  .strict()
  .refine(
    ({ startRadius, endRadius }) => startRadius.value !== endRadius.value,
    "A variable radius needs different start and end radii; use the constant radius instead.",
  )
export type FilletVariableRadius = Readonly<z.infer<typeof filletVariableRadiusSchema>>

export const filletEdgeRefSchema = bodyEdgeRefSchema
export const filletTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("edge"),
      edge: filletEdgeRefSchema,
      variableRadius: filletVariableRadiusSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("face"), face: bodyFaceRefSchema }).strict(),
])
export type FilletTarget = z.infer<typeof filletTargetSchema>

/**
 * Body-bound Fillet. Every target seeds its complete native tangent contour (OCCT behavior); a face
 * target seeds each of its current boundary edges. Only semantic references are persisted.
 */
export const filletFeatureParametersV3Schema = z
  .object({
    targetBody: bodyReferenceSchema,
    radius: radiusSchema,
    targets: z.array(filletTargetSchema).min(1).max(256),
  })
  .strict()
  .superRefine((parameters, context) => {
    const check = bodyTopoRefChecks(
      parameters.targetBody,
      "Fillet references must belong to the exact target body.",
      (path, message) => context.addIssue({ code: "custom", path, message }),
    ).distinct("Fillet targets must be distinct.")
    for (const [index, target] of parameters.targets.entries())
      check(target.kind === "edge" ? target.edge : target.face, ["targets", index])
  })
export type FilletFeatureParametersV3 = Readonly<z.infer<typeof filletFeatureParametersV3Schema>>

export const filletFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.fillet",
    schemaVersion: 3,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export function readFilletFeatureParametersV3(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): FilletFeatureParametersV3 | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(filletFeatureTypeV3.type)) return null
  const parsed = filletFeatureParametersV3Schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

function resolveRadius(quantity: LengthQuantity, variables: VariableValues, path: string) {
  const result = resolveQuantityExpression(quantity, variables)
  const valid = result.ok ? radiusSchema.safeParse(result.quantity) : null
  if (valid?.success) return { ok: true as const, quantity: valid.data }
  return {
    ok: false as const,
    diagnostic: {
      code: "invalid-fillet-quantity",
      message: "Fillet radius expression is invalid.",
      issues: [
        { path, message: "The expression must resolve to a length between 0.001 and 100000 mm." },
      ],
    },
  }
}

function resolveTarget(target: FilletTarget, index: number, variables: VariableValues) {
  if (target.kind !== "edge" || !target.variableRadius) return { ok: true as const, target }
  const law = target.variableRadius
  const start = resolveRadius(law.startRadius, variables, `targets.${index}.startRadius`)
  if (!start.ok) return start
  const end = resolveRadius(law.endRadius, variables, `targets.${index}.endRadius`)
  if (!end.ok) return end
  const variableRadius = filletVariableRadiusSchema.safeParse({
    ...law,
    startRadius: start.quantity,
    endRadius: end.quantity,
  })
  if (variableRadius.success)
    return { ok: true as const, target: { ...target, variableRadius: variableRadius.data } }
  return {
    ok: false as const,
    diagnostic: {
      code: "invalid-fillet-quantity",
      message: "Fillet variable radius is invalid.",
      issues: [
        {
          path: `targets.${index}.variableRadius`,
          message: "Start and end radii must resolve to different lengths.",
        },
      ],
    },
  }
}

function resolveParameters(parameters: unknown, variables: VariableValues) {
  const parsed = filletFeatureParametersV3Schema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const radius = resolveRadius(parsed.data.radius, variables, "radius")
  if (!radius.ok) return radius
  const targets: FilletTarget[] = []
  for (const [index, target] of parsed.data.targets.entries()) {
    const resolved = resolveTarget(target, index, variables)
    if (!resolved.ok) return resolved
    targets.push(resolved.target)
  }
  return { ok: true as const, parameters: { ...parsed.data, radius: radius.quantity, targets } }
}

export const filletFeatureTypeHandlerV3: TrustedFeatureTypeHandler = {
  type: filletFeatureTypeV3.type,
  parametersSchema: filletFeatureParametersV3Schema,
  validateFeature(feature) {
    const parameters = filletFeatureParametersV3Schema.parse(feature.parameters)
    return parameters.targetBody.featureId === feature.dependencies[0]
      ? []
      : [{ path: "parameters.targetBody", message: "Fillet must target its sole dependency." }]
  },
  resolveParameters,
  contentParameters(parameters) {
    const parsed = filletFeatureParametersV3Schema.parse(parameters)
    return {
      radius: parsed.radius.value,
      targets: parsed.targets.map((target) =>
        target.kind === "face"
          ? { kind: "face", face: bodyTopoRefContent(target.face) }
          : {
              kind: "edge",
              edge: bodyTopoRefContent(target.edge),
              ...(target.variableRadius
                ? {
                    variableRadius: {
                      startRadius: target.variableRadius.startRadius.value,
                      endRadius: target.variableRadius.endRadius.value,
                      reverse: target.variableRadius.reverse,
                    },
                  }
                : {}),
            },
      ),
    }
  },
}
