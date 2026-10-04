import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { FeatureParameterResolution, TrustedFeatureTypeHandler } from "./feature-type-registry"
import { referenceAxisSchema, referenceFrameDependencyIds } from "./reference-frame"
import {
  angleQuantitySchema,
  lengthQuantitySchema,
  type Quantity,
  scalarQuantitySchema,
} from "./units"
import { resolveQuantityExpression } from "./variables"

export const THREAD_MAX_AUTHORED_TURNS = 16
export const THREAD_V2_MAX_AUTHORED_TURNS = 20
const positiveLength = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= 1000,
  "Thread dimensions must be positive and no greater than 1,000 mm.",
)
const nonnegativeLength = lengthQuantitySchema.refine(
  ({ value }) => value >= 0 && value <= 1000,
  "Thread allowances must be between 0 and 1,000 mm.",
)
const coordinate = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 100_000,
  "Thread origin must remain within 100,000 mm.",
)
const pitch = lengthQuantitySchema.refine(
  ({ value }) => value >= 0.2 && value <= 20,
  "Thread pitch must be between 0.2 and 20 mm.",
)
const starts = scalarQuantitySchema.refine(
  ({ value }) => Number.isInteger(value) && value >= 1 && value <= 4,
  "Thread starts must be an integer between 1 and 4.",
)
const phase = angleQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 2 * Math.PI,
  "Thread phase must remain within one revolution.",
)
const fields = {
  nominalDiameter: positiveLength,
  pitch,
  length: positiveLength,
  depth: positiveLength,
  clearance: nonnegativeLength,
  starts,
  phase,
  runIn: nonnegativeLength,
  runOut: nonnegativeLength,
}
export const threadFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    kind: z.enum(["external", "internal"]),
    axis: z.enum(["X", "Y", "Z"]),
    origin: z.object({ x: coordinate, y: coordinate, z: coordinate }).strict(),
    handedness: z.enum(["right", "left"]),
    ...fields,
  })
  .strict()
  .superRefine((parameters, context) => {
    const band = parameters.length.value - parameters.runIn.value - parameters.runOut.value
    if (band <= 0)
      context.addIssue({
        code: "custom",
        path: ["length"],
        message: "The threaded band must have positive length.",
      })
    if (band / parameters.pitch.value > THREAD_MAX_AUTHORED_TURNS)
      context.addIssue({
        code: "custom",
        path: ["pitch"],
        message:
          "Modeled threads allow at most 16 total turns. Reduce the band length or increase the pitch.",
      })
    if (parameters.depth.value > 0.75 * parameters.pitch.value)
      context.addIssue({
        code: "custom",
        path: ["depth"],
        message: "Thread depth must not exceed 0.75 times the pitch.",
      })
    if (
      parameters.kind === "external" &&
      parameters.nominalDiameter.value / 2 - parameters.clearance.value - parameters.depth.value <=
        0
    )
      context.addIssue({
        code: "custom",
        path: ["depth"],
        message: "External thread root radius must remain positive after radial clearance.",
      })
  })
export const threadFeatureParametersV2Schema = z
  .object({
    targetBody: bodyReferenceSchema,
    kind: z.enum(["external", "internal"]),
    axis: referenceAxisSchema,
    handedness: z.enum(["right", "left"]),
    ...fields,
  })
  .strict()
  .superRefine((parameters, context) => {
    const band = parameters.length.value - parameters.runIn.value - parameters.runOut.value
    if (band <= 0)
      context.addIssue({
        code: "custom",
        path: ["length"],
        message: "The threaded band must have positive length.",
      })
    if (band / parameters.pitch.value > THREAD_V2_MAX_AUTHORED_TURNS)
      context.addIssue({
        code: "custom",
        path: ["pitch"],
        message: "Modeled threads allow at most 20 total turns.",
      })
    if (parameters.starts.value > 1 && band / parameters.pitch.value > 16)
      context.addIssue({
        code: "custom",
        path: ["starts"],
        message: "Multi-start threads retain the 16-turn aggregate budget.",
      })
    if (parameters.depth.value > 0.75 * parameters.pitch.value)
      context.addIssue({
        code: "custom",
        path: ["depth"],
        message: "Thread depth must not exceed 0.75 times the pitch.",
      })
    if (
      parameters.kind === "external" &&
      parameters.nominalDiameter.value / 2 - parameters.clearance.value - parameters.depth.value <=
        0
    )
      context.addIssue({
        code: "custom",
        path: ["depth"],
        message: "External thread root radius must remain positive after radial clearance.",
      })
  })
