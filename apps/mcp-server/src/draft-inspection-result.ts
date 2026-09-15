import { automationDraftInspectionViewSchema } from "@vibeshape/automation-api/draft-inspection"
import type { LocalDraftInspectionOperation } from "@vibeshape/automation-api/local-tools"

export function draftInspectionMatches(
  operation: LocalDraftInspectionOperation,
  value: unknown,
  documentId: string,
) {
  const result = automationDraftInspectionViewSchema.parse(value)
  if (
    result.draft.documentId !== documentId ||
    result.draft.draftId !== operation.arguments.draftId ||
    result.draft.revision !== operation.arguments.revision
  )
    return false
  const view = result.view
  switch (operation.tool) {
    case "draft_tree":
      return (
        view.kind === "org.vibeshape.cad.inspection.list" &&
        view.data.items.length <= operation.arguments.limit
      )
    case "draft_variables":
      return (
        view.kind === "org.vibeshape.variable.list" &&
        view.data.variables.length <= operation.arguments.limit
      )
    case "draft_entity":
      return (
        view.kind === "org.vibeshape.cad.inspection.detail" &&
        view.data.entityKind === operation.arguments.entity.kind &&
        view.data.record.id === operation.arguments.entity.id
      )
    case "draft_edges":
      return (
        view.kind === "org.vibeshape.model.edges" &&
        view.featureId === operation.arguments.featureId &&
        view.data.edges.length <= operation.arguments.limit &&
        (operation.arguments.cursor === null ||
          (view.rebuildId === operation.arguments.cursor.rebuildId &&
            view.featureId === operation.arguments.cursor.featureId))
      )
  }
}
