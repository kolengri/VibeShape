import { expectedPathPatternDependencyIds } from "@vibeshape/application/feature-rebuild"
import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  type DocumentDisplayUnits,
  type DocumentSnapshot,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  type Quantity,
  type SketchEntityId,
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
import {
  type PatternFeatureParametersV3,
  pathPatternDistanceSchema,
  pathPatternStartOffsetSchema,
  patternFeatureParametersV3Schema,
  patternFeatureTypeV3,
  readPatternFeatureParametersV3,
} from "@vibeshape/domain/part-design-pattern-path"
import { type ReferenceAxis, referenceFrameDependencyIds } from "@vibeshape/domain/reference-frame"
import { sketchPathSelectorSchema } from "@vibeshape/domain/sketch-path-selector"
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
  kind: "linear" | "circular" | "path"
  axis: "X" | "Y" | "Z"
  count: string
  spacing: string
  angle: string
  centerX: string
  centerY: string
  centerZ: string
  pathSketchId: string
  entityIds: SketchEntityId[]
  startPointId: string
  spacingMode: "equal" | "fixed"
  startOffset: string
  orientation: "translate" | "follow"
  reverse: boolean
}
export type PatternValidationCopy = PrimitiveLengthCopy & {
  invalidCountDimension: string
  invalidCountRange: string
  invalidAngleDimension: string
  invalidAngleRange: string
  invalidCenterRange: string
  invalidSpan: string
  invalidPath: string
}
type ParsedPatternForm =
  | { ok: false; issues: Partial<Record<keyof PatternFormValues, string>> }
  | {
      ok: true
      parameters:
        | Omit<Extract<PatternFeatureParameters, { kind: "linear" }>, "targetBody">
        | Omit<Extract<PatternFeatureParameters, { kind: "circular" }>, "targetBody">
        | Omit<PatternFeatureParametersV3, "targetBody">
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
        readPatternFeatureParametersV3(mode.feature) ??
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
    pathSketchId: "",
    entityIds: [],
    startPointId: "",
    spacingMode: "equal",
    startOffset: zero,
    orientation: "translate",
    reverse: false,
  }
  const pathParameters = mode.kind === "edit" ? readPatternFeatureParametersV3(mode.feature) : null
  if (pathParameters) return pathFormValues(defaults, pathParameters)
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
function pathFormValues(
  defaults: PatternFormValues,
  parameters: PatternFeatureParametersV3,
): PatternFormValues {
  return {
    ...defaults,
    kind: "path",
    count: sourceExpression(parameters.count),
    pathSketchId: parameters.path.sketchId,
    entityIds: [...parameters.path.entityIds],
    startPointId: parameters.path.startPointId,
    spacingMode: parameters.spacing.mode,
    ...(parameters.spacing.mode === "fixed"
      ? { spacing: sourceExpression(parameters.spacing.distance) }
      : {}),
    startOffset: sourceExpression(parameters.startOffset),
    orientation: parameters.orientation,
    reverse: parameters.reverse,
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
function parsePathSelector(values: PatternFormValues) {
  return (
    sketchPathSelectorSchema.safeParse({
      schemaVersion: 0,
      sketchId: values.pathSketchId,
      entityIds: [...values.entityIds].sort(),
      startPointId: values.startPointId,
    }).data ?? null
  )
}
type ParseInput = Readonly<{
  values: PatternFormValues
  count: ReturnType<typeof createScalarQuantity>
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PatternValidationCopy
}>
function parseLength(input: ParseInput, raw: string, valid: (quantity: Quantity) => boolean) {
  return parsePrimitiveLengthExpression(raw, input.variables, input.copy, valid, input.units.length)
}
/** Equal spacing needs no distance; fixed spacing parses its expression. */
function parsePathDistance(input: ParseInput) {
  if (input.values.spacingMode !== "fixed") return { ok: true as const, quantity: null }
  return parseLength(
    input,
    input.values.spacing,
    (quantity) => pathPatternDistanceSchema.safeParse(quantity).success,
  )
}
function pathIssues(
  input: ParseInput,
  path: ReturnType<typeof parsePathSelector>,
  offset: ReturnType<typeof parseLength>,
  distance: ReturnType<typeof parsePathDistance>,
): Partial<Record<keyof PatternFormValues, string>> {
  return {
    ...(path ? {} : { entityIds: input.copy.invalidPath }),
    ...(offset.ok ? {} : { startOffset: offset.message }),
    ...(distance.ok ? {} : { spacing: distance.message }),
  }
}
function parsePathPattern(input: ParseInput): ParsedPatternForm {
  const { values, count, copy } = input
  const offset = parseLength(
    input,
    values.startOffset,
    (quantity) => pathPatternStartOffsetSchema.safeParse(quantity).success,
  )
  const distance = parsePathDistance(input)
  const path = parsePathSelector(values)
  if (!path || !offset.ok || !distance.ok)
    return { ok: false, issues: pathIssues(input, path, offset, distance) }
  const travel = (count.value - 1) * (distance.quantity?.value ?? 0)
  if (offset.quantity.value + travel > 100_000)
    return { ok: false, issues: { spacing: copy.invalidSpan } }
  return {
    ok: true,
    parameters: {
      kind: "path",
      count,
      path,
      spacing: distance.quantity
        ? { mode: "fixed", distance: distance.quantity }
        : { mode: "equal" },
      startOffset: offset.quantity,
      orientation: values.orientation,
      reverse: values.reverse,
    },
  }
}
const ZERO_CENTER = {
  x: createLengthQuantity(0, "mm"),
  y: createLengthQuantity(0, "mm"),
  z: createLengthQuantity(0, "mm"),
}
/** A reference axis owns the circular center, so legacy center fields are not parsed. */
function parseCircularPattern(input: ParseInput, referenceAxis: ReferenceAxis | undefined) {
  const { values, variables, units, copy, count } = input
  const angle = parseAngle(values, variables, units, copy)
  const center = referenceAxis
    ? { ok: true as const, center: ZERO_CENTER }
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
      count,
      axis: values.axis,
      kind: "circular" as const,
      angle: angle.quantity,
      center: center.center,
    },
  }
}
function parseLinearPattern(input: ParseInput): ParsedPatternForm {
  const { values, count, copy } = input
  const spacing = parseLength(
    input,
    values.spacing,
    (quantity) => patternSpacingSchema.safeParse(quantity).success,
  )
  if (!spacing.ok) return { ok: false as const, issues: { spacing: spacing.message } }
  if (Math.abs((count.value - 1) * spacing.quantity.value) > 100_000)
    return { ok: false as const, issues: { spacing: copy.invalidSpan } }
  return {
    ok: true as const,
    parameters: { count, axis: values.axis, kind: "linear" as const, spacing: spacing.quantity },
  }
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
  const input = { values, count: count.quantity, variables, units, copy }
  if (values.kind === "path") return parsePathPattern(input)
  return values.kind === "circular"
    ? parseCircularPattern(input, referenceAxis)
    : parseLinearPattern(input)
}
function pathPatternFeatureRecord(
  mode: PatternFormMode,
  featureId: FeatureId,
  parameters: Omit<PatternFeatureParametersV3, "targetBody">,
  snapshot: DocumentSnapshot,
) {
  const authored = patternFeatureParametersV3Schema.parse({
    ...parameters,
    targetBody: patternTargetBody(mode),
  })
  return bodyFeatureRecord(mode, featureId, {
    type: patternFeatureTypeV3.type,
    parameters: authored,
    dependencies: expectedPathPatternDependencyIds(snapshot, authored),
  })
}
export function patternFeatureRecord(
  mode: PatternFormMode,
  featureId: FeatureId,
  parsed: Extract<ReturnType<typeof parsePatternForm>, { ok: true }>,
  referenceAxis?: ReferenceAxis | undefined,
  snapshot?: DocumentSnapshot,
) {
  if (parsed.parameters.kind === "path") {
    if (!snapshot) throw new Error("A path pattern requires the current document snapshot.")
    return pathPatternFeatureRecord(mode, featureId, parsed.parameters, snapshot)
  }
  const linearOrCircular = parsed.parameters
  const targetBody = patternTargetBody(mode)
  const v2 =
    referenceAxis !== undefined || (mode.kind === "edit" && mode.feature.type.schemaVersion === 2)
  const support = referenceAxis ?? { kind: "origin-axis" as const, axis: linearOrCircular.axis }
  const parameters = v2
    ? patternFeatureParametersV2Schema.parse({
        targetBody,
        kind: linearOrCircular.kind,
        count: linearOrCircular.count,
        axis: support,
        ...(linearOrCircular.kind === "linear"
          ? { spacing: linearOrCircular.spacing }
          : { angle: linearOrCircular.angle }),
      })
    : patternFeatureParametersSchema.parse({ ...linearOrCircular, targetBody })
  const type = v2 ? patternFeatureTypeV2.type : patternFeatureType.type
  const dependencies = v2
    ? referenceFrameDependencyIds(targetBody.featureId, support)
    : [targetBody.featureId]
  return bodyFeatureRecord(mode, featureId, { type, parameters, dependencies })
}
