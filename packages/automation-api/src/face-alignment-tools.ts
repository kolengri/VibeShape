import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import {
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import { z } from "zod"

const planarFace = bodyFaceRefSchema.refine(
  ({ signature }) => signature.geometryClass === "PLANE",
  "Face alignment requires planar face references.",
)

export const faceAlignmentToolInputs = {
  create_face_aligned_placement: z
    .object({
      draftId: draftIdSchema,
      baseRevision: revisionSchema,
      commandId: commandIdSchema,
      featureId: featureIdSchema,
      label: featureRecordSchema.shape.label,
      sourceFace: planarFace,
      targetFace: planarFace,
      orientation: z.enum(["same", "opposed"]),
      offsetMm: z.number().finite().min(-100_000).max(100_000),
    })
    .strict()
    .refine(
      ({ sourceFace, targetFace }) =>
        sourceFace.featureId !== targetFace.featureId ||
        sourceFace.outputRole !== targetFace.outputRole,
      "Face alignment requires two distinct bodies.",
    )
    .refine(
      ({ featureId, sourceFace, targetFace }) =>
        featureId !== sourceFace.featureId && featureId !== targetFace.featureId,
      "A new placement must have its own feature identity.",
    ),
}

export const faceAlignmentOperations = [
  z
    .object({
      tool: z.literal("create_face_aligned_placement"),
      arguments: faceAlignmentToolInputs.create_face_aligned_placement,
    })
    .strict(),
] as const
export const faceAlignmentOperationSchema = faceAlignmentOperations[0]
export type FaceAlignmentOperation = z.infer<typeof faceAlignmentOperationSchema>
