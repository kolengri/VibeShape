import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type Quantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  readThreadFeatureParameters,
  type ThreadFeatureParameters,
  type ThreadFeatureParametersV2,
  threadFeatureParametersSchema,
  threadFeatureParametersV2Schema,
  threadFeatureType,
  threadFeatureTypeV2,
} from "@vibeshape/domain/part-design-thread"
import { type ReferenceAxis, referenceFrameDependencyIds } from "@vibeshape/domain/reference-frame"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"

export const threadCoreFields = [
  "nominalDiameter",
  "pitch",
  "length",
  "depth",
  "clearance",
] as const
export const threadAdvancedFields = [
  "originX",
  "originY",
  "originZ",
  "starts",
  "phase",
  "runIn",
  "runOut",
] as const
type ThreadQuantityField = (typeof threadCoreFields)[number] | (typeof threadAdvancedFields)[number]
export type ThreadFormValues = Record<ThreadQuantityField, string> & {
  kind: "external" | "internal"
  axis: "X" | "Y" | "Z" | "reference"
  axisReference: ReferenceAxis | null
  handedness: "right" | "left"
}
export type ThreadFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }
export type ThreadValidationCopy = {
  validationSummary: string
  invalidExpression: string
  invalidDimension: string
  invalidAngleDimension: string
  invalidScalarDimension: string
  invalidDimensionRange: string
  invalidPitchRange: string
  invalidAllowanceRange: string
  invalidOriginRange: string
  invalidStartsRange: string
  invalidPhaseRange: string
  invalidBand: string
  invalidTurns: string
  invalidDepth: string
  invalidRootRadius: string
}
const shape = threadFeatureParametersSchema.shape
const quantityFields = {
  nominalDiameter: {
    dimension: "length",
    schema: shape.nominalDiameter,
    message: "invalidDimensionRange",
  },
  pitch: { dimension: "length", schema: shape.pitch, message: "invalidPitchRange" },
  length: { dimension: "length", schema: shape.length, message: "invalidDimensionRange" },
  depth: { dimension: "length", schema: shape.depth, message: "invalidDimensionRange" },
  clearance: { dimension: "length", schema: shape.clearance, message: "invalidAllowanceRange" },
  originX: { dimension: "length", schema: shape.origin.shape.x, message: "invalidOriginRange" },
  originY: { dimension: "length", schema: shape.origin.shape.y, message: "invalidOriginRange" },
  originZ: { dimension: "length", schema: shape.origin.shape.z, message: "invalidOriginRange" },
  starts: { dimension: "scalar", schema: shape.starts, message: "invalidStartsRange" },
  phase: { dimension: "angle", schema: shape.phase, message: "invalidPhaseRange" },
  runIn: { dimension: "length", schema: shape.runIn, message: "invalidAllowanceRange" },
  runOut: { dimension: "length", schema: shape.runOut, message: "invalidAllowanceRange" },
} as const
function sourceExpression(quantity: Quantity) {
  return (
    quantity.source.expression ??
    (quantity.dimension === "scalar"
      ? String(quantity.source.value)
      : `${quantity.source.value} ${quantity.source.unit}`)
  )
}
export function threadTargetBody(mode: ThreadFormMode) {
  return mode.kind === "create"
    ? mode.targetBody
    : (readThreadFeatureParameters(mode.feature)?.targetBody ??
        (() => {
          throw new Error("Invalid Thread target.")
        })())
}
function threadOriginValues(
  parameters: ThreadFeatureParameters | ThreadFeatureParametersV2,
  units: DocumentDisplayUnits,
) {
  if ("origin" in parameters)
    return {
      originX: sourceExpression(parameters.origin.x),
      originY: sourceExpression(parameters.origin.y),
      originZ: sourceExpression(parameters.origin.z),
    }
  const origin = parameters.axis.kind === "explicit-axis" ? parameters.axis.origin : [0, 0, 0]
  return {
    originX: defaultLengthExpression(origin[0] ?? 0, units.length),
    originY: defaultLengthExpression(origin[1] ?? 0, units.length),
    originZ: defaultLengthExpression(origin[2] ?? 0, units.length),
  }
}
export function threadFormValues(
  mode: ThreadFormMode,
  units: DocumentDisplayUnits,
): ThreadFormValues {
  const parameters = mode.kind === "edit" ? readThreadFeatureParameters(mode.feature) : null
  const zero = defaultLengthExpression(0, units.length)
  if (!parameters)
    return {
      kind: "external",
      axis: "Z",
      axisReference: null,
      handedness: "right",
      nominalDiameter: defaultLengthExpression(10, units.length),
      pitch: defaultLengthExpression(2, units.length),
      length: defaultLengthExpression(6, units.length),
      depth: defaultLengthExpression(0.8, units.length),
      clearance: defaultLengthExpression(0.1, units.length),
      originX: zero,
      originY: zero,
      originZ: zero,
      starts: "1",
      phase: defaultAngleExpression(0, units.angle),
      runIn: zero,
      runOut: zero,
    }
  return {
    kind: parameters.kind,
    axis: typeof parameters.axis === "string" ? parameters.axis : "reference",
    axisReference: typeof parameters.axis === "string" ? null : parameters.axis,
    handedness: parameters.handedness,
    nominalDiameter: sourceExpression(parameters.nominalDiameter),
    pitch: sourceExpression(parameters.pitch),
    length: sourceExpression(parameters.length),
    depth: sourceExpression(parameters.depth),
    clearance: sourceExpression(parameters.clearance),
    ...threadOriginValues(parameters, units),
    starts: sourceExpression(parameters.starts),
    phase: sourceExpression(parameters.phase),
    runIn: sourceExpression(parameters.runIn),
    runOut: sourceExpression(parameters.runOut),
  }
}
const creators = {
  length: (value: number, expression: string) => createLengthQuantity(value, "mm", expression),
  angle: (value: number, expression: string) => createAngleQuantity(value, "rad", expression),
  scalar: (value: number, expression: string) => createScalarQuantity(value, expression),
}
const dimensionMessages = {
  length: "invalidDimension",
  angle: "invalidAngleDimension",
  scalar: "invalidScalarDimension",
} as const
type EvaluatedVariables = Extract<
  ReturnType<typeof evaluateVariableDefinitions>,
  { ok: true }
