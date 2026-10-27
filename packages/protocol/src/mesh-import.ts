import { z } from "zod"
import { featureEvaluationEngineResultSchema } from "./geometry-worker"
import { sourceAssetNormalizationSchema } from "./import-content"

export const inspectMeshImportInputSchema = z
  .object({
    format: z.enum(["stl", "3mf"]),
    bytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.length > 0, "Mesh source bytes must be nonempty.")
      .transform((bytes) => Uint8Array.from(bytes)),
    units: z.enum(["mm", "cm", "m", "in", "ft", "um"]).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.format === "stl") !== (input.units !== undefined))
      context.addIssue({
        code: "custom",
        message: "STL requires selected units; 3MF uses only its declared source units.",
      })
  })
export type InspectMeshImportInput = z.infer<typeof inspectMeshImportInputSchema>
export const meshImportInspectionSchema = z
  .object({
    normalization: sourceAssetNormalizationSchema,
    outputs: z
      .array(
        z
          .object({
            nodeKey: z.string().min(1).max(128),
            shape: featureEvaluationEngineResultSchema.shape.shape,
            mesh: featureEvaluationEngineResultSchema.shape.mesh,
          })
          .strict(),
      )
      .min(1)
      .max(128),
    warnings: z
      .array(
        z
          .object({ code: z.literal("degenerate-triangles"), count: z.number().int().positive() })
          .strict(),
      )
      .max(1),
  })
  .strict()
  .superRefine(({ outputs }, context) => {
    if (new Set(outputs.map(({ nodeKey }) => nodeKey)).size !== outputs.length)
      context.addIssue({
        code: "custom",
        message: "Mesh inspection repeats source nodes.",
      })
    if (
      outputs.some(
        ({ shape }) =>
          !shape.valid ||
          shape.volume !== 0 ||
          shape.solidCount !== 0 ||
          shape.faceCount !== 0 ||
          shape.edgeCount !== 0,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Mesh inspection cannot claim exact solid topology or volume.",
      })
  })
export type MeshImportInspection = z.infer<typeof meshImportInspectionSchema>
