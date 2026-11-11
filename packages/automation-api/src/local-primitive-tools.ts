import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import {
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import {
  boxFeatureParametersSchema,
  coneFeatureParametersSchema,
  coneFeatureParametersV2Schema,
  cylinderFeatureParametersSchema,
  pyramidFeatureParametersSchema,
  sphereFeatureParametersSchema,
  torusFeatureParametersSchema,
} from "@vibeshape/domain/part-design"
import { connectMountsFeatureParametersSchema } from "@vibeshape/domain/part-design-connect-mounts"
import { z } from "zod"

const feature = {
  draftId: draftIdSchema,
  baseRevision: revisionSchema,
  commandId: commandIdSchema,
  featureId: featureIdSchema,
  label: featureRecordSchema.shape.label,
  suppressed: z.boolean(),
}
function primitive<Schema extends z.ZodType>(parameters: Schema) {
  return z.object({ ...feature, parameters }).strict()
}
// A supplied topRadius authors Cone v2; omitting it keeps the exact pointed Cone v1 contract.
const coneParametersSchema = z.union([coneFeatureParametersV2Schema, coneFeatureParametersSchema])
export const localPrimitiveInputs = {
  create_connect_mounts: primitive(connectMountsFeatureParametersSchema),
  update_connect_mounts: primitive(connectMountsFeatureParametersSchema),
  update_box: primitive(boxFeatureParametersSchema),
  create_cylinder: primitive(cylinderFeatureParametersSchema),
  update_cylinder: primitive(cylinderFeatureParametersSchema),
  create_cone: primitive(coneParametersSchema),
  update_cone: primitive(coneParametersSchema),
  create_sphere: primitive(sphereFeatureParametersSchema),
  update_sphere: primitive(sphereFeatureParametersSchema),
  create_torus: primitive(torusFeatureParametersSchema),
  update_torus: primitive(torusFeatureParametersSchema),
  create_pyramid: primitive(pyramidFeatureParametersSchema),
  update_pyramid: primitive(pyramidFeatureParametersSchema),
} as const
export const primitiveToolNames = [
  "create_connect_mounts",
  "update_connect_mounts",
  "update_box",
  "create_cylinder",
  "update_cylinder",
  "create_cone",
  "update_cone",
  "create_sphere",
  "update_sphere",
  "create_torus",
  "update_torus",
  "create_pyramid",
  "update_pyramid",
] as const
function operation<Name extends keyof typeof localPrimitiveInputs>(tool: Name) {
  return z.object({ tool: z.literal(tool), arguments: localPrimitiveInputs[tool] }).strict()
}
export const localPrimitiveOperations = [
  operation("create_connect_mounts"),
  operation("update_connect_mounts"),
  operation("update_box"),
  operation("create_cylinder"),
  operation("update_cylinder"),
  operation("create_cone"),
  operation("update_cone"),
  operation("create_sphere"),
  operation("update_sphere"),
  operation("create_torus"),
  operation("update_torus"),
  operation("create_pyramid"),
  operation("update_pyramid"),
] as const
