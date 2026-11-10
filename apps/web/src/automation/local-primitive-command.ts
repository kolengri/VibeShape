import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalPrimitiveCommandOperation } from "@vibeshape/automation-api/local-tools"
import { type CommandActor, featureRecordSchema } from "@vibeshape/domain"
import {
  authoredConeFeatureType,
  boxFeatureType,
  coneFeatureType,
  cylinderFeatureType,
  pyramidFeatureType,
  sphereFeatureType,
  torusFeatureType,
} from "@vibeshape/domain/part-design"
import { connectMountsFeatureType } from "@vibeshape/domain/part-design-connect-mounts"

const featureTypes = {
  create_connect_mounts: connectMountsFeatureType.type,
  update_connect_mounts: connectMountsFeatureType.type,
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
function primitiveTypeAndParameters(operation: LocalPrimitiveCommandOperation) {
  const parameters = operation.arguments.parameters
  if (operation.tool !== "create_cone" && operation.tool !== "update_cone")
    return { type: featureTypes[operation.tool], parameters }
  const topRadius = "topRadius" in parameters ? parameters.topRadius : undefined
  const type = authoredConeFeatureType(null, topRadius)
  if (type.schemaVersion === 2) return { type, parameters }
  // A literal zero top radius is the exact pointed cone, which version 1 already owns.
  const { topRadius: _topRadius, ...pointed } = { topRadius: undefined, ...parameters }
  return { type, parameters: pointed }
}

export function createLocalPrimitiveCommand(
  operation: LocalPrimitiveCommandOperation,
  actor: CommandActor,
  documentId: string,
) {
  const input = operation.arguments
  const { type, parameters } = primitiveTypeAndParameters(operation)
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: input.featureId,
    type,
    parameters,
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
