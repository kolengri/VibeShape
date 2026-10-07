import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const vector = z.tuple([coordinate, coordinate, coordinate])
export const structuralRegionSchema = z
  .object({ min: vector, max: vector })
  .strict()
  .refine(({ min, max }) => min.every((value, axis) => value <= (max[axis] ?? value - 1)), {
    message: "Region minima must not exceed maxima.",
  })
export const structuralOptimizationSettingsSchema = z
  .object({
    material: z
      .object({
        youngModulusMpa: z.number().finite().min(0.001).max(1_000_000),
        poissonRatio: z.number().finite().min(0).max(0.45),
        yieldStrengthMpa: z.number().finite().min(0.000001).max(100_000),
        densityKgM3: z.number().finite().min(0.001).max(100_000),
      })
      .strict(),
    safetyFactor: z.number().finite().min(1).max(100),
    maxDisplacementMm: z.number().finite().min(1e-9).max(100_000),
    cellSizeMm: z.number().finite().min(0.01).max(100_000),
    supports: z.array(structuralRegionSchema).min(1).max(8),
    loadCases: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            region: structuralRegionSchema,
            forceN: z
              .tuple([
                z.number().finite().min(-1_000_000).max(1_000_000),
                z.number().finite().min(-1_000_000).max(1_000_000),
                z.number().finite().min(-1_000_000).max(1_000_000),
              ])
              .refine(
                (force) => force.some((component) => component !== 0),
                "Force must be nonzero.",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .refine((cases) => new Set(cases.map(({ name }) => name)).size === cases.length, {
        message: "Load case names must be unique.",
      }),
    preserveRegions: z.array(structuralRegionSchema).max(16),
    maxIterations: z.number().int().min(0).max(40),
  })
  .strict()
const nonnegative = z.number().finite().nonnegative()
const positive = z.number().finite().positive()
const caseMetrics = z
  .object({
    name: z.string().min(1).max(80),
    maxVonMisesMpa: nonnegative,
    maxDisplacementMm: nonnegative,
    safetyFactor: positive,
    complianceNmm: nonnegative,
  })
  .strict()
const metrics = z
  .object({
    volumeMm3: positive,
    massKg: positive,
    maxVonMisesMpa: nonnegative,
    maxDisplacementMm: nonnegative,
    safetyFactor: positive,
    cases: z.array(caseMetrics).min(1).max(8),
  })
  .strict()
export const structuralOptimizationSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["improved", "no-improvement"]),
    baseline: metrics,
    optimized: metrics,
    sourceVolumeMm3: positive,
    sourceVolumeLossFraction: z.number().finite().min(0).max(1),
    cellSizeMm: positive,
    initialCellCount: z.number().int().min(1).max(3_000),
    finalCellCount: z.number().int().min(1).max(3_000),
    iterations: z.number().int().min(0).max(40),
    evaluations: z.number().int().min(2).max(1_000),
    termination: z.enum(["iteration-limit", "constraints-or-topology", "no-removable-cells"]),
    warnings: z.array(z.string().max(1_024)).max(16),
  })
  .strict()
export type StructuralOptimizationSettings = z.infer<typeof structuralOptimizationSettingsSchema>
export type StructuralOptimizationSummary = z.infer<typeof structuralOptimizationSummarySchema>
