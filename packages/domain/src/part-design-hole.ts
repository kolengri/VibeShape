import { z } from "zod"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import type { FeatureParameters, FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { type FeatureId, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { angleQuantitySchema, lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

const MAX_HOLE_DIAMETER_MM = 1_000_000

const holeLengthSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= MAX_HOLE_DIAMETER_MM,
  `Hole dimensions must be greater than zero and at most ${MAX_HOLE_DIAMETER_MM} mm.`,
)
const holeContentLengthSchema = z.number().finite().positive().max(MAX_HOLE_DIAMETER_MM)

const pointIdsSchema = z
  .array(sketchEntityIdSchema)
  .min(1)
  .max(256)
  .superRefine((pointIds, context) => {
    if (new Set(pointIds).size !== pointIds.length) {
      context.addIssue({ code: "custom", message: "Hole point IDs must be distinct." })
    }
  })
  .transform((pointIds) => [...pointIds].sort())

const blindHoleParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    pointIds: pointIdsSchema,
    diameter: holeLengthSchema,
    direction: z.enum(["forward", "reverse"]),
    extent: z.literal("blind"),
    depth: holeLengthSchema,
  })
  .strict()
const throughAllHoleParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    pointIds: pointIdsSchema,
    diameter: holeLengthSchema,
    direction: z.enum(["forward", "reverse"]),
    extent: z.literal("through-all"),
  })
  .strict()

export const holeFeatureParametersSchema = z.discriminatedUnion("extent", [
  blindHoleParametersSchema,
  throughAllHoleParametersSchema,
])

const blindHoleContentParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    pointIds: z.array(sketchEntityIdSchema).min(1).max(256),
    diameter: holeContentLengthSchema,
    direction: z.enum(["forward", "reverse"]),
    extent: z.literal("blind"),
    depth: holeContentLengthSchema,
  })
  .strict()
const throughAllHoleContentParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    pointIds: z.array(sketchEntityIdSchema).min(1).max(256),
    diameter: holeContentLengthSchema,
    direction: z.enum(["forward", "reverse"]),
    extent: z.literal("through-all"),
  })
  .strict()
export const holeFeatureAuthoredContentParametersSchema = z.discriminatedUnion("extent", [
  blindHoleContentParametersSchema,
  throughAllHoleContentParametersSchema,
])

export type HoleFeatureParameters = Readonly<z.infer<typeof holeFeatureParametersSchema>>
export type HoleFeatureAuthoredContentParameters = Readonly<
  z.infer<typeof holeFeatureAuthoredContentParametersSchema>
>

const blindHoleParametersV2Schema = blindHoleParametersSchema
  .extend({ targetBody: bodyReferenceSchema })
  .strict()
const throughAllHoleParametersV2Schema = throughAllHoleParametersSchema
  .extend({ targetBody: bodyReferenceSchema })
  .strict()
export const holeFeatureParametersV2Schema = z.discriminatedUnion("extent", [
  blindHoleParametersV2Schema,
  throughAllHoleParametersV2Schema,
])

export type HoleFeatureParametersV2 = Readonly<z.infer<typeof holeFeatureParametersV2Schema>>

const countersinkAngleSchema = angleQuantitySchema.refine(
  ({ value }) => value >= Math.PI / 18 && value <= (17 * Math.PI) / 18,
  "Countersink included angles must be between 10 and 170 degrees.",
)
export const holeTreatmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("simple") }).strict(),
  z
    .object({ kind: z.literal("counterbore"), diameter: holeLengthSchema, depth: holeLengthSchema })
    .strict(),
  z
    .object({
      kind: z.literal("countersink"),
      diameter: holeLengthSchema,
      angle: countersinkAngleSchema,
    })
    .strict(),
])
export const holeFeatureParametersV3Schema = z
  .discriminatedUnion("extent", [
    blindHoleParametersV2Schema.extend({ treatment: holeTreatmentSchema }).strict(),
    throughAllHoleParametersV2Schema.extend({ treatment: holeTreatmentSchema }).strict(),
  ])
  .superRefine((parameters, context) => {
    const treatment = parameters.treatment
    if (treatment.kind === "simple") return
    if (treatment.diameter.value <= parameters.diameter.value)
      context.addIssue({
        code: "custom",
        path: ["treatment", "diameter"],
        message: "The recess diameter must be larger than the hole diameter.",
      })
    const recessDepth =
      treatment.kind === "counterbore"
        ? treatment.depth.value
        : (treatment.diameter.value - parameters.diameter.value) /
          (2 * Math.tan(treatment.angle.value / 2))
    if (parameters.extent === "blind" && recessDepth >= parameters.depth.value)
      context.addIssue({
        code: "custom",
        path: ["treatment"],
        message: "The recess must leave a positive cylindrical depth in a blind hole.",
      })
  })
export type HoleFeatureParametersV3 = Readonly<z.infer<typeof holeFeatureParametersV3Schema>>

