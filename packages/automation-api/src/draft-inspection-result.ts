import {
  type AutomationDraftInspectionView,
  automationDraftInspectionViewSchema,
} from "./draft-inspection"
import type { LocalDraftInspectionOperation } from "./local-tools"

type View = AutomationDraftInspectionView["view"]
function bodyMeasurementsMatch(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_body_measurements" }>,
  view: View,
) {
  if (view.kind !== "org.vibeshape.model.body-measurements") return false
  const args = operation.arguments
  return (
    view.data.bodies.length <= args.limit &&
    view.data.bodies.every(
      (body) =>
        (args.featureId === undefined || body.featureId === args.featureId) &&
        (args.outputRole === undefined || body.outputRole === args.outputRole),
    )
  )
}
function bodyTopologyMatches(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_body_topology" }>,
  view: View,
) {
  if (view.kind !== "org.vibeshape.model.body-topology") return false
  const args = operation.arguments
  if (
    !(["featureId", "outputRole", "topologyKind"] as const).every((key) => view[key] === args[key])
  )
    return false
  if (view.data.topology.length > args.limit) return false
  const cursor = args.cursor
  return (
    cursor === null ||
    (
      [
        "documentId",
        "revision",
        "generation",
        "rebuildId",
        "featureId",
        "contentHash",
        "outputRole",
        "topologyKind",
      ] as const
    ).every((key) => view[key] === cursor[key])
  )
}
function edgesMatch(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_edges" }>,
  view: View,
) {
  if (view.kind !== "org.vibeshape.model.edges") return false
  const args = operation.arguments
  return (
    view.featureId === args.featureId &&
    view.data.edges.length <= args.limit &&
    (args.cursor === null ||
      (view.rebuildId === args.cursor.rebuildId && view.featureId === args.cursor.featureId))
  )
}
function treeMatches(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_tree" }>,
  view: View,
) {
  return (
    view.kind === "org.vibeshape.cad.inspection.list" &&
    view.data.items.length <= operation.arguments.limit
  )
}
function variablesMatch(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_variables" }>,
  view: View,
) {
  return (
    view.kind === "org.vibeshape.variable.list" &&
    view.data.variables.length <= operation.arguments.limit
  )
}
function entityMatches(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_entity" }>,
  view: View,
) {
  return (
    view.kind === "org.vibeshape.cad.inspection.detail" &&
    view.data.entityKind === operation.arguments.entity.kind &&
    view.data.record.id === operation.arguments.entity.id
  )
}
function viewMatches(operation: LocalDraftInspectionOperation, view: View) {
  switch (operation.tool) {
    case "draft_measurements":
      return measurementsMatch(operation, view)
    case "draft_tree":
      return treeMatches(operation, view)
    case "draft_variables":
      return variablesMatch(operation, view)
    case "draft_entity":
      return entityMatches(operation, view)
    case "draft_body_measurements":
      return bodyMeasurementsMatch(operation, view)
    case "draft_body_topology":
      return bodyTopologyMatches(operation, view)
    case "draft_edges":
      return edgesMatch(operation, view)
  }
}
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
  return viewMatches(operation, result.view)
}

function measurementsMatch(
  operation: Extract<LocalDraftInspectionOperation, { tool: "draft_measurements" }>,
  view: View,
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
