import type { VariableId } from "./identifiers"
import { evaluateVariableDefinitions, type VariableDefinition } from "./variables"

/** Explicit radial allowance; hole diameters use twice this length. */
export const PRINT_FIT_VARIABLE = "tolerance"
export const printFitPresets = [
  { id: "tight", valueMm: 0.1 },
  { id: "normal", valueMm: 0.2 },
  { id: "loose", valueMm: 0.3 },
] as const

export function printFitClearance(variables: readonly VariableDefinition[]) {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return null
  const value = evaluated.valuesByName.get(PRINT_FIT_VARIABLE)?.value
  return value?.dimension === "length" && value.value >= 0 ? value.value : null
}

/** Returns a complete ordinary variable-table proposal, preserving unrelated definitions. */
export function withPrintFitClearance(
  variables: readonly VariableDefinition[],
  expression: string,
  createId: () => VariableId,
): readonly VariableDefinition[] | null {
  const prior = variables.find(({ name }) => name === PRINT_FIT_VARIABLE)
  const proposed = prior
    ? variables.map((variable) => (variable === prior ? { ...variable, expression } : variable))
    : [
        ...variables,
        { schemaVersion: 0 as const, id: createId(), name: PRINT_FIT_VARIABLE, expression },
      ]
  return printFitClearance(proposed) === null ? null : proposed
}

export function printFitHoleExpression(nominalDiameterMm: number) {
  if (!Number.isFinite(nominalDiameterMm) || nominalDiameterMm <= 0)
    throw new Error("A fit hole requires a positive nominal diameter in millimeters.")
  return `${nominalDiameterMm} mm + 2 * #${PRINT_FIT_VARIABLE}`
}
