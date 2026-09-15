import type {
  LocalDraftInspectionOperation,
  LocalInspectionOperation,
} from "@vibeshape/automation-api/local-tools"
import {
  cadInspectionDetailQuerySchema,
  cadInspectionListQuerySchema,
  modelBodyMeasurementQuerySchema,
  modelBodyTopologyQuerySchema,
  modelEdgeQuerySchema,
  variableListQuerySchema,
} from "@vibeshape/automation-api/queries"

export function createLocalInspectionQuery(
  operation: LocalInspectionOperation | LocalDraftInspectionOperation,
  documentId: string,
) {
  const common = { schemaVersion: 1, documentId }
  const { draftId: _draftId, ...argumentsInput } = { draftId: undefined, ...operation.arguments }
  switch (operation.tool) {
    case "model_tree":
    case "draft_tree":
      return cadInspectionListQuerySchema.parse({
        ...common,
        ...argumentsInput,
        kind: "org.vibeshape.cad.inspection.list",
      })
    case "model_entity":
    case "draft_entity":
      return cadInspectionDetailQuerySchema.parse({
        ...common,
        ...argumentsInput,
        kind: "org.vibeshape.cad.inspection.detail",
      })
    case "model_variables":
    case "draft_variables":
      return variableListQuerySchema.parse({
        ...common,
        ...argumentsInput,
        kind: "org.vibeshape.variable.list",
      })
    case "model_edges":
    case "draft_edges":
      return modelEdgeQuerySchema.parse({
        ...common,
        ...argumentsInput,
        kind: "org.vibeshape.model.edges",
      })
    case "model_body_topology":
      return modelBodyTopologyQuerySchema.parse({
        ...common,
        ...argumentsInput,
        kind: "org.vibeshape.model.body-topology",
      })
    case "model_body_measurements":
      return modelBodyMeasurementQuerySchema.parse({
        ...common,
        ...argumentsInput,
        kind: "org.vibeshape.model.body-measurements",
      })
  }
}
