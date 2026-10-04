import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  type Quantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type PatternFeatureParameters,
  patternAngleSchema,
  patternCountSchema,
  patternFeatureParametersSchema,
  patternFeatureParametersV2Schema,
  patternFeatureType,
  patternFeatureTypeV2,
  patternSpacingSchema,
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "@vibeshape/domain/part-design-pattern"
import { type ReferenceAxis, referenceFrameDependencyIds } from "@vibeshape/domain/reference-frame"
import {
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import { bodyFeatureRecord } from "../part-design/body-feature-record"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
} from "../part-design/primitive-form"

export type PatternFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }
export type PatternFormValues = {
  kind: "linear" | "circular"
  axis: "X" | "Y" | "Z"
  count: string
  spacing: string
  angle: string
  centerX: string
  centerY: string
  centerZ: string
}
export type PatternValidationCopy = PrimitiveLengthCopy & {
  invalidCountDimension: string
  invalidCountRange: string
  invalidAngleDimension: string
  invalidAngleRange: string
  invalidCenterRange: string
  invalidSpan: string
}
type ParsedPatternForm =
  | { ok: false; issues: Partial<Record<keyof PatternFormValues, string>> }
  | {
      ok: true
      parameters:
        | Omit<Extract<PatternFeatureParameters, { kind: "linear" }>, "targetBody">
        | Omit<Extract<PatternFeatureParameters, { kind: "circular" }>, "targetBody">
    }
