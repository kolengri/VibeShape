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
  cylinderFeatureParametersSchema,
  pyramidFeatureParametersSchema,
  sphereFeatureParametersSchema,
  torusFeatureParametersSchema,
} from "@vibeshape/domain/part-design"
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
export const localPrimitiveInputs = {
  update_box: primitive(boxFeatureParametersSchema),
  create_cylinder: primitive(cylinderFeatureParametersSchema),
  update_cylinder: primitive(cylinderFeatureParametersSchema),
  create_cone: primitive(coneFeatureParametersSchema),
  update_cone: primitive(coneFeatureParametersSchema),
  create_sphere: primitive(sphereFeatureParametersSchema),
  update_sphere: primitive(sphereFeatureParametersSchema),
  create_torus: primitive(torusFeatureParametersSchema),
  update_torus: primitive(torusFeatureParametersSchema),
  create_pyramid: primitive(pyramidFeatureParametersSchema),
  update_pyramid: primitive(pyramidFeatureParametersSchema),
} as const
export const primitiveToolNames = [
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
