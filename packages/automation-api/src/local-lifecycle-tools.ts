import { documentNameSchema } from "@vibeshape/domain"
import {
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import { z } from "zod"

const command = { draftId: draftIdSchema, baseRevision: revisionSchema, commandId: commandIdSchema }
export const localLifecycleInputs = {
  remove_feature: z.object({ ...command, featureId: featureIdSchema }).strict(),
  remove_sketch: z.object({ ...command, sketchId: sketchIdSchema }).strict(),
  set_feature_suppressed: z
    .object({ ...command, featureId: featureIdSchema, suppressed: z.boolean() })
    .strict(),
  rename_project: z.object({ ...command, name: documentNameSchema }).strict(),
} as const
export const lifecycleToolNames = [
  "remove_feature",
  "remove_sketch",
  "set_feature_suppressed",
  "rename_project",
] as const
function operation<Name extends keyof typeof localLifecycleInputs>(tool: Name) {
  return z.object({ tool: z.literal(tool), arguments: localLifecycleInputs[tool] }).strict()
}
export const localLifecycleOperations = [
  operation("remove_feature"),
  operation("remove_sketch"),
  operation("set_feature_suppressed"),
  operation("rename_project"),
] as const
