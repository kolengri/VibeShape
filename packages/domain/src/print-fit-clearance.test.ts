import { describe, expect, it } from "bun:test"
import { variableIdSchema } from "./identifiers"
import {
  printFitClearance,
  printFitHoleExpression,
  withPrintFitClearance,
} from "./print-fit-clearance"
import {
  evaluateExpression,
  evaluateVariableDefinitions,
  type VariableDefinition,
} from "./variables"

const id = variableIdSchema.parse("00000000-0000-7000-8000-000000000001")
describe("explicit radial print fit clearance", () => {
  it("creates a length definition only on an explicit proposal and preserves unrelated definitions", () => {
    const original: VariableDefinition[] = [
      { schemaVersion: 0, id, name: "width", expression: "10 mm" },
    ]
    const result = withPrintFitClearance(original, "0.2 mm", () =>
      variableIdSchema.parse("00000000-0000-7000-8000-000000000002"),
    )
    expect(original).toHaveLength(1)
    expect(result?.[0]).toBe(original[0])
    expect(result && printFitClearance(result)).toBe(0.2)
  })
  it("accepts unit conversions, updates by stable identity and rejects dimension or sign mistakes", () => {
    const variables: VariableDefinition[] = [
      { schemaVersion: 0, id, name: "tolerance", expression: "0.01 in" },
    ]
    expect(printFitClearance(variables)).toBeCloseTo(0.254)
    const update = withPrintFitClearance(variables, "0.3 mm", () => {
      throw new Error("must retain ID")
    })
    expect(update?.[0]?.id).toBe(id)
    expect(withPrintFitClearance(variables, "3 deg", () => id)).toBeNull()
    expect(withPrintFitClearance(variables, "-1 mm", () => id)).toBeNull()
    expect(
      printFitClearance([{ ...(variables[0] as VariableDefinition), expression: "2" }]),
    ).toBeNull()
  })
  it("keeps diameter compensation at twice the radial value and responds to variable updates", () => {
    const expression = printFitHoleExpression(4)
    expect(expression).toBe("4 mm + 2 * #tolerance")
    for (const radial of [0.1, 0.3]) {
      const values = evaluateVariableDefinitions([
        { schemaVersion: 0, id, name: "tolerance", expression: `${radial} mm` },
      ])
      if (!values.ok) throw new Error("Invalid fixture")
      const evaluated = evaluateExpression(expression, values.valuesByName)
      expect(evaluated.ok && evaluated.value.value).toBeCloseTo(4 + 2 * radial)
    }
  })
})
