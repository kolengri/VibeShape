import { expect, it } from "bun:test"
import { createLengthQuantity, createScalarQuantity } from "./units"
import {
  inspectVariableReferencesInExpression,
  parameterExpressionReferences,
  parameterVariableReferences,
} from "./variables"

it("locates typed quantity expressions and preserves reference ordering", () => {
  const parameters = {
    label: "#width",
    expression: "#width",
    first: createLengthQuantity(2, "mm", "#width + #width_extra"),
    nested: [
      createScalarQuantity(2, "#count"),
      { value: createLengthQuantity(2, "mm", "#depth + #width") },
    ],
    literal: createLengthQuantity(5),
  }
  expect(parameterExpressionReferences(parameters)).toEqual([
    {
      path: ["nested", 1, "value"],
      expression: "#depth + #width",
      references: ["depth", "width"],
      diagnostic: null,
    },
    { path: ["nested", 0], expression: "#count", references: ["count"], diagnostic: null },
    {
      path: ["first"],
      expression: "#width + #width_extra",
      references: ["width", "width_extra"],
      diagnostic: null,
    },
  ])
  expect(parameterVariableReferences(parameters)).toEqual([
    "depth",
    "width",
    "count",
    "width_extra",
  ])
})

it("discloses lexical failures without inferring references from arbitrary text", () => {
  for (const expression of ["#width@", "width", "#", " #width"])
    expect(inspectVariableReferencesInExpression(expression)).toMatchObject({
      references: [],
      diagnostic: { code: "invalid-expression-syntax" },
    })
  expect(inspectVariableReferencesInExpression("#width + #width_extra + #width")).toEqual({
    references: ["width", "width_extra"],
    diagnostic: null,
  })
  expect(parameterVariableReferences({ value: createLengthQuantity(1, "mm", "#width@") })).toEqual(
    [],
  )
})
