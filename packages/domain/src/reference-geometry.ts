import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { planarFaceTopoRefSchema } from "./topology"
import { lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

export const datumPlaneSupportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("origin-plane"), plane: z.enum(["xy", "xz", "yz"]) }).strict(),
  z.object({ kind: z.literal("feature-face"), reference: planarFaceTopoRefSchema }).strict(),
])

export const datumPlaneParametersSchema = z
  .object({
    mode: z.literal("offset"),
    support: datumPlaneSupportSchema,
    offset: lengthQuantitySchema,
  })
  .strict()

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

function resolveDatumPlaneParameters(parameters: unknown, variables: VariableValues) {
  const parsed = datumPlaneParametersSchema.safeParse(parameters)
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
  return offset.success
    ? { ok: true as const, parameters: { ...parsed.data, offset: offset.data } }
    : {
        ok: false as const,
        diagnostic: {
          code: "dimension-mismatch",
          message: "The datum plane offset must resolve to a length.",
          issues: [{ path: "offset", message: "The expression did not resolve to a length." }],
        },
      }
}

function contentParameters(parameters: unknown) {
  const datum = datumPlaneParametersSchema.parse(parameters)
  return {
    mode: datum.mode,
    support: datum.support,
    offset: datum.offset.value,
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
