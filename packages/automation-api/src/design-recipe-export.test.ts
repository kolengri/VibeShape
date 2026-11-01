import { describe, expect, it } from "bun:test"
import {
  designRecipeExportResultContextMatches,
  localOperationSchema,
  localToolOutputs,
} from "./local-tools"
import { localToolDescriptions } from "./tool-metadata"

const documentId = "0195b5ac-b250-7a2c-8c33-000000000100"
const operation = { tool: "export_design_recipe", arguments: { revision: 4 } } as const
describe("paired design recipe export contract", () => {
  it("requires a revision, denies extra execution fields, and binds result context", () => {
    expect(localOperationSchema.safeParse(operation).success).toBe(true)
    expect(
      localOperationSchema.safeParse({ ...operation, arguments: { revision: 4, execute: true } })
        .success,
    ).toBe(false)
    const result = {
      ok: true,
      value: {
        documentId,
        revision: 4,
        format: "vibeshape.recipe",
        version: 1,
        source: "export default {};",
      },
    }
    expect(localToolOutputs.export_design_recipe.safeParse(result).success).toBe(true)
    expect(
      localToolOutputs.export_design_recipe.safeParse({
        ...result,
        value: { ...result.value, source: "🟢".repeat(40_000) },
      }).success,
    ).toBe(false)
    expect(designRecipeExportResultContextMatches(operation, result, documentId)).toBe(true)
    expect(
      designRecipeExportResultContextMatches(
        operation,
        { ...result, value: { ...result.value, revision: 5 } },
        documentId,
      ),
    ).toBe(false)
    expect(
      designRecipeExportResultContextMatches(
        operation,
        result,
        "0195b5ac-b250-7a2c-8c33-000000000101",
      ),
    ).toBe(false)
    expect(localToolDescriptions.export_design_recipe).toBeDefined()
  })
})
