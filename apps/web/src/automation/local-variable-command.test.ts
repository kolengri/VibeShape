import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { createLocalVariableCommand } from "./local-variable-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(1),
})

const base = { draftId: id(2), baseRevision: 7, commandId: id(3) }
const variable = { schemaVersion: 0 as const, id: id(4), name: "width", expression: "20 mm" }

describe("local variable commands", () => {
  it.each([
    ["create_variable", { ...base, variable }, "org.vibeshape.variable.add"],
    [
      "set_variable_expression",
      { ...base, variableId: id(4), expression: "#height + 5 mm" },
      "org.vibeshape.variable.set-expression",
    ],
    [
      "rename_variable",
      { ...base, variableId: id(4), name: "panel_width" },
      "org.vibeshape.variable.rename",
    ],
    ["remove_variable", { ...base, variableId: id(4) }, "org.vibeshape.variable.remove"],
    [
      "replace_variable_table",
      { ...base, variables: [variable] },
      "org.vibeshape.variable.replace-table",
    ],
  ] as const)("preserves the %s command contract", (tool, arguments_, kind) => {
    const operation = localOperationSchema.parse({ tool, arguments: arguments_ })
    const request = (() => {
      switch (operation.tool) {
        case "create_variable":
        case "set_variable_expression":
        case "rename_variable":
        case "remove_variable":
        case "replace_variable_table":
          return createLocalVariableCommand(operation, actor, id(5))
        default:
          throw new Error("Unexpected non-variable operation")
      }
    })()
    expect(request.draftId).toBe(base.draftId)
    expect(request.command.baseRevision).toBe(base.baseRevision)
    expect(request.command.commandId).toBe(base.commandId)
    expect(request.command.actor).toEqual(actor)
    expect(request.command.documentId).toBe(id(5))
    expect(request.command.kind).toBe(kind)
    const parsed = parseDocumentCommand(request.command)
    expect(parsed.ok).toBe(true)
  })

  it("rejects malformed definitions, tables, and expressions at the tool boundary", () => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_variable",
        arguments: { ...base, variable: { ...variable, name: "not valid" } },
      }).success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool: "replace_variable_table",
        arguments: {
          ...base,
          variables: [
            variable,
            { ...variable, id: id(6), name: "height", expression: "#width + 10 mm" },
          ],
        },
      }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "replace_variable_table",
        arguments: {
          ...base,
          variables: [
            variable,
            { ...variable, id: id(6), name: "height", expression: "#height + 10 mm" },
          ],
        },
      }).success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool: "set_variable_expression",
        arguments: { ...base, variableId: id(4), expression: "#missing + 1 mm" },
      }).success,
    ).toBe(true)
  })
})
