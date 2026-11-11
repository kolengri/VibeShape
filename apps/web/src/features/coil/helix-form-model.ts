import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type Quantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  type HelixParameters,
  helixHeightSchema,
  helixPitchSchema,
  helixRadiusSchema,
  helixStartAngleSchema,
  helixTurnsSchema,
} from "@vibeshape/domain/part-design-helix"
import type { ReferenceAxis } from "@vibeshape/domain/reference-frame"
import type { z } from "zod"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"

export type HelixFormValues = {
  axis: ReferenceAxis | null
  handedness: "right" | "left"
  radius: string
  pitch: string
  extentKind: "turns" | "height"
  turns: string
  height: string
  startAngle: string
}
export type HelixQuantityField = "radius" | "pitch" | "turns" | "height" | "startAngle"
export type HelixFieldIssues = Partial<Record<HelixQuantityField | "axis", string>>
export type HelixValidationCopy = Readonly<{
  invalidExpression: string
  invalidDimension: string
  invalidRange: string
  missingAxis: string
}>

type Dimension = "length" | "angle" | "scalar"
const fields: Readonly<
  Record<HelixQuantityField, Readonly<{ dimension: Dimension; schema: z.ZodType }>>
> = {
  radius: { dimension: "length", schema: helixRadiusSchema },
  pitch: { dimension: "length", schema: helixPitchSchema },
  turns: { dimension: "scalar", schema: helixTurnsSchema },
  height: { dimension: "length", schema: helixHeightSchema },
  startAngle: { dimension: "angle", schema: helixStartAngleSchema },
}

export function sourceExpression(quantity: Quantity) {
  return (
    quantity.source.expression ??
    (quantity.dimension === "scalar"
      ? String(quantity.source.value)
      : `${quantity.source.value} ${quantity.source.unit}`)
  )
}

const defaultAxis: ReferenceAxis = { kind: "origin-axis", axis: "Z" }
export function helixFormValues(
  parameters: HelixParameters | null,
  units: DocumentDisplayUnits,
  defaults: Readonly<{ radius: number; pitch: number; turns: number }> = {
    radius: 10,
    pitch: 5,
    turns: 5,
  },
): HelixFormValues {
  if (!parameters)
    return {
      axis: defaultAxis,
      handedness: "right",
      radius: defaultLengthExpression(defaults.radius, units.length),
      pitch: defaultLengthExpression(defaults.pitch, units.length),
      extentKind: "turns",
      turns: String(defaults.turns),
      height: defaultLengthExpression(defaults.pitch * defaults.turns, units.length),
      startAngle: defaultAngleExpression(0, units.angle),
    }
  return {
    axis: parameters.axis,
    handedness: parameters.handedness,
    radius: sourceExpression(parameters.radius),
    pitch: sourceExpression(parameters.pitch),
    extentKind: parameters.extent.kind,
    turns:
      parameters.extent.kind === "turns"
        ? sourceExpression(parameters.extent.turns)
        : String(defaults.turns),
    height:
      parameters.extent.kind === "height"
        ? sourceExpression(parameters.extent.height)
        : defaultLengthExpression(defaults.pitch * defaults.turns, units.length),
    startAngle: sourceExpression(parameters.startAngle),
  }
}

type EvaluatedVariables = Extract<
  ReturnType<typeof evaluateVariableDefinitions>,
  { ok: true }
>["valuesByName"]
const creators = {
  length: (value: number, expression: string) => createLengthQuantity(value, "mm", expression),
  angle: (value: number, expression: string) => createAngleQuantity(value, "rad", expression),
  scalar: (value: number, expression: string) => createScalarQuantity(value, expression),
}

/** Evaluates one authored expression into a bounded quantity of the field's dimension. */
export function parseQuantityExpression<Q extends Quantity>(
  raw: string,
  dimension: Dimension,
  schema: z.ZodType<Q> | z.ZodType,
  variables: EvaluatedVariables,
  units: DocumentDisplayUnits,
  copy: Pick<HelixValidationCopy, "invalidExpression" | "invalidDimension" | "invalidRange">,
): { ok: true; quantity: Q } | { ok: false; message: string } {
  const expression =
    dimension === "scalar" ? raw.trim() : normalizeExpressionWithDisplayUnit(raw, units[dimension])
  const result = evaluateExpression(expression, variables)
  if (!result.ok) return { ok: false, message: copy.invalidExpression }
  if (result.value.dimension !== dimension) return { ok: false, message: copy.invalidDimension }
  const quantity = creators[dimension](result.value.value, expression)
  const parsed = schema.safeParse(quantity)
  return parsed.success
    ? { ok: true, quantity: parsed.data as Q }
    : { ok: false, message: copy.invalidRange }
}

export type ParsedHelixForm =
  | { ok: true; parameters: HelixParameters }
  | { ok: false; issues: HelixFieldIssues }

/** Field-level parsing; cross-field coil/sweep rules are applied by the feature schema. */
export function parseHelixForm(
  values: HelixFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: HelixValidationCopy,
): ParsedHelixForm {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return { ok: false, issues: { radius: copy.invalidExpression } }
  const issues: HelixFieldIssues = {}
  const quantities: Partial<Record<HelixQuantityField, Quantity>> = {}
  const active: readonly HelixQuantityField[] = ["radius", "pitch", values.extentKind, "startAngle"]
  for (const field of active) {
    const config = fields[field]
    const result = parseQuantityExpression(
      values[field],
      config.dimension,
      config.schema,
      evaluated.valuesByName,
      units,
      copy,
    )
    if (result.ok) quantities[field] = result.quantity
    else issues[field] = result.message
  }
  if (!values.axis) issues.axis = copy.missingAxis
  const { radius, pitch, turns, height, startAngle } = quantities
  if (Object.keys(issues).length || !values.axis || !radius || !pitch || !startAngle)
    return { ok: false, issues }
  const extent =
    values.extentKind === "turns"
      ? turns && { kind: "turns" as const, turns }
      : height && { kind: "height" as const, height }
  if (!extent) return { ok: false, issues }
  return {
    ok: true,
    parameters: {
      axis: values.axis,
      handedness: values.handedness,
      radius,
      pitch,
      extent,
      startAngle,
    } as HelixParameters,
  }
}
