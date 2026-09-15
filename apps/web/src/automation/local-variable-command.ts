import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import type { CommandActor } from "@vibeshape/domain"

type LocalVariableOperation = Extract<
  LocalOperation,
  {
    tool:
      | "create_variable"
      | "set_variable_expression"
      | "rename_variable"
      | "remove_variable"
      | "replace_variable_table"
  }
>

export function createLocalVariableCommand(
  operation: LocalVariableOperation,
  actor: CommandActor,
  documentId: string,
) {
  const envelope = {
    schemaVersion: 1 as const,
    commandId: operation.arguments.commandId,
    documentId,
    baseRevision: operation.arguments.baseRevision,
    issuedAt: new Date().toISOString(),
    actor,
  }
  const apply = (draftId: string, kind: string, payload: unknown) =>
    applyAutomationDraftCommandRequestSchema.parse({
      schemaVersion: 1,
      draftId,
      command: { ...envelope, kind, payload },
    })

  switch (operation.tool) {
    case "create_variable":
      return apply(operation.arguments.draftId, "org.vibeshape.variable.add", {
        variable: operation.arguments.variable,
      })
    case "set_variable_expression":
      return apply(operation.arguments.draftId, "org.vibeshape.variable.set-expression", {
        variableId: operation.arguments.variableId,
        expression: operation.arguments.expression,
      })
    case "rename_variable":
      return apply(operation.arguments.draftId, "org.vibeshape.variable.rename", {
        variableId: operation.arguments.variableId,
        name: operation.arguments.name,
      })
    case "remove_variable":
      return apply(operation.arguments.draftId, "org.vibeshape.variable.remove", {
        variableId: operation.arguments.variableId,
      })
    case "replace_variable_table":
      return apply(operation.arguments.draftId, "org.vibeshape.variable.replace-table", {
        variables: operation.arguments.variables,
      })
  }
}
