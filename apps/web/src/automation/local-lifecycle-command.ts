import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalLifecycleCommandOperation } from "@vibeshape/automation-api/local-tools"
import type { CommandActor } from "@vibeshape/domain"

export function createLocalLifecycleCommand(
  operation: LocalLifecycleCommandOperation,
  actor: CommandActor,
  documentId: string,
) {
  const input = operation.arguments
  const envelope = {
    schemaVersion: 1,
    commandId: input.commandId,
    documentId,
    baseRevision: input.baseRevision,
    issuedAt: new Date().toISOString(),
    actor,
  }
  const command = lifecycleCommand(operation)
  return applyAutomationDraftCommandRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    command: { ...envelope, ...command },
  })
}
function lifecycleCommand(operation: LocalLifecycleCommandOperation) {
  switch (operation.tool) {
    case "remove_feature":
      return {
        kind: "org.vibeshape.feature.remove",
        payload: { featureId: operation.arguments.featureId },
      }
    case "remove_sketch":
      return {
        kind: "org.vibeshape.sketch.remove",
        payload: { sketchId: operation.arguments.sketchId },
      }
    case "set_feature_suppressed":
      return {
        kind: "org.vibeshape.feature.set-suppressed",
        payload: {
          featureId: operation.arguments.featureId,
          suppressed: operation.arguments.suppressed,
        },
      }
    case "rename_project":
      return { kind: "org.vibeshape.document.rename", payload: { name: operation.arguments.name } }
  }
}
