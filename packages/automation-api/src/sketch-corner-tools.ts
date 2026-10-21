import {
  commandIdSchema,
  draftIdSchema,
  revisionSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import { sketchCornerTreatmentSchema } from "@vibeshape/domain/sketch-corner-edit"
import { z } from "zod"
import type { LocalOperation } from "./local-tools"

export const localSketchCornerInputs = {
  treat_sketch_corner: z
    .object({
      draftId: draftIdSchema,
      baseRevision: revisionSchema,
      commandId: commandIdSchema,
      sketchId: sketchIdSchema,
      treatment: sketchCornerTreatmentSchema,
    })
    .strict(),
}
export const localSketchCornerOperations = [
  z
    .object({
      tool: z.literal("treat_sketch_corner"),
      arguments: localSketchCornerInputs.treat_sketch_corner,
    })
    .strict(),
] as const
export const sketchCornerOperationSchema = localSketchCornerOperations[0]
export type LocalSketchCornerOperation = z.infer<typeof sketchCornerOperationSchema>

export function isLocalSketchCornerOperation(
  operation: LocalOperation,
): operation is LocalSketchCornerOperation {
  return operation.tool === "treat_sketch_corner"
}
