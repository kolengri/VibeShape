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
  expect(toolTimeoutMs("create_draft", 10)).toBe(10)
  expect(allowedTool("list_recoverable_drafts")).toBe(true)
  expect(allowedTool("restore_draft")).toBe(true)
  expect(allowedTool("create_project")).toBe(false)
  expect(allowedTool("foreign_tool")).toBe(false)
})

it.each([
  { ...input, projectId: "another-project" },
  { ...input, fields: [{ ...input.fields[0], secret: true }] },
  { ...input, fields: [input.fields[0], input.fields[0]] },
  { ...input, fields: [] },
])("rejects question arguments outside the shared assistant schema: %j", (value) => {
  expect(() => validateToolInput(assistantQuestionTool.name, value)).toThrow("contract")
})
