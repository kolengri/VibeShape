import {
  createAngleQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type LengthQuantity,
  type Quantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type PlacementFeatureParameters,
  placementFeatureParametersSchema,
  placementFeatureType,
} from "@vibeshape/domain/part-design-placement"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
} from "../part-design/primitive-form"

export const placementAxes = ["x", "y", "z"] as const
type PlacementAxis = (typeof placementAxes)[number]
export type PlacementField =
  | `translation${Uppercase<PlacementAxis>}`
  | `rotation${Uppercase<PlacementAxis>}`
export type PlacementFormValues = Record<PlacementField, string>
export type PlacementFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }
export type PlacementValidationCopy = PrimitiveLengthCopy & {
  invalidAngleDimension: string
  invalidTranslationRange: string
  invalidRotationRange: string
}

const fieldNames = {
  translation: { x: "translationX", y: "translationY", z: "translationZ" },
  rotation: { x: "rotationX", y: "rotationY", z: "rotationZ" },
} as const
export function placementFieldName(
  group: "translation" | "rotation",
  axis: PlacementAxis,
): PlacementField {
  return fieldNames[group][axis]
}
function sourceExpression(quantity: Quantity) {
  return quantity.source.expression ?? `${quantity.source.value} ${quantity.source.unit}`
}
export function placementFormValues(
  mode: PlacementFormMode,
  units: DocumentDisplayUnits,
): PlacementFormValues {
  if (mode.kind === "edit") {
    const { translation, rotation } = placementFeatureParametersSchema.parse(
      mode.feature.parameters,
    )
    return {
      translationX: sourceExpression(translation.x),
      translationY: sourceExpression(translation.y),
      translationZ: sourceExpression(translation.z),
      rotationX: sourceExpression(rotation.x),
      rotationY: sourceExpression(rotation.y),
      rotationZ: sourceExpression(rotation.z),
    }
  }
  const length = defaultLengthExpression(0, units.length)
  const angle = defaultAngleExpression(0, units.angle)
  return {
    translationX: length,
    translationY: length,
    translationZ: length,
    rotationX: angle,
    rotationY: angle,
    rotationZ: angle,
  }
}
function parseRotation(
  raw: string,
  variables: readonly VariableDefinition[],
  unit: DocumentDisplayUnits["angle"],
  copy: PlacementValidationCopy,
) {
  const values = evaluateVariableDefinitions(variables)
  if (!values.ok) return { ok: false as const, message: copy.invalidExpression }
  const expression = normalizeExpressionWithDisplayUnit(raw, unit)
  const result = evaluateExpression(expression, values.valuesByName)
  if (!result.ok) return { ok: false as const, message: copy.invalidExpression }
  if (result.value.dimension !== "angle")
    return { ok: false as const, message: copy.invalidAngleDimension }
  const quantity = createAngleQuantity(result.value.value, "rad", expression)
  return boundedRotation(quantity, copy.invalidRotationRange)
}
function boundedRotation(quantity: ReturnType<typeof createAngleQuantity>, message: string) {
  return placementFeatureParametersSchema.shape.rotation.shape.x.safeParse(quantity).success
    ? { ok: true as const, quantity }
    : { ok: false as const, message }
}

type ParsedQuantity<Q extends Quantity> = { ok: true; quantity: Q } | { ok: false; message: string }
function parseVector<Q extends Quantity>(
  values: PlacementFormValues,
  group: "translation" | "rotation",
  parse: (raw: string) => ParsedQuantity<Q>,
) {
  const x = parse(values[placementFieldName(group, "x")])
  const y = parse(values[placementFieldName(group, "y")])
  const z = parse(values[placementFieldName(group, "z")])
  const issues = Object.fromEntries(
    (
      [
        ["x", x],
        ["y", y],
        ["z", z],
      ] as const
    ).flatMap(([axis, result]) =>
      result.ok ? [] : [[placementFieldName(group, axis), result.message]],
    ),
  )
  if (!x.ok || !y.ok || !z.ok) return { ok: false as const, issues }
  return { ok: true as const, vector: { x: x.quantity, y: y.quantity, z: z.quantity } }
}
export function parsePlacementForm(
  values: PlacementFormValues,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PlacementValidationCopy,
) {
  const lengthCopy = { ...copy, invalidRange: copy.invalidTranslationRange }
  const accepts = (quantity: LengthQuantity) =>
    placementFeatureParametersSchema.shape.translation.shape.x.safeParse(quantity).success
  const translation = parseVector(values, "translation", (raw) =>
    parsePrimitiveLengthExpression(raw, variables, lengthCopy, accepts, units.length),
  )
  const rotation = parseVector(values, "rotation", (raw) =>
    parseRotation(raw, variables, units.angle, copy),
  )
  if (!translation.ok || !rotation.ok)
    return {
      ok: false as const,
      issues: {
        ...(translation.ok ? {} : translation.issues),
        ...(rotation.ok ? {} : rotation.issues),
      },
    }
  return { ok: true as const, translation: translation.vector, rotation: rotation.vector }
}
export function placementFeatureRecord(
  mode: PlacementFormMode,
  featureId: FeatureId,
  parsed: Extract<ReturnType<typeof parsePlacementForm>, { ok: true }>,
) {
  const targetBody =
    mode.kind === "create"
      ? mode.targetBody
      : placementFeatureParametersSchema.parse(mode.feature.parameters).targetBody
  const parameters: PlacementFeatureParameters = {
    targetBody,
    translation: parsed.translation,
    rotation: parsed.rotation,
  }
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters }
      : {
          schemaVersion: 0,
          id: featureId,
          type: placementFeatureType.type,
          parameters,
          dependencies: [targetBody.featureId],
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
