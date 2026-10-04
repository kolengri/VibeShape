import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalPrimitiveCommandOperation } from "@vibeshape/automation-api/local-tools"
import { type CommandActor, featureRecordSchema } from "@vibeshape/domain"
import {
  boxFeatureType,
  coneFeatureType,
  cylinderFeatureType,
  pyramidFeatureType,
  sphereFeatureType,
  torusFeatureType,
} from "@vibeshape/domain/part-design"

const featureTypes = {
  update_box: boxFeatureType.type,
  create_cylinder: cylinderFeatureType.type,
  update_cylinder: cylinderFeatureType.type,
  create_cone: coneFeatureType.type,
  update_cone: coneFeatureType.type,
  create_sphere: sphereFeatureType.type,
  update_sphere: sphereFeatureType.type,
  create_torus: torusFeatureType.type,
  update_torus: torusFeatureType.type,
  create_pyramid: pyramidFeatureType.type,
  update_pyramid: pyramidFeatureType.type,
} as const
export function createLocalPrimitiveCommand(
  operation: LocalPrimitiveCommandOperation,
  actor: CommandActor,
  documentId: string,
) {
  const input = operation.arguments
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: input.featureId,
    type: featureTypes[operation.tool],
    parameters: input.parameters,
    dependencies: [],
    references: [],
    suppressed: input.suppressed,
    ...(input.label ? { label: input.label } : {}),
  })
  return applyAutomationDraftCommandRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    command: {
      kind: operation.tool.startsWith("update_")
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
