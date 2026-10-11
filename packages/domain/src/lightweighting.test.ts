import { describe, expect, it } from "bun:test"
import {
  type StructuralFdmSummary,
  structuralFdmSettingsSchema,
  structuralFdmSummaryMatches,
  structuralFdmSummarySchema,
  structuralOptimizationSettingsSchema,
  structuralOptimizationSummarySchema,
  structuralRegionSchema,
  structuralSurfaceRegionSchema,
} from "./lightweighting"

const fdmSettings = {
  buildDirection: "+z" as const,
  supportMode: "allowed" as const,
  minFeatureSizeMm: 1.2,
  layerHeightMm: 0.2,
  maxOverhangAngleDeg: 45,
}
function fdmSummary(): StructuralFdmSummary {
  return {
    settings: { ...fdmSettings },
    approximation: "conservative-voxel",
    minimumFeatureCubeCells: 2,
    horizontalReachMm: 0.2,
    buildPlateCoordinateMm: 0,
    baseline: {
      unsupportedAreaMm2: 0,
      requiresSupports: false,
      minFeatureSizeBoundMm: 2,
      buildHeightMm: 4,
    },
    optimized: {
      unsupportedAreaMm2: 1,
      requiresSupports: true,
      minFeatureSizeBoundMm: 2,
      buildHeightMm: 3,
    },
  }
}
describe("structural FDM settings and response association", () => {
  it("accepts all build axes and keeps legacy FDM omission unchanged", () => {
    for (const buildDirection of ["+x", "-x", "+y", "-y", "+z", "-z"] as const)
      expect(
        structuralFdmSettingsSchema.parse({ ...fdmSettings, buildDirection }).buildDirection,
      ).toBe(buildDirection)
    expect(structuralOptimizationSettingsSchema.shape.fdm.parse(undefined)).toBeUndefined()
    expect(structuralFdmSummaryMatches(undefined, undefined, 1)).toBe(true)
    expect(structuralFdmSummaryMatches(fdmSummary(), undefined, 1)).toBe(false)
    expect(structuralFdmSummaryMatches(undefined, fdmSettings, 1)).toBe(false)
    expect(
      structuralFdmSummaryMatches(structuralFdmSummarySchema.parse(fdmSummary()), fdmSettings, 1),
    ).toBe(true)
  })
  it.each([
    { buildDirection: "z" },
    { supportMode: "automatic" },
    { minFeatureSizeMm: 0 },
    { layerHeightMm: 0.0009 },
    { maxOverhangAngleDeg: 90 },
    { maxOverhangAngleDeg: -1 },
    { minFeatureSizeMm: NaN },
    { layerHeightMm: Infinity },
    { maxOverhangAngleDeg: Infinity },
    { unexpected: true },
  ])("rejects malformed or nonfinite FDM setting %j", (patch) => {
    expect(structuralFdmSettingsSchema.safeParse({ ...fdmSettings, ...patch }).success).toBe(false)
  })
  it.each<[string, (summary: StructuralFdmSummary) => void]>([
    [
      "settings",
      (summary) => {
        summary.settings.buildDirection = "-z"
      },
    ],
    [
      "cube count",
      (summary) => {
        summary.minimumFeatureCubeCells = 1
      },
    ],
    [
      "reach",
      (summary) => {
        summary.horizontalReachMm = 1
      },
    ],
    [
      "thin feature",
      (summary) => {
        summary.optimized.minFeatureSizeBoundMm = 1.19999999
      },
    ],
    [
      "inflated bound",
      (summary) => {
        summary.optimized.minFeatureSizeBoundMm = 3
      },
    ],
    [
      "area contradiction",
      (summary) => {
        summary.optimized.requiresSupports = false
      },
    ],
    [
      "unsupported contradiction",
      (summary) => {
        summary.baseline.requiresSupports = true
      },
    ],
    [
      "height lattice",
      (summary) => {
        summary.optimized.buildHeightMm = 2.1
      },
    ],
    [
      "height growth",
      (summary) => {
        summary.optimized.buildHeightMm = 5
      },
    ],
  ])("rejects semantically forged FDM %s", (_, change) => {
    const summary = fdmSummary()
    change(summary)
    expect(structuralFdmSummaryMatches(summary, fdmSettings, 1)).toBe(false)
  })
  it("rejects support need in forbidden mode and malformed strict summary values", () => {
    const summary = fdmSummary()
    summary.settings.supportMode = "forbidden"
    expect(
      structuralFdmSummaryMatches(summary, { ...fdmSettings, supportMode: "forbidden" }, 1),
    ).toBe(false)
    expect(
      structuralFdmSummarySchema.safeParse({ ...summary, minimumFeatureCubeCells: 15 }).success,
    ).toBe(false)
    expect(
      structuralFdmSummarySchema.safeParse({
        ...summary,
        optimized: { ...summary.optimized, unsupportedAreaMm2: NaN },
      }).success,
    ).toBe(false)
    expect(structuralFdmSummarySchema.safeParse({ ...summary, extra: true }).success).toBe(false)
  })
  it("rejects matched summaries outside one-slice layer scope and accepts equality", () => {
    for (const layerHeightMm of [1, 2]) {
      const settings = { ...fdmSettings, layerHeightMm }
      const summary = structuralFdmSummarySchema.parse({
        ...fdmSummary(),
        settings,
        horizontalReachMm: layerHeightMm,
      })
      expect(structuralFdmSummaryMatches(summary, settings, 1)).toBe(layerHeightMm === 1)
    }
  })
})