function sourceExpression(quantity: Quantity) {
  return (
    quantity.source.expression ??
    (quantity.dimension === "scalar"
      ? String(quantity.source.value)
      : `${quantity.source.value} ${quantity.source.unit}`)
  )
}
export function patternTargetBody(mode: PatternFormMode) {
  return mode.kind === "create"
    ? mode.targetBody
    : (
        readPatternFeatureParametersV2(mode.feature) ??
        patternFeatureParametersSchema.parse(mode.feature.parameters)
      ).targetBody
}
export function patternFormValues(
  mode: PatternFormMode,
  units: DocumentDisplayUnits,
): PatternFormValues {
  const parameters = mode.kind === "edit" ? readPatternFeatureParameters(mode.feature) : null
  const zero = defaultLengthExpression(0, units.length)
  const defaults: PatternFormValues = {
    kind: "linear",
    axis: "X",
    count: "3",
    spacing: defaultLengthExpression(30, units.length),
    angle: units.angle === "deg" ? "360 deg" : `${2 * Math.PI} rad`,
    centerX: zero,
    centerY: zero,
    centerZ: zero,
  }
  const referenceParameters =
    mode.kind === "edit" ? readPatternFeatureParametersV2(mode.feature) : null
  if (referenceParameters)
    return {
      ...defaults,
      kind: referenceParameters.kind,
      axis: referenceParameters.axis.kind === "origin-axis" ? referenceParameters.axis.axis : "Z",
      count: sourceExpression(referenceParameters.count),
      ...(referenceParameters.kind === "linear"
        ? { spacing: sourceExpression(referenceParameters.spacing) }
        : { angle: sourceExpression(referenceParameters.angle) }),
    }
  if (!parameters) return defaults
  const common = {
    ...defaults,
    kind: parameters.kind,
    axis: parameters.axis,
    count: sourceExpression(parameters.count),
  }
  return parameters.kind === "linear"
    ? { ...common, spacing: sourceExpression(parameters.spacing) }
    : {
        ...common,
        angle: sourceExpression(parameters.angle),
        centerX: sourceExpression(parameters.center.x),
        centerY: sourceExpression(parameters.center.y),
        centerZ: sourceExpression(parameters.center.z),
      }
}
function evaluateDimension(
  raw: string,
  variables: readonly VariableDefinition[],
  dimension: "scalar" | "angle",
  units: DocumentDisplayUnits,
  copy: PatternValidationCopy,
) {
  const expression =
    dimension === "scalar" ? raw.trim() : normalizeExpressionWithDisplayUnit(raw, units.angle)
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return { ok: false as const, message: copy.invalidExpression }
  const result = evaluateExpression(expression, evaluatedVariables.valuesByName)
  if (!result.ok) return { ok: false as const, message: copy.invalidExpression }
  if (result.value.dimension !== dimension)
    return {
      ok: false as const,
      message: dimension === "scalar" ? copy.invalidCountDimension : copy.invalidAngleDimension,
    }
  return { ok: true as const, value: result.value.value, expression }
}
function parseCount(
  values: PatternFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PatternValidationCopy,
) {
  const result = evaluateDimension(values.count, variables, "scalar", units, copy)
  if (!result.ok) return result
  const quantity = createScalarQuantity(result.value, result.expression)
  return patternCountSchema.safeParse(quantity).success
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy.invalidCountRange }
}
function parseAngle(
  values: PatternFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PatternValidationCopy,
) {
  const result = evaluateDimension(values.angle, variables, "angle", units, copy)
  if (!result.ok) return result
  const quantity = createAngleQuantity(result.value, "rad", result.expression)
  return patternAngleSchema.safeParse(quantity).success
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy.invalidAngleRange }
}
function parseCenter(
  values: PatternFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PatternValidationCopy,
) {
  const centerCopy = { ...copy, invalidRange: copy.invalidCenterRange }
  const parse = (raw: string) =>
    parsePrimitiveLengthExpression(
      raw,
      variables,
      centerCopy,
      ({ value }) => Math.abs(value) <= 100_000,
      units.length,
    )
  const x = parse(values.centerX),
    y = parse(values.centerY),
    z = parse(values.centerZ)
  const issues = Object.fromEntries(
    (
      [
        ["centerX", x],
        ["centerY", y],
        ["centerZ", z],
      ] as const
    ).flatMap(([field, result]) => (result.ok ? [] : [[field, result.message]])),
  )
  if (!x.ok || !y.ok || !z.ok) return { ok: false as const, issues }
  return { ok: true as const, center: { x: x.quantity, y: y.quantity, z: z.quantity } }
}
export function parsePatternForm(
  values: PatternFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PatternValidationCopy,
  referenceAxis?: ReferenceAxis,
): ParsedPatternForm {
  const count = parseCount(values, variables, units, copy)
  if (!count.ok) return { ok: false as const, issues: { count: count.message } }
  const common = { count: count.quantity, axis: values.axis }
  if (values.kind === "circular") {
    const angle = parseAngle(values, variables, units, copy)
    const center = referenceAxis
      ? {
          ok: true as const,
          center: {
            x: createLengthQuantity(0, "mm"),
            y: createLengthQuantity(0, "mm"),
            z: createLengthQuantity(0, "mm"),
          },
        }
      : parseCenter(values, variables, units, copy)
    if (!angle.ok || !center.ok)
      return {
        ok: false as const,
        issues: {
          ...(angle.ok ? {} : { angle: angle.message }),
          ...(center.ok ? {} : center.issues),
        },
      }
    return {
      ok: true as const,
      parameters: {
        ...common,
        kind: "circular" as const,
        angle: angle.quantity,
        center: center.center,
      },
    }
  }
  const spacing = parsePrimitiveLengthExpression(
    values.spacing,
    variables,
    copy,
    (quantity) => patternSpacingSchema.safeParse(quantity).success,
    units.length,
  )
  if (!spacing.ok) return { ok: false as const, issues: { spacing: spacing.message } }
  if (Math.abs((count.quantity.value - 1) * spacing.quantity.value) > 100_000)
    return { ok: false as const, issues: { spacing: copy.invalidSpan } }
  return {
    ok: true as const,
    parameters: { ...common, kind: "linear" as const, spacing: spacing.quantity },
  }
}
export function patternFeatureRecord(
  mode: PatternFormMode,
  featureId: FeatureId,
  parsed: Extract<ReturnType<typeof parsePatternForm>, { ok: true }>,
  referenceAxis?: ReferenceAxis | undefined,
) {
  const targetBody = patternTargetBody(mode)
  const v2 =
    referenceAxis !== undefined || (mode.kind === "edit" && mode.feature.type.schemaVersion === 2)
  const support = referenceAxis ?? { kind: "origin-axis" as const, axis: parsed.parameters.axis }
  const parameters = v2
    ? patternFeatureParametersV2Schema.parse({
        targetBody,
        kind: parsed.parameters.kind,
        count: parsed.parameters.count,
        axis: support,
        ...(parsed.parameters.kind === "linear"
          ? { spacing: parsed.parameters.spacing }
          : { angle: parsed.parameters.angle }),
      })
    : patternFeatureParametersSchema.parse({ ...parsed.parameters, targetBody })
  const type = v2 ? patternFeatureTypeV2.type : patternFeatureType.type
  const dependencies = v2
    ? referenceFrameDependencyIds(targetBody.featureId, support)
    : [targetBody.featureId]
  return bodyFeatureRecord(mode, featureId, { type, parameters, dependencies })
}