export const holeFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.hole",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 2 },
  references: { min: 0, max: 1 },
})

export const holeFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.hole",
    schemaVersion: 2,
  },
  classification: "solid",
  dependencies: { min: 1, max: 2 },
  references: { min: 0, max: 1 },
})

export const holeFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  ...holeFeatureTypeV2,
  type: { ...holeFeatureTypeV2.type, schemaVersion: 3 },
})

function isHoleType(feature: Pick<FeatureRecord, "type">, expected = holeFeatureType.type) {
  const actual = feature.type
  return (
    actual.moduleId === expected.moduleId &&
    actual.moduleVersion === expected.moduleVersion &&
    actual.typeId === expected.typeId &&
    actual.schemaVersion === expected.schemaVersion
  )
}

export function readHoleFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): HoleFeatureParameters | HoleFeatureParametersV2 | HoleFeatureParametersV3 | null {
  const schema = isHoleType(feature)
    ? holeFeatureParametersSchema
    : isHoleType(feature, holeFeatureTypeV2.type)
      ? holeFeatureParametersV2Schema
      : isHoleType(feature, holeFeatureTypeV3.type)
        ? holeFeatureParametersV3Schema
        : null
  if (!schema) return null
  const parsed = schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

export function readHoleBodyTarget(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): BodyReference | null {
  if (!isHoleType(feature, holeFeatureTypeV2.type) && !isHoleType(feature, holeFeatureTypeV3.type))
    return null
  const parsed = readHoleFeatureParameters(feature)
  return parsed && "targetBody" in parsed ? parsed.targetBody : null
}

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>

function expressionFailure(path: string, diagnostic: { code: string; message: string }) {
  return {
    ok: false as const,
    diagnostic: {
      code: diagnostic.code,
      message: "A part-design hole parameter expression is invalid.",
      issues: [{ path, message: diagnostic.message }],
    },
  }
}

function resolveHoleParameters(parameters: unknown, variables: VariableValues) {
  const parsed = holeFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }

  const diameter = resolveQuantityExpression(parsed.data.diameter, variables)
  if (!diameter.ok) return expressionFailure("diameter", diameter.diagnostic)
  const validDiameter = holeLengthSchema.safeParse(diameter.quantity)
  if (!validDiameter.success) {
    return expressionFailure("diameter", {
      code: "invalid-diameter",
      message: "The expression did not resolve to a bounded positive diameter.",
    })
  }

  if (parsed.data.extent === "through-all") {
    return { ok: true as const, parameters: { ...parsed.data, diameter: validDiameter.data } }
  }
  const depth = resolveQuantityExpression(parsed.data.depth, variables)
  if (!depth.ok) return expressionFailure("depth", depth.diagnostic)
  const validDepth = holeLengthSchema.safeParse(depth.quantity)
  if (!validDepth.success) {
    return expressionFailure("depth", {
      code: "invalid-depth",
      message: "The expression did not resolve to a bounded positive depth.",
    })
  }
  return {
    ok: true as const,
    parameters: {
      ...parsed.data,
      diameter: validDiameter.data,
      extent: "blind" as const,
      depth: validDepth.data,
    },
  }
}

function resolveHoleParametersV2(parameters: unknown, variables: VariableValues) {
  const parsed = holeFeatureParametersV2Schema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const { targetBody, ...holeParameters } = parsed.data
  const resolved = resolveHoleParameters(holeParameters, variables)
  if (!resolved.ok) return resolved
  const resolvedParameters = holeFeatureParametersSchema.parse(resolved.parameters)
  return {
    ok: true as const,
    parameters: { ...resolvedParameters, targetBody },
  }
}

export function expectedHoleDependencyIds(
  targetFeatureId: FeatureId,
  supportFeatureId: FeatureId | null = null,
) {
  const ordered = [targetFeatureId, ...(supportFeatureId ? [supportFeatureId] : [])]
  return ordered.filter((featureId, index) => ordered.indexOf(featureId) === index)
}

function holeFeatureInvariant(feature: FeatureRecord) {
  const targetFeatureId = feature.dependencies[0]
  if (!targetFeatureId) {
    return [{ path: "dependencies", message: "A hole requires one explicit target dependency." }]
  }
  const supportFeatureId = feature.references[0]?.featureId ?? null
  const expected = expectedHoleDependencyIds(targetFeatureId, supportFeatureId)
  if (
    feature.dependencies.length !== expected.length ||
    feature.dependencies.some((dependency, index) => dependency !== expected[index])
  ) {
    return [
      {
        path: "dependencies",
        message: "A hole requires its target first, followed by its distinct sketch support.",
      },
    ]
  }
  return []
}