describe("structural keep-out boxes", () => {
  const schema = structuralOptimizationSettingsSchema.shape.obstacleRegions
  const box = { min: [-100_000, 0, 0], max: [100_000, 1, 1] }
  it("accepts omitted, empty, and bounded closed boxes", () => {
    expect(schema.parse(undefined)).toBeUndefined()
    expect(schema.parse([])).toEqual([])
    expect(schema.parse(Array.from({ length: 16 }, () => box))).toHaveLength(16)
  })
  it.each(
    [
      null,
      [{ kind: "surface", triangleIndices: [0], depthMm: 1 }],
      [{ ...box, max: [-100_001, 0, 1] }],
      [{ min: [1, 0, 0], max: [0, 1, 1] }],
      [{ min: [0, 0, 0], max: [1, 0, 1] }],
      [{ ...box, min: [NaN, 0, 0] }],
      [{ ...box, min: [Infinity, 0, 0] }],
      [{ ...box, kind: "box" }],
      Array.from({ length: 17 }, () => box),
    ].map((regions) => ({ regions })),
  )("rejects unbounded, malformed, and non-box obstacles %j", ({ regions }) => {
    expect(schema.safeParse(regions).success).toBe(false)
  })
})

describe("structural objectives", () => {
  it.each([
    undefined,
    { kind: "minimize-mass" },
    { kind: "maximize-stiffness", retainedMassFraction: 0.1 },
    { kind: "maximize-stiffness", retainedMassFraction: 1 },
  ])("accepts the optional objective and inclusive mass boundaries %j", (objective) => {
    expect(structuralOptimizationSettingsSchema.shape.objective.parse(objective)).toEqual(objective)
  })

  it.each([
    null,
    { kind: "other" },
    { kind: "minimize-mass", retainedMassFraction: 0.5 },
    { kind: "maximize-stiffness" },
    { kind: "maximize-stiffness", retainedMassFraction: 0.099 },
    { kind: "maximize-stiffness", retainedMassFraction: 1.001 },
    { kind: "maximize-stiffness", retainedMassFraction: Number.NaN },
    { kind: "maximize-stiffness", retainedMassFraction: Number.POSITIVE_INFINITY },
    { kind: "maximize-stiffness", retainedMassFraction: 0.5, targetMassKg: 1 },
  ])("rejects malformed or ambiguous objective %j", (objective) => {
    expect(structuralOptimizationSettingsSchema.shape.objective.safeParse(objective).success).toBe(
      false,
    )
  })

  it("requires complete bounded measured mass-target metadata", () => {
    const objective = {
      kind: "maximize-stiffness",
      retainedMassFraction: 0.96,
      targetMassKg: 0.0000384,
      targetCellCount: 39,
      achievedRetainedMassFraction: 0.975,
      targetStatus: "reached",
    }
    const schema = structuralOptimizationSummarySchema.shape.objective
    expect(schema.parse(objective)).toEqual<unknown>(objective)
    expect(
      schema.safeParse({ kind: "maximize-stiffness", retainedMassFraction: 0.96 }).success,
    ).toBe(false)
    expect(schema.safeParse({ ...objective, targetStatus: "optimal" }).success).toBe(false)
    expect(schema.safeParse({ ...objective, targetCellCount: 0 }).success).toBe(false)
    expect(schema.safeParse({ ...objective, achievedRetainedMassFraction: 1.1 }).success).toBe(
      false,
    )
    expect(schema.safeParse({ ...objective, targetMassKg: Number.NaN }).success).toBe(false)
    expect(schema.safeParse({ ...objective, globalOptimum: true }).success).toBe(false)
  })
})

describe("structural regions", () => {
  it("preserves strict legacy boxes and accepts captured surface triangles", () => {
    const box = { min: [-2, 0, 1], max: [2, 0, 3] }
    const surface = { kind: "surface", triangleIndices: [0, 19_999], depthMm: 0.5 }
    expect(structuralRegionSchema.parse(box)).toEqual<unknown>(box)
    expect(structuralRegionSchema.parse(surface)).toEqual<unknown>(surface)
  })

  it.each([
    { kind: "surface", triangleIndices: [], depthMm: 1 },
    { kind: "surface", triangleIndices: [1, 1], depthMm: 1 },
    { kind: "surface", triangleIndices: [-1], depthMm: 1 },
    { kind: "surface", triangleIndices: [0.5], depthMm: 1 },
    { kind: "surface", triangleIndices: [20_000], depthMm: 1 },
    { kind: "surface", triangleIndices: [0], depthMm: 0 },
    { kind: "surface", triangleIndices: [0], depthMm: Number.POSITIVE_INFINITY },
    { kind: "surface", triangleIndices: [0], depthMm: Number.NaN },
    { kind: "surface", triangleIndices: [0], depthMm: 1, faceId: "transient" },
    { kind: "surface", triangleIndices: [0], depthMm: 1, min: [0, 0, 0] },
    { min: [0, 0, 0], max: [-1, 0, 0] },
    { min: [0, 0, 0], max: [1, 1, 1], kind: "box" },
  ])("rejects malformed, ambiguous, or unbounded region %j", (region) => {
    expect(structuralRegionSchema.safeParse(region).success).toBe(false)
  })

  it("enforces the captured source triangle budget", () => {
    const triangleIndices = Array.from({ length: 20_000 }, (_, index) => index)
    expect(
      structuralSurfaceRegionSchema.safeParse({ kind: "surface", triangleIndices, depthMm: 1 })
        .success,
    ).toBe(true)
    expect(
      structuralSurfaceRegionSchema.safeParse({
        kind: "surface",
        triangleIndices: [...triangleIndices, 0],
        depthMm: 1,
      }).success,
    ).toBe(false)
  })
})
