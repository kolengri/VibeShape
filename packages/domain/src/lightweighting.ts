import { z } from "zod"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const vector = z.tuple([coordinate, coordinate, coordinate])
const structuralBoxRegionSchema = z
  .object({ min: vector, max: vector })
  .strict()
  .refine(({ min, max }) => min.every((value, axis) => value <= (max[axis] ?? value - 1)), {
    message: "Region minima must not exceed maxima.",
  })
export const structuralSurfaceRegionSchema = z
  .object({
    kind: z.literal("surface"),
    triangleIndices: z
      .array(z.number().int().min(0).max(19_999))
      .min(1)
      .max(20_000)
      .refine((indices) => new Set(indices).size === indices.length, {
        message: "Surface triangle indices must be unique.",
      }),
    depthMm: z.number().finite().positive().max(100_000),
  })
  .strict()
export const structuralRegionSchema = z.union([
  structuralBoxRegionSchema,
  structuralSurfaceRegionSchema,
])
const structuralObstacleRegionSchema = structuralBoxRegionSchema.refine(
  ({ min, max }) => min.every((value, axis) => value < (max[axis] ?? value)),
  { message: "Obstacle boxes must have positive extent on every axis." },
)
export type StructuralRegion = z.infer<typeof structuralRegionSchema>
export type StructuralSurfaceRegion = z.infer<typeof structuralSurfaceRegionSchema>
const minimumMassObjectiveSchema = z.object({ kind: z.literal("minimize-mass") }).strict()
const stiffnessObjectiveSchema = z
  .object({
    kind: z.literal("maximize-stiffness"),
    retainedMassFraction: z.number().finite().min(0.1).max(1),
  })
  .strict()
const structuralObjectiveSchema = z.discriminatedUnion("kind", [
  minimumMassObjectiveSchema,
  stiffnessObjectiveSchema,
])
export const structuralFdmSettingsSchema = z
  .object({
    buildDirection: z.enum(["+x", "-x", "+y", "-y", "+z", "-z"]),
    supportMode: z.enum(["forbidden", "allowed"]),
    minFeatureSizeMm: z.number().finite().min(0.01).max(100_000),
    layerHeightMm: z.number().finite().min(0.001).max(100_000),
    maxOverhangAngleDeg: z.number().finite().min(0).max(89),
  })
  .strict()
export type StructuralFdmSettings = z.infer<typeof structuralFdmSettingsSchema>
export const structuralOptimizationSettingsSchema = z
  .object({
    objective: structuralObjectiveSchema.optional(),
    fdm: structuralFdmSettingsSchema.optional(),
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
    obstacleRegions: z.array(structuralObstacleRegionSchema).max(16).optional(),
    maxIterations: z.number().int().min(0).max(40),
  })
  .strict()
  .refine(({ fdm, cellSizeMm }) => !fdm || fdm.layerHeightMm <= cellSizeMm, {
    path: ["fdm", "layerHeightMm"],
    message: "FDM layer height must not exceed the voxel cell size for one-slice support coverage.",
  })
export const structuralMaterialSchema = structuralOptimizationSettingsSchema.shape.material
export type StructuralMaterial = z.infer<typeof structuralMaterialSchema>
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
const structuralFdmMetricsSchema = z
  .object({
    unsupportedAreaMm2: nonnegative,
    requiresSupports: z.boolean(),
    minFeatureSizeBoundMm: positive,
    buildHeightMm: positive,
  })
  .strict()
export const structuralFdmSummarySchema = z
  .object({
    settings: structuralFdmSettingsSchema,
    approximation: z.literal("conservative-voxel"),
    minimumFeatureCubeCells: z.number().int().min(1).max(14),
    horizontalReachMm: nonnegative,
    buildPlateCoordinateMm: coordinate,
    baseline: structuralFdmMetricsSchema,
    optimized: structuralFdmMetricsSchema,
  })
  .strict()
export type StructuralFdmSummary = z.infer<typeof structuralFdmSummarySchema>

function fdmMetricsMatch(
  metrics: StructuralFdmSummary["baseline"],
  settings: StructuralFdmSettings,
  cellSizeMm: number,
  cubeCells: number,
) {
  const heightCells = metrics.buildHeightMm / cellSizeMm
  return (
    metrics.minFeatureSizeBoundMm >= settings.minFeatureSizeMm &&
    metrics.minFeatureSizeBoundMm <= cubeCells * cellSizeMm + cellSizeMm * 1e-6 &&
    metrics.requiresSupports === metrics.unsupportedAreaMm2 > 0 &&
    (settings.supportMode === "allowed" || !metrics.requiresSupports) &&
    heightCells >= cubeCells &&
    heightCells <= 3_000 &&
    Math.abs(heightCells - Math.round(heightCells)) <= 1e-8
  )
}

/** Semantic association after both payloads have passed their runtime schemas. */
export function structuralFdmSummaryMatches(
  summary: StructuralFdmSummary | undefined,
  settings: StructuralFdmSettings | undefined,
  cellSizeMm: number,
): boolean {
  if (!settings) return summary === undefined
  if (!summary || !Number.isFinite(cellSizeMm) || cellSizeMm < 0.01 || cellSizeMm > 100_000)
    return false
  if (settings.layerHeightMm > cellSizeMm) return false
  const keys = [
    "buildDirection",
    "supportMode",
    "minFeatureSizeMm",
    "layerHeightMm",
    "maxOverhangAngleDeg",
  ] as const
  const cubeCells = Math.ceil(settings.minFeatureSizeMm / cellSizeMm)
  const reach = settings.layerHeightMm * Math.tan((settings.maxOverhangAngleDeg * Math.PI) / 180)
  return (
    keys.every((key) => summary.settings[key] === settings[key]) &&
    summary.minimumFeatureCubeCells === cubeCells &&
    Math.abs(summary.horizontalReachMm - reach) <= Math.max(1e-12, reach * 1e-10) &&
    summary.optimized.buildHeightMm <= summary.baseline.buildHeightMm &&
    [summary.baseline, summary.optimized].every((metrics) =>
      fdmMetricsMatch(metrics, settings, cellSizeMm, cubeCells),
    )
  )
}
export const structuralOptimizationSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["improved", "no-improvement"]),
    fdm: structuralFdmSummarySchema.optional(),
    baseline: metrics,
    optimized: metrics,
    sourceVolumeMm3: positive,
    sourceVolumeLossFraction: z.number().finite().min(0).max(1),
    cellSizeMm: positive,
    initialCellCount: z.number().int().min(1).max(3_000),
    finalCellCount: z.number().int().min(1).max(3_000),
    iterations: z.number().int().min(0).max(40),
    evaluations: z.number().int().min(2).max(1_000),
    objective: z
      .discriminatedUnion("kind", [
        minimumMassObjectiveSchema,
        stiffnessObjectiveSchema.extend({
          targetMassKg: positive,
          targetCellCount: z.number().int().min(1).max(3_000),
          achievedRetainedMassFraction: z.number().finite().min(0.1).max(1),
          targetStatus: z.enum(["reached", "not-reached"]),
        }),
      ])
      .optional(),
    termination: z.enum([
      "iteration-limit",
      "constraints-or-topology",
      "no-removable-cells",
      "target-mass-reached",
    ]),
    warnings: z.array(z.string().max(1_024)).max(16),
  })
  .strict()
export type StructuralOptimizationSettings = z.infer<typeof structuralOptimizationSettingsSchema>
export type StructuralOptimizationSummary = z.infer<typeof structuralOptimizationSummarySchema>
