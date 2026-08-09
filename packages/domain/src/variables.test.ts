import { describe, expect, it } from "vitest"
import { createAngleQuantity, createLengthQuantity } from "./units"
import {
  evaluateExpression,
  evaluateVariableDefinitions,
  resolveQuantityExpression,
  rewriteParameterVariableReferences,
  rewriteVariableReferencesInExpression,
  variableDefinitionsSchema,
} from "./variables"

const variableIds = {
  width: "0195b5ac-b210-7a2c-8c33-67a36a7f21ac",
  depth: "0195b5ac-b211-7a2c-8c33-67a36a7f21ac",
  ratio: "0195b5ac-b212-7a2c-8c33-67a36a7f21ac",
} as const

function variable(id: string, name: string, expression: string) {
  return { schemaVersion: 0, id, name, expression }
}

describe("document variables", () => {
  it("evaluates forward references with units and deterministic dimensional arithmetic", () => {
    const result = evaluateVariableDefinitions([
      variable(variableIds.depth, "depth", "#width / 2 + 0.5 cm"),
      variable(variableIds.width, "width", "2 * (10 mm + 1 cm)"),
      variable(variableIds.ratio, "ratio", "#depth / #width"),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.valuesByName.get("width")?.value).toEqual({ dimension: "length", value: 40 })
    expect(result.valuesByName.get("depth")?.value).toEqual({ dimension: "length", value: 25 })
    expect(result.valuesByName.get("ratio")?.value).toEqual({
      dimension: "scalar",
      value: 0.625,
    })
    expect(result.valuesByName.get("depth")?.dependencies).toEqual(["width"])
  })

  it("supports length and angle literals while retaining scalar unary operations", () => {
    expect(evaluateExpression("-2 * 1 in + 4 mm", new Map())).toEqual({
      ok: true,
      value: { dimension: "length", value: -46.8 },
      references: [],
    })
    expect(evaluateExpression("180 deg / 2", new Map())).toEqual({
      ok: true,
      value: { dimension: "angle", value: Math.PI / 2 },
      references: [],
    })
  })

  it.each([
    {
      definitions: [variable(variableIds.width, "width", "#missing + 1 mm")],
      code: "unknown-variable",
    },
    {
      definitions: [
        variable(variableIds.width, "width", "#depth"),
        variable(variableIds.depth, "depth", "#width"),
      ],
      code: "cyclic-variable-dependency",
    },
    {
      definitions: [variable(variableIds.width, "width", "1 mm + 1")],
      code: "expression-dimension-mismatch",
    },
    {
      definitions: [variable(variableIds.width, "width", "1 / 0")],
      code: "expression-division-by-zero",
    },
    {
      definitions: [variable(variableIds.width, "width", "1 parsec")],
      code: "unknown-expression-unit",
    },
  ])("rejects invalid variable tables with $code", ({ definitions, code }) => {
    expect(evaluateVariableDefinitions(definitions)).toMatchObject({
      ok: false,
      diagnostic: { code },
    })
    expect(variableDefinitionsSchema.safeParse(definitions).success).toBe(false)
  })

  it("rejects duplicate stable IDs and names", () => {
    expect(
      evaluateVariableDefinitions([
        variable(variableIds.width, "width", "1 mm"),
        variable(variableIds.width, "depth", "2 mm"),
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-variable-id" } })
    expect(
      evaluateVariableDefinitions([
        variable(variableIds.width, "width", "1 mm"),
        variable(variableIds.depth, "width", "2 mm"),
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-variable-name" } })
  })

  it("bounds dependency depth before recursive evaluation can exhaust the runtime stack", () => {
    const definitions = Array.from({ length: 258 }, (_, index) =>
      variable(
        `0195b5ac-b210-7a2c-8c33-${index.toString(16).padStart(12, "0")}`,
        `value${index}`,
        index === 257 ? "1" : `#value${index + 1}`,
      ),
    )

    expect(evaluateVariableDefinitions(definitions)).toMatchObject({
      ok: false,
      diagnostic: { code: "expression-too-complex" },
    })
  })

  it("resolves parameter expressions into the parameter's retained display unit", () => {
    const variables = evaluateVariableDefinitions([variable(variableIds.width, "width", "50 mm")])
    if (!variables.ok) throw new Error(variables.diagnostic.message)

    expect(
      resolveQuantityExpression(
        createLengthQuantity(1, "cm", "#width / 2"),
        variables.valuesByName,
      ),
    ).toEqual({
      ok: true,
      quantity: createLengthQuantity(2.5, "cm", "#width / 2"),
    })
    expect(
      resolveQuantityExpression(createAngleQuantity(1, "rad", "#width"), variables.valuesByName),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "expression-dimension-mismatch" },
    })
  })

  it("rewrites only exact variable tokens while preserving expression formatting", () => {
    expect(
      rewriteVariableReferencesInExpression(
        "#width + #width_extra + (#width / 2)",
        "width",
        "span",
      ),
    ).toBe("#span + #width_extra + (#span / 2)")
    expect(rewriteVariableReferencesInExpression("#width", "width", "width")).toBe("#width")
    expect(rewriteVariableReferencesInExpression("not an expression", "width", "span")).toBe(
      "not an expression",
    )
  })

  it("rewrites quantity sources in nested parameters without changing arbitrary strings", () => {
    const parameters = {
      dimensions: [
        createLengthQuantity(20, "mm", "#width"),
        { offset: createLengthQuantity(10, "mm", "#width / 2") },
      ],
      metadata: "#width",
    }

    expect(rewriteParameterVariableReferences(parameters, "width", "span")).toEqual({
      ok: true,
      value: {
        dimensions: [
          createLengthQuantity(20, "mm", "#span"),
          { offset: createLengthQuantity(10, "mm", "#span / 2") },
        ],
        metadata: "#width",
      },
    })
    expect(parameters.dimensions[0]).toEqual(createLengthQuantity(20, "mm", "#width"))
  })

  it("rejects a refactor that would exceed the quantity expression limit", () => {
    const expression = `#a${"+1".repeat(126)}`
    expect(expression).toHaveLength(254)
    expect(
      rewriteParameterVariableReferences(
        createLengthQuantity(1, "mm", expression),
        "a",
        "longName",
      ),
    ).toMatchObject({ ok: false })
  })
})
