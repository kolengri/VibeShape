import { expect, it } from "bun:test"
import { assistantQuestionTool } from "@vibeshape/automation-api/assistant"
import { allowedTool, readOnlyTool, toolTimeoutMs, validateToolInput } from "./tool-contract"

const input = {
  message: "Choose a material",
  fields: [{ id: "material", label: "Material", required: true }],
}

it("admits and validates the separate native question contract without granting project tools", () => {
  expect(allowedTool(assistantQuestionTool.name)).toBe(true)
  expect(readOnlyTool(assistantQuestionTool.name)).toBe(true)
  expect(() => validateToolInput(assistantQuestionTool.name, input)).not.toThrow()
  expect(toolTimeoutMs(assistantQuestionTool.name, 10)).toBe(2_147_483_647)
  expect(toolTimeoutMs("create_draft", 10)).toBe(600_000)
  expect(allowedTool("list_recoverable_drafts")).toBe(true)
  expect(allowedTool("restore_draft")).toBe(true)
  expect(allowedTool("create_project")).toBe(false)
  expect(allowedTool("foreign_tool")).toBe(false)
})

it("keeps CAD SDK waits above short provider deadlines without shortening longer waits", () => {
  expect(toolTimeoutMs("model_info", 120_000)).toBe(600_000)
  expect(toolTimeoutMs("preview_draft", 900_000)).toBe(900_000)
  expect(toolTimeoutMs("analyze_quick_lightweighting", 10)).toBe(600_000)
  expect(toolTimeoutMs("request_quick_lightweighting", 10)).toBe(2_147_483_647)
})

it.each([
  { ...input, projectId: "another-project" },
  { ...input, fields: [{ ...input.fields[0], secret: true }] },
  { ...input, fields: [input.fields[0], input.fields[0]] },
  { ...input, fields: [] },
])("rejects question arguments outside the shared assistant schema: %j", (value) => {
  expect(() => validateToolInput(assistantQuestionTool.name, value)).toThrow("contract")
})
