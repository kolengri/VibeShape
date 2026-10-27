import { describe, expect, it } from "bun:test"
import {
  type StructuralAlgorithmSettings,
  type StructuralAlgorithmSummary,
  type StructuralFdmSummary,
  structuralAlgorithmSettingsSchema,
  structuralAlgorithmSummaryMatches,
  structuralAlgorithmSummarySchema,
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
      structuralFdmSummarySchema.safeParse({ ...summary, minimumFeatureCubeCells: 0 }).success,
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
    expect(schema.parse(Array.from({ length: 17 }, () => box))).toHaveLength(17)
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
    const surface = { kind: "surface", triangleIndices: [0, 20_000, 80_000], depthMm: 0.5 }
    expect(structuralRegionSchema.parse(box)).toEqual<unknown>(box)
    expect(structuralRegionSchema.parse(surface)).toEqual<unknown>(surface)
  })

  it.each([
    { kind: "surface", triangleIndices: [], depthMm: 1 },
    { kind: "surface", triangleIndices: [1, 1], depthMm: 1 },
    { kind: "surface", triangleIndices: [-1], depthMm: 1 },
    { kind: "surface", triangleIndices: [0.5], depthMm: 1 },
    { kind: "surface", triangleIndices: [Number.POSITIVE_INFINITY], depthMm: 1 },
    { kind: "surface", triangleIndices: [0], depthMm: 0 },
    { kind: "surface", triangleIndices: [0], depthMm: Number.POSITIVE_INFINITY },
    { kind: "surface", triangleIndices: [0], depthMm: Number.NaN },
    { kind: "surface", triangleIndices: [0], depthMm: 1, faceId: "transient" },
    { kind: "surface", triangleIndices: [0], depthMm: 1, min: [0, 0, 0] },
    { min: [0, 0, 0], max: [-1, 0, 0] },
    { min: [0, 0, 0], max: [1, 1, 1], kind: "box" },
  ])("rejects malformed or ambiguous region %j", (region) => {
    expect(structuralRegionSchema.safeParse(region).success).toBe(false)
  })

  it("accepts large unique captured selections while retaining duplicate rejection", () => {
    const triangleIndices = Array.from({ length: 20_001 }, (_, index) => index)
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

const simpSettings = { kind: "simp" as const, volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 }
const latticeSettings = {
  kind: "adaptive-lattice" as const,
  lattice: "gyroid" as const,
  cellPeriodMm: 12,
  minWallThicknessMm: 2,
  maxWallThicknessMm: 3,
  skinThicknessMm: 0,
  field: "strain-energy" as const,
  gamma: 1,
}
function algorithmInput(algorithm: StructuralAlgorithmSettings) {
  return {
    algorithm,
    material: {
      youngModulusMpa: 1000,
      poissonRatio: 0.3,
      yieldStrengthMpa: 100,
      densityKgM3: 1000,
    },
    safetyFactor: 2,
    maxDisplacementMm: 1,
    cellSizeMm: 1,
    supports: [{ min: [0, 0, 0], max: [0, 2, 2] }],
    loadCases: [{ name: "load", region: { min: [10, 0, 0], max: [10, 2, 2] }, forceN: [1, 0, 0] }],
    preserveRegions: [],
    maxIterations: 8,
  }
}
function simpEvidence(): StructuralAlgorithmSummary {
  return {
    kind: "simp",
    settings: { ...simpSettings },
    densityIterations: 8,
    converged: false,
    maxDensityChange: 0.1,
    targetCellCount: 32,
    achievedCellCount: 36,
    targetStatus: "not-reached",
    projectionEvaluations: 5,
  }
}
function latticeEvidence(): StructuralAlgorithmSummary {
  return {
    kind: "adaptive-lattice",
    settings: { ...latticeSettings },
    fieldMin: 0.1,
    fieldMax: 1,
    requestedWallMinMm: 2.1,
    requestedWallMaxMm: 3,
    minimumFeatureSizeBoundMm: 2,
    projectionEvaluations: 2,
    thresholdPasses: 2,
  }
}
const simpExecution = { iterations: 8, evaluations: 15, maxIterations: 8 }
const latticeExecution = { iterations: 2, evaluations: 4, maxIterations: 8 }
describe("structural algorithm settings and solid evidence", () => {
  it("preserves omission and rejects evidence without an algorithm request", () => {
    expect(structuralOptimizationSettingsSchema.shape.algorithm.parse(undefined)).toBeUndefined()
    expect(
      structuralAlgorithmSummaryMatches(undefined, undefined, 1, 40, 40, {
        iterations: 0,
        evaluations: 2,
        maxIterations: 0,
      }),
    ).toBe(true)
    expect(
      structuralAlgorithmSummaryMatches(simpEvidence(), undefined, 1, 40, 36, simpExecution),
    ).toBe(false)
    expect(
      structuralAlgorithmSummaryMatches(undefined, simpSettings, 1, 40, 36, simpExecution),
    ).toBe(false)
  })
  it.each([
    { ...simpSettings, filterRadiusMm: 0.9 },
    { ...simpSettings, penalty: 0.9 },
    { ...simpSettings, volumeFraction: 0.09 },
    { ...simpSettings, volumeFraction: NaN },
    { ...latticeSettings, cellPeriodMm: 7 },
    { ...latticeSettings, minWallThicknessMm: 1.9 },
    { ...latticeSettings, maxWallThicknessMm: 1.9 },
    { ...latticeSettings, maxWallThicknessMm: 7 },
    { ...latticeSettings, skinThicknessMm: 0.5 },
    { ...latticeSettings, gamma: Infinity },
  ])("rejects unsupported algorithm parameters %#", (algorithm) => {
    expect(structuralOptimizationSettingsSchema.safeParse(algorithmInput(algorithm)).success).toBe(
      false,
    )
  })
  it("rejects conflicting SIMP objective targets and unknown algorithm properties", () => {
    const input = algorithmInput(simpSettings)
    expect(
      structuralOptimizationSettingsSchema.safeParse({
        ...input,
        objective: { kind: "maximize-stiffness", retainedMassFraction: 0.7 },
      }).success,
    ).toBe(false)
    expect(
      structuralOptimizationSettingsSchema.safeParse({
        ...input,
        objective: { kind: "maximize-stiffness", retainedMassFraction: 0.8 },
      }).success,
    ).toBe(true)
    expect(
      structuralAlgorithmSettingsSchema.safeParse({ ...simpSettings, replacement: true }).success,
    ).toBe(false)
    expect(
      structuralAlgorithmSettingsSchema.safeParse({ ...latticeSettings, lattice: "random" })
        .success,
    ).toBe(false)
  })
  it("requires both algorithm counters to match the reported iteration count", () => {
    for (const evidence of [simpEvidence(), latticeEvidence()]) {
      const expected =
        evidence.kind === "simp" ? evidence.densityIterations : evidence.thresholdPasses
      for (const iterations of [0, 1, expected, 40])
        expect(
          structuralAlgorithmSummaryMatches(evidence, evidence.settings, 1, 40, 36, {
            ...(evidence.kind === "simp" ? simpExecution : latticeExecution),
            iterations,
          }),
        ).toBe(iterations === expected)
    }
  })
  it("distinguishes relaxed convergence from binary target achievement", () => {
    const evidence = simpEvidence()
    expect(
      structuralAlgorithmSummaryMatches(evidence, simpSettings, 1, 40, 36, simpExecution),
    ).toBe(true)
    if (evidence.kind !== "simp") throw new Error("Expected SIMP fixture")
    evidence.converged = true
    evidence.maxDensityChange = 0.005
    expect(
      structuralAlgorithmSummaryMatches(evidence, simpSettings, 1, 40, 36, simpExecution),
    ).toBe(true)
    evidence.targetStatus = "reached"
    expect(
      structuralAlgorithmSummaryMatches(evidence, simpSettings, 1, 40, 36, simpExecution),
    ).toBe(false)
    evidence.targetStatus = "not-reached"
    evidence.achievedCellCount = 32
    expect(
      structuralAlgorithmSummaryMatches(evidence, simpSettings, 1, 40, 36, simpExecution),
    ).toBe(false)
  })
  it("binds lattice grading, skin and measured voxel coverage to the request", () => {
    const evidence = latticeEvidence()
    expect(structuralAlgorithmSummarySchema.safeParse(evidence).success).toBe(true)
    expect(
      structuralAlgorithmSummaryMatches(evidence, latticeSettings, 1, 640, 500, latticeExecution),
    ).toBe(true)
    expect(
      structuralAlgorithmSummaryMatches(
        evidence,
        { ...latticeSettings, skinThicknessMm: 1 },
        1,
        640,
        500,
        latticeExecution,
      ),
    ).toBe(false)
    if (evidence.kind !== "adaptive-lattice") throw new Error("Expected lattice fixture")
    evidence.minimumFeatureSizeBoundMm = 1.9
    expect(
      structuralAlgorithmSummaryMatches(evidence, latticeSettings, 1, 640, 500, latticeExecution),
    ).toBe(false)
    evidence.minimumFeatureSizeBoundMm = 2
    evidence.requestedWallMaxMm = 3.1
    expect(
      structuralAlgorithmSummaryMatches(evidence, latticeSettings, 1, 640, 500, latticeExecution),
    ).toBe(false)
  })
})

it("accepts structural work counts beyond former resource ceilings", () => {
  const input = algorithmInput(simpSettings)
  const region = input.supports[0]
  const load = input.loadCases[0]
  expect(
    structuralOptimizationSettingsSchema.safeParse({
      ...input,
      maxIterations: 100,
      supports: Array.from({ length: 9 }, () => region),
      loadCases: Array.from({ length: 9 }, (_, index) => ({ ...load, name: `load-${index}` })),
      preserveRegions: Array.from({ length: 17 }, () => region),
      obstacleRegions: Array.from({ length: 17 }, () => ({ min: [20, 20, 20], max: [21, 21, 21] })),
    }).success,
  ).toBe(true)
  expect(
    structuralAlgorithmSummarySchema.safeParse({
      ...simpEvidence(),
      densityIterations: 100,
      projectionEvaluations: 101,
      targetCellCount: 3012,
      achievedCellCount: 4000,
    }).success,
  ).toBe(true)
  const fdm = fdmSummary()
  const settings = { ...fdmSettings, minFeatureSizeMm: 15 }
  const metrics = { ...fdm.baseline, minFeatureSizeBoundMm: 15, buildHeightMm: 4000 }
  const large = structuralFdmSummarySchema.parse({
    ...fdm,
    settings,
    minimumFeatureCubeCells: 15,
    baseline: metrics,
    optimized: metrics,
  })
  expect(structuralFdmSummaryMatches(large, settings, 1)).toBe(true)
})
