import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import { type CommandActor, featureRecordSchema } from "@vibeshape/domain"
import {
  extrusionFeatureType,
  extrusionFeatureTypeV3,
  extrusionFeatureTypeV4,
  revolveFeatureType,
  revolveFeatureTypeV5,
  revolveFeatureTypeV6,
} from "@vibeshape/domain/part-design"
import {
  holeFeatureParametersSchema,
  holeFeatureParametersV2Schema,
  holeFeatureType,
  holeFeatureTypeV2,
} from "@vibeshape/domain/part-design-hole"

type CadOperation = Extract<
  LocalOperation,
  {
    tool:
      | "create_sketch"
      | "update_sketch"
      | "create_extrude"
      | "update_extrude"
      | "create_revolve"
      | "update_revolve"
      | "create_hole"
      | "update_hole"
  }
>

function cadFeatureType(
  operation: Exclude<CadOperation, { tool: "create_sketch" | "update_sketch" }>,
) {
  if (operation.tool === "create_hole" || operation.tool === "update_hole") {
    return "targetBody" in operation.arguments.parameters
      ? holeFeatureTypeV2.type
      : holeFeatureType.type
  }
  return profileFeatureType(operation)
}

function profileFeatureType(
  operation: Exclude<
    CadOperation,
    { tool: "create_sketch" | "update_sketch" | "create_hole" | "update_hole" }
  >,
) {
  const parameters = operation.arguments.parameters
  if (operation.tool === "create_extrude" || operation.tool === "update_extrude") {
    if ("profile" in parameters) return extrusionFeatureType.type
    return parameters.operation === "new"
      ? extrusionFeatureTypeV3.type
      : extrusionFeatureTypeV4.type
  }
  if ("profile" in parameters) return revolveFeatureType.type
  return parameters.operation === "new" ? revolveFeatureTypeV5.type : revolveFeatureTypeV6.type
}

export function createLocalCadCommand(
  operation: CadOperation,
  actor: CommandActor,
  documentId: string,
) {
  const input = operation.arguments
  const envelope = {
    schemaVersion: 1,
    commandId: input.commandId,
    baseRevision: input.baseRevision,
    documentId,
    issuedAt: new Date().toISOString(),
    actor,
  }
  if (operation.tool === "create_sketch" || operation.tool === "update_sketch") {
    return applyAutomationDraftCommandRequestSchema.parse({
      schemaVersion: 1,
      draftId: input.draftId,
      command: {
        ...envelope,
        kind:
          operation.tool === "create_sketch"
            ? "org.vibeshape.sketch.add"
            : "org.vibeshape.sketch.update",
        payload: { sketch: operation.arguments.sketch },
      },
    })
  }
  const featureInput = operation.arguments
  const parameters =
    operation.tool === "create_hole" || operation.tool === "update_hole"
      ? ("targetBody" in featureInput.parameters
          ? holeFeatureParametersV2Schema
          : holeFeatureParametersSchema
        ).parse(featureInput.parameters)
      : featureInput.parameters
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureInput.featureId,
    type: cadFeatureType(operation),
    parameters,
    dependencies: featureInput.dependencies,
    references: featureInput.references,
    suppressed: featureInput.suppressed,
    ...(featureInput.label ? { label: featureInput.label } : {}),
  })
  return applyAutomationDraftCommandRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    command: {
      ...envelope,
      kind:
        operation.tool === "create_extrude" ||
        operation.tool === "create_revolve" ||
        operation.tool === "create_hole"
          ? "org.vibeshape.feature.add"
          : "org.vibeshape.feature.update",
      payload: { feature },
    },
  })
}
