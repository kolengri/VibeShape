import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const vector = z.tuple([coordinate, coordinate, coordinate])
const gridCoordinate = z.number().finite().min(-200_000).max(200_000)
const gridOrigin = z.tuple([gridCoordinate, gridCoordinate, gridCoordinate])
const index = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(Number.MAX_SAFE_INTEGER - 1)
const cell = z.tuple([index, index, index])
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

export const printOptimizationSourceSchema = z
  .object({
    documentId: uuid,
    featureId: uuid,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    outputRole: z.string().min(1).max(128),
  })
  .strict()

/** Structured-clone lattice contract, independent of the numerical implementation package. */
export const printOptimizationVoxelGridSchema = z
  .object({
    originMm: gridOrigin,
    cellSizeMm: z.number().finite().positive(),
    cells: z.array(cell).min(1),
  })
  .strict()
  .refine(({ cells }) => new Set(cells.map((value) => value.join(":"))).size === cells.length, {
    message: "Retained voxel cells must be unique.",
  })

const protectedBox = z
  .object({ minMm: vector, maxMm: vector })
  .strict()
  .refine(({ minMm, maxMm }) => minMm.every((value, axis) => value < (maxMm[axis] ?? value)), {
    message: "Protected print-frame boxes must have positive dimensions.",
  })

export const printOptimizationReconstructionInputSchema = z
  .object({
    source: printOptimizationSourceSchema,
    preserveFaceIds: z.array(z.number().int().positive().max(2_147_483_647)),
    voxelGrid: printOptimizationVoxelGridSchema,
    // world -> print is rotation * (point - originMm).
    sourceToPrintFrame: z
      .object({
        originMm: vector,
        rotation: z
          .tuple([
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
          ])
          .refine((value) => Math.abs(Math.hypot(...value) - 1) <= 1e-12, {
            message: "Print rotation must be a unit quaternion.",
          }),
      })
      .strict(),
    // Print-frame source-boundary selectors, not protected solid volumes.
    protectedBoxes: z.array(protectedBox),
    preserveDepthMm: z.number().finite().positive(),
  })
  .strict()
  .refine(({ preserveFaceIds }) => new Set(preserveFaceIds).size === preserveFaceIds.length, {
    message: "Preserved face identities must be unique.",
  })

export const printOptimizationReconstructionSchema = z
  .object({
    source: printOptimizationSourceSchema,
    stepBytes: z.instanceof(Uint8Array).refine((value) => value.length > 0),
    verificationMesh: z
      .object({
        positions: z
          .instanceof(Float64Array)
          .refine(
            (value) => value.length >= 12 && value.length % 3 === 0 && value.every(Number.isFinite),
          ),
        indices: z
          .instanceof(Uint32Array)
          .refine((value) => value.length >= 12 && value.length % 3 === 0),
      })
      .strict()
      .refine(({ positions, indices }) => indices.every((value) => value < positions.length / 3)),
    sourceVolumeMm3: z.number().finite().positive(),
    volumeMm3: z.number().finite().positive(),
    preservedFaceCount: z.number().int().nonnegative().safe(),
  })
  .strict()
  .refine(({ volumeMm3, sourceVolumeMm3 }) => volumeMm3 < sourceVolumeMm3, {
    message: "Exact reconstruction must remove source material.",
  })

export type PrintOptimizationReconstructionInput = z.infer<
  typeof printOptimizationReconstructionInputSchema
>
export type PrintOptimizationReconstruction = z.infer<typeof printOptimizationReconstructionSchema>
