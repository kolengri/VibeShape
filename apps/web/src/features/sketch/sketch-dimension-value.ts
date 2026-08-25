import {
  createAngleQuantity,
  createLengthQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type SketchDimensionValue,
  type SketchEntity,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import {
  createSketchDimensionConstraint,
  type SketchDimensionKind,
} from "./sketch-constraint-tools"

export function defaultSketchDimensionExpression(
  kind: SketchDimensionKind,
  canonicalValue: number,
  displayUnits: DocumentDisplayUnits,
) {
  return kind === "angle"
    ? defaultAngleExpression(canonicalValue, displayUnits.angle)
    : defaultLengthExpression(canonicalValue, displayUnits.length)
}

export function evaluateSketchDimensionValue(
  kind: SketchDimensionKind,
  expression: string,
  variables: readonly VariableDefinition[],
  displayUnits: DocumentDisplayUnits,
): SketchDimensionValue | null {
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return null
  const normalizedExpression = normalizeExpressionWithDisplayUnit(
    expression,
    kind === "angle" ? displayUnits.angle : displayUnits.length,
  )
  const evaluated = evaluateExpression(normalizedExpression, evaluatedVariables.valuesByName)
  if (!evaluated.ok) return null
  if (kind === "angle") {
    return evaluated.value.dimension === "angle"
      ? createAngleQuantity(evaluated.value.value, "rad", normalizedExpression)
      : null
  }
  const validLength =
    evaluated.value.dimension === "length" &&
    (kind === "offset" ? evaluated.value.value !== 0 : evaluated.value.value > 0)
  return validLength
    ? createLengthQuantity(evaluated.value.value, "mm", normalizedExpression)
    : null
}

export function createSketchDimensionDefinition(
  kind: SketchDimensionKind,
  expression: string,
  entities: readonly SketchEntity[],
  variables: readonly VariableDefinition[],
  displayUnits: DocumentDisplayUnits,
) {
  const value = evaluateSketchDimensionValue(kind, expression, variables, displayUnits)
  return value ? createSketchDimensionConstraint(kind, entities, value) : null
}
