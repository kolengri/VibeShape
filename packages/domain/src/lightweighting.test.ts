import { describe, expect, it } from "bun:test"
import {
  structuralOptimizationSettingsSchema,
  structuralOptimizationSummarySchema,
  structuralRegionSchema,
  structuralSurfaceRegionSchema,
} from "./lightweighting"

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
