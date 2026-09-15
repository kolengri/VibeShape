import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import {
  boxFeatureType,
  type CommandActor,
  chamferFeatureType,
  chamferFeatureTypeV2,
  createLengthQuantity,
  type EdgeTopoRef,
  type FeatureTypeDescriptor,
  featureRecordSchema,
  filletFeatureType,
  filletFeatureTypeV2,
} from "@vibeshape/domain"

type BasicFeatureOperation = Extract<
  LocalOperation,
  {
    tool: "create_box" | "create_fillet" | "update_fillet" | "create_chamfer" | "update_chamfer"
  }
>

function treatmentScope(
  edges: readonly EdgeTopoRef[] | undefined,
  allEdges: FeatureTypeDescriptor,
  selectedEdges: FeatureTypeDescriptor,
) {
  return { type: edges ? selectedEdges.type : allEdges.type, references: edges ?? [] }
}

function featureContent(operation: BasicFeatureOperation) {
  if (operation.tool === "create_box") {
    const input = operation.arguments
    return {
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(input.widthMm),
        depth: createLengthQuantity(input.depthMm),
        height: createLengthQuantity(input.heightMm),
        centered: false,
        origin: {
          x: createLengthQuantity(0),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
      },
      dependencies: [],
      references: [],
    }
  }
  if (operation.tool === "create_fillet" || operation.tool === "update_fillet") {
    const input = operation.arguments
    return {
      ...treatmentScope(input.edges, filletFeatureType, filletFeatureTypeV2),
      parameters: {
        radius: createLengthQuantity(input.radiusMm, "mm", input.radiusExpression ?? null),
      },
      dependencies: [input.targetFeatureId],
    }
  }
  const input = operation.arguments
  return {
    ...treatmentScope(input.edges, chamferFeatureType, chamferFeatureTypeV2),
    parameters: {
      distance: createLengthQuantity(input.distanceMm, "mm", input.distanceExpression ?? null),
    },
    dependencies: [input.targetFeatureId],
  }
}

export function createLocalBasicFeatureCommand(
  operation: BasicFeatureOperation,
  actor: CommandActor,
  documentId: string,
) {
  const input = operation.arguments
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: input.featureId,
    ...featureContent(operation),
    suppressed: false,
    ...(input.label ? { label: input.label } : {}),
  })
  return applyAutomationDraftCommandRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    command: {
      kind:
        operation.tool === "update_fillet" || operation.tool === "update_chamfer"
          ? "org.vibeshape.feature.update"
          : "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: input.commandId,
      documentId,
      baseRevision: input.baseRevision,
      issuedAt: new Date().toISOString(),
      actor,
      payload: { feature },
    },
  })
}