export type ThreadFeatureParametersV2 = Readonly<z.infer<typeof threadFeatureParametersV2Schema>>
export type ThreadFeatureParameters = Readonly<z.infer<typeof threadFeatureParametersSchema>>
export const threadFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.thread",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})
export const threadFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  ...threadFeatureType,
  type: { ...threadFeatureType.type, schemaVersion: 2 },
  dependencies: { min: 1, max: 2 },
})
export function readThreadFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): ThreadFeatureParameters | ThreadFeatureParametersV2 | null {
  const key = featureTypeKey(feature.type)
  const schema =
    key === featureTypeKey(threadFeatureType.type)
      ? threadFeatureParametersSchema
      : key === featureTypeKey(threadFeatureTypeV2.type)
        ? threadFeatureParametersV2Schema
        : null
  if (!schema) return null
  const parsed = schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
type Variables = Parameters<NonNullable<TrustedFeatureTypeHandler["resolveParameters"]>>[1]
function resolveThreadQuantity(
  quantity: Quantity,
  schema: z.ZodType,
  path: string,
  variables: Variables,
) {
  const expression = resolveQuantityExpression(quantity, variables)
  const parsed = expression.ok ? schema.safeParse(expression.quantity) : null
  return expression.ok && parsed?.success
    ? { ok: true as const, quantity: expression.quantity }
    : {
        ok: false as const,
        diagnostic: {
          code: expression.ok ? "invalid-thread-parameter" : expression.diagnostic.code,
          message: "A modeled thread parameter expression is invalid.",
          issues: [
            {
              path,
              message: expression.ok
                ? "The expression must resolve to a bounded value of the required dimension."
                : expression.diagnostic.message,
            },
          ],
        },
      }
}
function resolveThreadParameters(
  parameters: unknown,
  variables: Variables,
): FeatureParameterResolution {
  const parsed = threadFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true, parameters }
  const resolved = { ...parsed.data, origin: { ...parsed.data.origin } }
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    const value = resolveThreadQuantity(parsed.data[field], fields[field], field, variables)
    if (!value.ok) return value
    Object.assign(resolved, { [field]: value.quantity })
  }
  for (const axis of ["x", "y", "z"] as const) {
    const value = resolveThreadQuantity(
      parsed.data.origin[axis],
      coordinate,
      `origin.${axis}`,
      variables,
    )
    if (!value.ok) return value
    Object.assign(resolved.origin, { [axis]: value.quantity })
  }
  const valid = threadFeatureParametersSchema.safeParse(resolved)
  return valid.success
    ? { ok: true, parameters: valid.data }
    : {
        ok: false,
        diagnostic: {
          code: "invalid-thread-geometry",
          message: "The resolved thread violates its geometry or resource bounds.",
          issues: valid.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      }
}
export const threadFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: threadFeatureType.type,
  parametersSchema: threadFeatureParametersSchema,
  resolveParameters: resolveThreadParameters,
  validateFeature(feature) {
    const { targetBody } = threadFeatureParametersSchema.parse(feature.parameters)
    return targetBody.featureId === feature.dependencies[0]
      ? []
      : [
          {
            path: "parameters.targetBody.featureId",
            message: "Thread must target its sole dependency.",
          },
        ]
  },
  contentParameters(parameters) {
    const value = threadFeatureParametersSchema.parse(parameters)
    return {
      kind: value.kind,
      axis: value.axis,
      origin: [value.origin.x.value, value.origin.y.value, value.origin.z.value],
      handedness: value.handedness,
      ...Object.fromEntries(
        Object.keys(fields).map((field) => [field, value[field as keyof typeof fields].value]),
      ),
    }
  },
}

export const threadFeatureTypeHandlerV2: TrustedFeatureTypeHandler = {
  type: threadFeatureTypeV2.type,
  parametersSchema: threadFeatureParametersV2Schema,
  resolveParameters(parameters, variables) {
    const parsed = threadFeatureParametersV2Schema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const resolved = { ...parsed.data }
    for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
      const value = resolveThreadQuantity(parsed.data[field], fields[field], field, variables)
      if (!value.ok) return value
      Object.assign(resolved, { [field]: value.quantity })
    }
    const valid = threadFeatureParametersV2Schema.safeParse(resolved)
    return valid.success
      ? { ok: true, parameters: valid.data }
      : {
          ok: false,
          diagnostic: {
            code: "invalid-thread-geometry",
            message: "The resolved thread violates its geometry or resource bounds.",
            issues: valid.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        }
  },
  validateFeature(feature) {
    const value = threadFeatureParametersV2Schema.parse(feature.parameters)
    return JSON.stringify(feature.dependencies) ===
      JSON.stringify(referenceFrameDependencyIds(value.targetBody.featureId, value.axis)) &&
      feature.references.length === 0
      ? []
      : [
          {
            path: "dependencies",
            message:
              "Thread requires its exact target first and any distinct axis support, with no generic topology references.",
          },
        ]
  },
  contentParameters(parameters) {
    const value = threadFeatureParametersV2Schema.parse(parameters)
    return {
      kind: value.kind,
      axis: value.axis,
      handedness: value.handedness,
      ...Object.fromEntries(
        Object.keys(fields).map((field) => [field, value[field as keyof typeof fields].value]),
      ),
    }
  },
}
