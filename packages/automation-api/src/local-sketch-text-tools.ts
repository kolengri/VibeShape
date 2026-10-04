import {
  commandIdSchema,
  draftIdSchema,
  revisionSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import { sketchTextParametersSchema } from "@vibeshape/domain/sketch-text"
import { z } from "zod"
import type { LocalOperation } from "./local-tools"

const command = {
  draftId: draftIdSchema,
  baseRevision: revisionSchema,
  commandId: commandIdSchema,
  sketchId: sketchIdSchema,
  groupId: sketchEntityIdSchema,
}
const outline = {
  ...command,
  intent: sketchTextParametersSchema.pick({
    text: true,
    heightMm: true,
    trackingMm: true,
    alignment: true,
    kerning: true,
  }),
  origin: z.tuple([
    z.number().finite().min(-100_000).max(100_000),
    z.number().finite().min(-100_000).max(100_000),
  ]),
}
export const localSketchTextInputs = {
  create_sketch_text: z.object(outline).strict(),
  update_sketch_text: z.object({ ...outline, removeAttachedConstraints: z.boolean() }).strict(),
  detach_sketch_text: z.object(command).strict(),
}
export const localSketchTextOperations = [
  z
    .object({
      tool: z.literal("create_sketch_text"),
      arguments: localSketchTextInputs.create_sketch_text,
    })
    .strict(),
  z
    .object({
      tool: z.literal("update_sketch_text"),
      arguments: localSketchTextInputs.update_sketch_text,
    })
    .strict(),
  z
    .object({
      tool: z.literal("detach_sketch_text"),
      arguments: localSketchTextInputs.detach_sketch_text,
    })
    .strict(),
] as const
const operationSchema = z.discriminatedUnion("tool", localSketchTextOperations)
export type LocalSketchTextOperation = z.infer<typeof operationSchema>
export function isLocalSketchTextOperation(
  operation: LocalOperation,
): operation is LocalSketchTextOperation {
  return (
    operation.tool === "create_sketch_text" ||
    operation.tool === "update_sketch_text" ||
    operation.tool === "detach_sketch_text"
  )
}
