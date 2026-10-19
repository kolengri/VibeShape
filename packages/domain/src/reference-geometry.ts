import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { planarFaceTopoRefSchema } from "./topology"
import { angleQuantitySchema, lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

export const datumPlaneSupportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("origin-plane"), plane: z.enum(["xy", "xz", "yz"]) }).strict(),
  z.object({ kind: z.literal("feature-face"), reference: planarFaceTopoRefSchema }).strict(),
])

const datumPlaneRotationSchema = z
  .object({ axis: z.enum(["x", "y"]), angle: angleQuantitySchema })
  .strict()
const datumPlaneAngleSchema = angleQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 2 * Math.PI,
  { message: "The datum plane rotation angle must be between -360 and 360 degrees." },
)

export const datumPlaneParametersSchema = z
  .object({
    mode: z.literal("offset"),
    support: datumPlaneSupportSchema,
    offset: lengthQuantitySchema,
    rotation: datumPlaneRotationSchema.extend({ angle: datumPlaneAngleSchema }).optional(),
  })
  .strict()

const unresolvedDatumPlaneParametersSchema = datumPlaneParametersSchema.extend({
  rotation: datumPlaneRotationSchema.optional(),
})

export const datumPlaneFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.reference-geometry",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.reference-geometry.datum-plane",
    schemaVersion: 1,
  },
  classification: "reference",
  dependencies: { min: 0, max: 1 },
  references: { min: 0, max: 1 },
})

function invariantIssues(valid: boolean, message: string) {
  return valid ? [] : [{ path: "dependencies", message }]
}

function datumPlaneInvariant(feature: FeatureRecord) {
  const parsed = datumPlaneParametersSchema.safeParse(feature.parameters)
  if (!parsed.success) return []
  const support = parsed.data.support
  if (support.kind === "origin-plane") {
    return invariantIssues(
      feature.dependencies.length === 0 && feature.references.length === 0,
      "An origin-offset datum plane has no feature input.",
    )
  }
  const ownerId = support.reference.featureId
  return invariantIssues(
    feature.dependencies.length === 1 &&
      feature.dependencies[0] === ownerId &&
      feature.references.length === 1 &&
      feature.references[0]?.featureId === ownerId,
    "A face-offset datum plane must depend on exactly its support reference owner.",
  )
}

export function hasCompleteDatumPlaneDependencyModel(feature: FeatureRecord) {
  const parameters = readDatumPlaneFeatureParameters(feature)
  if (!parameters) return false
  if (parameters.support.kind === "origin-plane") {
    return feature.dependencies.length === 0 && feature.references.length === 0
  }
  const ownerId = parameters.support.reference.featureId
  return (
    feature.dependencies.length === 1 &&
    feature.dependencies[0] === ownerId &&
    feature.references.length === 1 &&
    feature.references[0]?.featureId === ownerId
  )
}

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>

function resolveDatumPlaneRotation(
  rotation: z.infer<typeof datumPlaneRotationSchema> | undefined,
  variables: VariableValues,
) {
  if (!rotation) return { ok: true as const, rotation }
  const resolved = resolveQuantityExpression(rotation.angle, variables)
  if (!resolved.ok) {
    return {
      ok: false as const,
      diagnostic: {
        code: resolved.diagnostic.code,
        message: "The datum plane rotation angle expression is invalid.",
        issues: [{ path: "rotation.angle", message: resolved.diagnostic.message }],
      },
    }
  }
  const angle = datumPlaneAngleSchema.safeParse(resolved.quantity)
  return angle.success
    ? { ok: true as const, rotation: { ...rotation, angle: angle.data } }
    : {
        ok: false as const,
        diagnostic: {
          code: "invalid-rotation-angle",
          message:
            "The datum plane rotation must resolve to an angle between -360 and 360 degrees.",
          issues: [
            { path: "rotation.angle", message: angle.error.issues[0]?.message ?? "Invalid angle." },
          ],
        },
      }
}

function resolveDatumPlaneParameters(parameters: unknown, variables: VariableValues) {
  const parsed = unresolvedDatumPlaneParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const resolved = resolveQuantityExpression(parsed.data.offset, variables)
  if (!resolved.ok) {
    return {
      ok: false as const,
      diagnostic: {
        code: resolved.diagnostic.code,
        message: "The datum plane offset expression is invalid.",
        issues: [{ path: "offset", message: resolved.diagnostic.message }],
      },
    }
  }
  const offset = lengthQuantitySchema.safeParse(resolved.quantity)
  if (!offset.success) {
    return {
      ok: false as const,
      diagnostic: {
        code: "dimension-mismatch",
        message: "The datum plane offset must resolve to a length.",
        issues: [{ path: "offset", message: "The expression did not resolve to a length." }],
      },
    }
  }
  const rotation = resolveDatumPlaneRotation(parsed.data.rotation, variables)
  if (!rotation.ok) return rotation
  return {
    ok: true as const,
    parameters: {
      ...parsed.data,
      offset: offset.data,
      ...(rotation.rotation ? { rotation: rotation.rotation } : {}),
    },
  }
}

function contentParameters(parameters: unknown) {
  const datum = datumPlaneParametersSchema.parse(parameters)
  return {
    mode: datum.mode,
    support: datum.support,
    offset: datum.offset.value,
    ...(datum.rotation?.angle.value
      ? { rotation: { axis: datum.rotation.axis, angle: datum.rotation.angle.value } }
      : {}),
  }
}

export const referenceGeometryFeatureTypeHandlers: readonly TrustedFeatureTypeHandler[] = [
  {
    type: datumPlaneFeatureType.type,
    parametersSchema: datumPlaneParametersSchema,
    resolveParameters: resolveDatumPlaneParameters,
    contentParameters,
    validateFeature: datumPlaneInvariant,
  },
]

export function readDatumPlaneFeatureParameters(feature: FeatureRecord) {
  const type = feature.type
  if (
    type.moduleId !== datumPlaneFeatureType.type.moduleId ||
    type.moduleVersion !== datumPlaneFeatureType.type.moduleVersion ||
    type.typeId !== datumPlaneFeatureType.type.typeId ||
    type.schemaVersion !== datumPlaneFeatureType.type.schemaVersion
  ) {
    return null
  }
  const parsed = datumPlaneParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