function holeFeatureInvariantV2(feature: FeatureRecord) {
  const issues = holeFeatureInvariant(feature)
  const parsed = holeFeatureParametersV2Schema.safeParse(feature.parameters)
  if (!parsed.success) return issues
  const targetFeatureId = feature.dependencies[0]
  if (parsed.data.targetBody.featureId !== targetFeatureId) {
    issues.push({
      path: "parameters.targetBody.featureId",
      message: "A hole body target must match its first dependency.",
    })
  }
  const supportFeatureId = feature.references[0]?.featureId
  if (
    supportFeatureId === parsed.data.targetBody.featureId &&
    parsed.data.targetBody.outputRole !== "result"
  ) {
    issues.push({
      path: "parameters.targetBody.outputRole",
      message: "A constituent target cannot share a dependency slot with whole support.",
    })
  }
  return issues
}

export const holeFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: holeFeatureType.type,
  parametersSchema: holeFeatureParametersSchema,
  resolveParameters: resolveHoleParameters,
  validateFeature: holeFeatureInvariant,
  contentParameters(parameters: FeatureParameters) {
    const hole = holeFeatureParametersSchema.parse(parameters)
    return holeFeatureAuthoredContentParametersSchema.parse({
      sketchId: hole.sketchId,
      pointIds: hole.pointIds,
      diameter: hole.diameter.value,
      direction: hole.direction,
      extent: hole.extent,
      ...(hole.extent === "blind" ? { depth: hole.depth.value } : {}),
    })
  },
}

export const holeFeatureTypeHandlerV2: TrustedFeatureTypeHandler = {
  type: holeFeatureTypeV2.type,
  parametersSchema: holeFeatureParametersV2Schema,
  resolveParameters: resolveHoleParametersV2,
  validateFeature: holeFeatureInvariantV2,
  contentParameters(parameters: FeatureParameters) {
    const hole = holeFeatureParametersV2Schema.parse(parameters)
    return holeFeatureAuthoredContentParametersSchema.parse({
      sketchId: hole.sketchId,
      pointIds: hole.pointIds,
      diameter: hole.diameter.value,
      direction: hole.direction,
      extent: hole.extent,
      ...(hole.extent === "blind" ? { depth: hole.depth.value } : {}),
    })
  },
}

function resolveHoleTreatment(
  treatment: z.infer<typeof holeTreatmentSchema>,
  variables: VariableValues,
) {
  const recess = { ...treatment }
  if (treatment.kind !== "simple") {
    const diameter = resolveQuantityExpression(treatment.diameter, variables)
    if (!diameter.ok) return expressionFailure("treatment.diameter", diameter.diagnostic)
    Object.assign(recess, { diameter: diameter.quantity })
    const key = treatment.kind === "counterbore" ? "depth" : "angle"
    const value = resolveQuantityExpression(
      treatment.kind === "counterbore" ? treatment.depth : treatment.angle,
      variables,
    )
    if (!value.ok) return expressionFailure(`treatment.${key}`, value.diagnostic)
    Object.assign(recess, { [key]: value.quantity })
  }
  return { ok: true as const, treatment: recess }
}
export function holeTreatmentContent(treatment: z.infer<typeof holeTreatmentSchema>) {
  if (treatment.kind === "simple") return treatment
  if (treatment.kind === "counterbore")
    return {
      kind: treatment.kind,
      diameter: treatment.diameter.value,
      depth: treatment.depth.value,
    }
  return { kind: treatment.kind, diameter: treatment.diameter.value, angle: treatment.angle.value }
}

export const holeFeatureTypeHandlerV3: TrustedFeatureTypeHandler = {
  type: holeFeatureTypeV3.type,
  parametersSchema: holeFeatureParametersV3Schema,
  resolveParameters(parameters, variables) {
    const parsed = holeFeatureParametersV3Schema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const { treatment, ...base } = parsed.data
    const resolved = resolveHoleParametersV2(base, variables)
    if (!resolved.ok) return resolved
    const recess = resolveHoleTreatment(treatment, variables)
    if (!recess.ok) return recess
    const valid = holeFeatureParametersV3Schema.safeParse({
      ...holeFeatureParametersV2Schema.parse(resolved.parameters),
      treatment: recess.treatment,
    })
    return valid.success
      ? { ok: true, parameters: valid.data }
      : expressionFailure("treatment", {
          code: "invalid-hole-recess",
          message: valid.error.issues[0]?.message ?? "Invalid hole recess.",
        })
  },
  validateFeature(feature) {
    const { treatment: _treatment, ...parameters } = holeFeatureParametersV3Schema.parse(
      feature.parameters,
    )
    return holeFeatureInvariantV2({ ...feature, parameters })
  },
  contentParameters(parameters) {
    const { treatment, ...base } = holeFeatureParametersV3Schema.parse(parameters)
    return {
      ...holeFeatureAuthoredContentParametersSchema.parse(
        holeFeatureTypeHandlerV2.contentParameters?.(base),
      ),
      treatment: holeTreatmentContent(treatment),
    }
  },
}
