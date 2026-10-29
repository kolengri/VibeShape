import {
  type StructuralOptimizationSettings,
  structuralOptimizationSettingsSchema,
  structuralOptimizationSummarySchema,
} from "@vibeshape/domain/lightweighting"
import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const gridOriginCoordinate = z.number().finite().min(-200_000).max(200_000)
const gridOriginVector = z.tuple([gridOriginCoordinate, gridOriginCoordinate, gridOriginCoordinate])
const gridIndex = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1)
const voxelGridSchema = z
  .object({
    originMm: gridOriginVector,
    cellSizeMm: z.number().finite().min(0.01).max(100_000),
    cells: z.array(z.tuple([gridIndex, gridIndex, gridIndex])).min(1),
  })
  .strict()
  .refine(({ cells }) => new Set(cells.map((cell) => cell.join(","))).size === cells.length, {
    message: "Voxel grid cells must be unique.",
  })
export const structuralMeshSchema = z
  .object({
    vertices: z.array(coordinate).min(12),
    indices: z.array(z.number().int().nonnegative()).min(12),
  })
  .strict()
  .refine(
    ({ vertices, indices }) =>
      vertices.length % 3 === 0 &&
      indices.length % 3 === 0 &&
      indices.every((index) => index < vertices.length / 3),
    "Meshes require complete XYZ triples and valid triangle indices.",
  )

function permitsBoundaryReference(input: StructuralOptimizationSettings) {
  return (
    input.maxIterations === 0 &&
    input.algorithm === undefined &&
    input.objective === undefined &&
    input.relativePerformance === undefined &&
    input.preserveRegions.length === 0
  )
}

export const structuralOptimizationInputSchema = structuralOptimizationSettingsSchema
  .safeExtend({
    schemaVersion: z.literal(1),
    mesh: structuralMeshSchema,
    boundaryReferenceMesh: structuralMeshSchema.optional(),
    includeVoxelGrid: z.boolean().optional(),
    voxelGridOriginMm: gridOriginVector.optional(),
  })
  .superRefine((input, context) => {
    if (input.boundaryReferenceMesh && !permitsBoundaryReference(input))
      context.addIssue({
        code: "custom",
        path: ["boundaryReferenceMesh"],
        message:
          "A boundary reference requires fixed-design analysis without search settings or preserved design regions.",
      })
    const boundaryMesh = input.boundaryReferenceMesh ?? input.mesh
    const regions = [
      ...input.supports.map((region, index) => ({
        region,
        mesh: boundaryMesh,
        path: ["supports", index],
      })),
      ...input.loadCases.flatMap(({ region, additionalLoads }, index) => [
        { region, mesh: boundaryMesh, path: ["loadCases", index, "region"] },
        ...(additionalLoads ?? []).map(({ region }, term) => ({
          region,
          mesh: boundaryMesh,
          path: ["loadCases", index, "additionalLoads", term, "region"],
        })),
      ]),
      ...input.preserveRegions.map((region, index) => ({
        region,
        mesh: input.mesh,
        path: ["preserveRegions", index],
      })),
    ]
    for (const { region, mesh, path } of regions) {
      if (!("kind" in region)) continue
      if (region.triangleIndices.some((index) => index >= mesh.indices.length / 3)) {
        context.addIssue({
          code: "custom",
          path: [...path, "triangleIndices"],
          message: "Surface triangle indices must reference the captured source mesh.",
        })
      }
    }
  })
export const structuralOptimizationResultSchema = structuralOptimizationSummarySchema
  .extend({ mesh: structuralMeshSchema, voxelGrid: voxelGridSchema.optional() })
  .refine(
    ({ voxelGrid, finalCellCount, cellSizeMm }) =>
      !voxelGrid ||
      (voxelGrid.cells.length === finalCellCount && voxelGrid.cellSizeMm === cellSizeMm),
    { message: "Voxel grid count and spacing must match the final analyzed solid." },
  )
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
export type StructuralVoxelGrid = z.infer<typeof voxelGridSchema>