>["valuesByName"]
function parseQuantity(
  raw: string,
  field: ThreadQuantityField,
  variables: EvaluatedVariables,
  units: DocumentDisplayUnits,
  copy: ThreadValidationCopy,
) {
  const config = quantityFields[field]
  const expression =
    config.dimension === "scalar"
      ? raw.trim()
      : normalizeExpressionWithDisplayUnit(raw, units[config.dimension])
  const result = evaluateExpression(expression, variables)
  if (!result.ok) return { ok: false as const, message: copy.invalidExpression }
  if (result.value.dimension !== config.dimension)
    return { ok: false as const, message: copy[dimensionMessages[config.dimension]] }
  const quantity = creators[config.dimension](result.value.value, expression)
  return config.schema.safeParse(quantity).success
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy[config.message] }
}
function geometryMessage(
  field: string,
  quantities: Partial<Record<ThreadQuantityField, Quantity>>,
  copy: ThreadValidationCopy,
) {
  switch (field) {
    case "length":
      return copy.invalidBand
    case "pitch":
      return copy.invalidTurns
    case "depth":
      return (quantities.depth?.value ?? 0) > 0.75 * (quantities.pitch?.value ?? 0)
        ? copy.invalidDepth
        : copy.invalidRootRadius
    default:
      return copy.validationSummary
  }
}
type ParsedThreadForm =
  | { ok: true; parameters: ThreadFeatureParameters | ThreadFeatureParametersV2 }
  | { ok: false; issues: Partial<Record<ThreadQuantityField, string>> }
function threadFormAxis(values: ThreadFormValues, origin: readonly (number | undefined)[]) {
  if (values.axis === "reference") return values.axisReference
  const direction = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[values.axis]
  return { kind: "explicit-axis", origin, direction }
}
function threadFormGeometryIssues(
  error: { issues: readonly { path: PropertyKey[] }[] },
  quantities: Partial<Record<ThreadQuantityField, Quantity>>,
  copy: ThreadValidationCopy,
) {
  const issues: Partial<Record<ThreadQuantityField, string>> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (field === "axis") issues.originX = copy.validationSummary
    if (field === "length" || field === "pitch" || field === "depth" || field === "starts")
      issues[field] = geometryMessage(field, quantities, copy)
  }
  return issues
}
export function parseThreadForm(
  values: ThreadFormValues,
  mode: ThreadFormMode,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: ThreadValidationCopy,
): ParsedThreadForm {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return { ok: false, issues: { nominalDiameter: copy.invalidExpression } }
  const quantities: Partial<Record<ThreadQuantityField, Quantity>> = {},
    issues: Partial<Record<ThreadQuantityField, string>> = {}
  for (const field of [...threadCoreFields, ...threadAdvancedFields]) {
    const result = parseQuantity(values[field], field, evaluated.valuesByName, units, copy)
    if (result.ok) quantities[field] = result.quantity
    else issues[field] = result.message
  }
  if (Object.keys(issues).length) return { ok: false, issues }
  const { originX, originY, originZ, ...dimensions } = quantities
  const legacy = threadFeatureParametersSchema.safeParse({
    ...dimensions,
    targetBody: threadTargetBody(mode),
    kind: values.kind,
    axis: values.axis,
    handedness: values.handedness,
    origin: { x: originX, y: originY, z: originZ },
  })
  if (legacy.success && (mode.kind !== "edit" || mode.feature.type.schemaVersion === 1))
    return { ok: true, parameters: legacy.data }
  const axis = threadFormAxis(values, [originX?.value, originY?.value, originZ?.value])
  const parsed = threadFeatureParametersV2Schema.safeParse({
    ...dimensions,
    targetBody: threadTargetBody(mode),
    kind: values.kind,
    axis,
    handedness: values.handedness,
  })
  if (parsed.success) return { ok: true, parameters: parsed.data }
  return { ok: false, issues: threadFormGeometryIssues(parsed.error, quantities, copy) }
}
export function threadFeatureRecord(
  mode: ThreadFormMode,
  featureId: FeatureId,
  parsed: Extract<ParsedThreadForm, { ok: true }>,
) {
  const parameters = parsed.parameters
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? {
          ...mode.feature,
          type: "origin" in parameters ? threadFeatureType.type : threadFeatureTypeV2.type,
          parameters,
          dependencies:
            "origin" in parameters
              ? [parameters.targetBody.featureId]
              : referenceFrameDependencyIds(parameters.targetBody.featureId, parameters.axis),
          references: [],
        }
      : {
          schemaVersion: 0,
          id: featureId,
          type: "origin" in parameters ? threadFeatureType.type : threadFeatureTypeV2.type,
          parameters,
          dependencies:
            "origin" in parameters
              ? [parameters.targetBody.featureId]
              : referenceFrameDependencyIds(parameters.targetBody.featureId, parameters.axis),
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
