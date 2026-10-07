import {
  structuralOptimizationSettingsSchema,
  structuralOptimizationSummarySchema,
} from "@vibeshape/domain/lightweighting"
import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
export const structuralMeshSchema = z
  .object({
    vertices: z.array(coordinate).min(12).max(60_000),
    indices: z.array(z.number().int().nonnegative()).min(12).max(200_000),
  })
  .strict()
  .refine(
    ({ vertices, indices }) =>
      vertices.length % 3 === 0 &&
      indices.length % 3 === 0 &&
      indices.every((index) => index < vertices.length / 3),
    "Meshes require complete XYZ triples and valid triangle indices.",
  )
export const structuralOptimizationInputSchema = structuralOptimizationSettingsSchema
  .extend({
    schemaVersion: z.literal(1),
    mesh: structuralMeshSchema.refine(
      ({ vertices, indices }) => vertices.length <= 30_000 && indices.length <= 60_000,
      "The source mesh exceeds the 10,000-vertex or 20,000-triangle analysis budget.",
    ),
  })
  .superRefine((input, context) => {
    const regions = [
      ...input.supports.map((region, index) => ({ region, path: ["supports", index] })),
      ...input.loadCases.map(({ region }, index) => ({
        region,
        path: ["loadCases", index, "region"],
      })),
      ...input.preserveRegions.map((region, index) => ({
        region,
        path: ["preserveRegions", index],
      })),
    ]
    for (const { region, path } of regions) {
      if (!("kind" in region)) continue
      if (region.triangleIndices.some((index) => index >= input.mesh.indices.length / 3)) {
        context.addIssue({
          code: "custom",
          path: [...path, "triangleIndices"],
          message: "Surface triangle indices must reference the captured source mesh.",
        })
      }
    }
  })
export const structuralOptimizationResultSchema = structuralOptimizationSummarySchema.extend({
  mesh: structuralMeshSchema,
})
export const structuralSolverResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: structuralOptimizationResultSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string().min(1).max(80), message: z.string().max(1_024) }).strict(),
    })
    .strict(),
])
export type StructuralOptimizationInput = z.infer<typeof structuralOptimizationInputSchema>
export type StructuralOptimizationResult = z.infer<typeof structuralOptimizationResultSchema>
export type StructuralMesh = z.infer<typeof structuralMeshSchema>
