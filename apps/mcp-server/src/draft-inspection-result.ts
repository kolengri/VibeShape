import {
  type AutomationDraftInspectionView,
  automationDraftInspectionViewSchema,
} from "@vibeshape/automation-api/draft-inspection"
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
    case "draft_measurements":
      return measurementMatches(operation, view)
    case "draft_body_measurements":
      return bodyMeasurementMatches(operation, view)
    case "draft_body_topology":
      return bodyTopologyMatches(operation, view)
  }
}

type DraftView = AutomationDraftInspectionView["view"]
function measurementMatches(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_measurements" }>,
  view: DraftView,
) {
  return (
    view.kind === "org.vibeshape.model.measurements" &&
    view.data.features.length <= operation.arguments.limit &&
    view.data.features.every(
      (feature) =>
        operation.arguments.featureId === undefined ||
        feature.featureId === operation.arguments.featureId,
    )
  )
}
function bodyMeasurementMatches(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_body_measurements" }>,
  view: DraftView,
) {
  return (
    view.kind === "org.vibeshape.model.body-measurements" &&
    view.data.bodies.length <= operation.arguments.limit &&
    view.data.bodies.every(
      (body) =>
        (operation.arguments.featureId === undefined ||
          body.featureId === operation.arguments.featureId) &&
        (operation.arguments.outputRole === undefined ||
          body.outputRole === operation.arguments.outputRole),
    )
  )
}
function bodyTopologyMatches(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_body_topology" }>,
  view: DraftView,
) {
  const args = operation.arguments
  if (
    view.kind !== "org.vibeshape.model.body-topology" ||
    view.featureId !== args.featureId ||
    view.outputRole !== args.outputRole ||
    view.topologyKind !== args.topologyKind ||
    view.data.topology.length > args.limit
  )
    return false
  const cursor = args.cursor
  return (
    cursor === null ||
    (
      [
        "documentId",
        "revision",
        "generation",
        "rebuildId",
        "contentHash",
        "featureId",
        "outputRole",
        "topologyKind",
      ] as const
    ).every((key) => view[key] === cursor[key])
  )
}
