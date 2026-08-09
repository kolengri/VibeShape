import {
  createLengthQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  type LengthQuantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { FeatureMutationResult } from "../../document/document-controller"

export type PrimitiveLengthCopy = Readonly<{
  invalidExpression: string
  invalidDimension: string
  invalidRange: string
}>

export function quantityExpression(quantity: LengthQuantity) {
  return quantity.source.expression ?? `${quantity.source.value} ${quantity.source.unit}`
}

export function parsePrimitiveLengthExpression(
  rawExpression: string,
  variables: readonly VariableDefinition[],
  copy: PrimitiveLengthCopy,
  accepts: (quantity: LengthQuantity) => boolean,
) {
  const expression = rawExpression.trim()
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return { ok: false as const, message: copy.invalidExpression }
  const evaluated = evaluateExpression(expression, evaluatedVariables.valuesByName)
  if (!evaluated.ok) return { ok: false as const, message: copy.invalidExpression }
  if (evaluated.value.dimension !== "length") {
    return { ok: false as const, message: copy.invalidDimension }
  }
  const quantity = createLengthQuantity(evaluated.value.value, "mm", expression)
  return accepts(quantity)
    ? { ok: true as const, quantity }
    : { ok: false as const, message: copy.invalidRange }
}

export function featureSubmissionMessage(
  result: FeatureMutationResult,
  copy: Readonly<{ staleRevision: string; saveFailed: string }>,
) {
  if (result.ok) return null
  if (
    result.diagnostic.sourceCode === "stale-revision" ||
    result.diagnostic.code === "write-access-unavailable"
  ) {
    return copy.staleRevision
  }
  return copy.saveFailed
}
