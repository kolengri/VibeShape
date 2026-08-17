import {
  type DocumentDisplayUnits,
  type EvaluatedVariable,
  type ExpressionValue,
  evaluateExpression,
} from "@vibeshape/domain"
import { normalizeExpressionWithDisplayUnit } from "../../document/document-display-units"

export function stableSketchPatternScalar(value: number) {
  return Number(value.toPrecision(12)).toString()
}

export function evaluateSketchPatternExpression(
  expression: string,
  variables: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
  unit?: DocumentDisplayUnits["angle" | "length"],
) {
  const source = unit ? normalizeExpressionWithDisplayUnit(expression, unit) : expression.trim()
  const result = evaluateExpression(source, variables)
  return result.ok ? result.value : null
}
