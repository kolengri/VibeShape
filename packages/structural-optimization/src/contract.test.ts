import { describe, expect, it } from "bun:test"
import { structuralOptimizationSettingsSchema } from "@vibeshape/domain/lightweighting"
import { structuralOptimizationInputSchema } from "./contract"

function input() {
  return {
    schemaVersion: 1,
    mesh: {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
    },
    material: { youngModulusMpa: 1000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1000 },
    safetyFactor: 2,
    maxDisplacementMm: 1,
    cellSizeMm: 1,
    supports: [{ kind: "surface", triangleIndices: [0], depthMm: 1 }],
    loadCases: [
      {
        name: "load",
        region: { kind: "surface", triangleIndices: [1], depthMm: 1 },
        forceN: [1, 0, 0],
      },
    ],
    preserveRegions: [{ kind: "surface", triangleIndices: [2], depthMm: 1 }],
    maxIterations: 0,
  }
}

describe("captured structural surface contract", () => {
  it("preserves the shared FDM layer-height scope through the worker extension", () => {
    const { mesh: _mesh, schemaVersion: _version, ...settings } = input()
    const fdm = {
      buildDirection: "+z",
      supportMode: "allowed",
      minFeatureSizeMm: 1,
      layerHeightMm: 2,
      maxOverhangAngleDeg: 0,
    }
    for (const parsed of [
      structuralOptimizationSettingsSchema.safeParse({ ...settings, fdm }),
      structuralOptimizationInputSchema.safeParse({ ...input(), fdm }),
    ]) {
      expect(parsed.success).toBe(false)
      if (!parsed.success)
        expect(parsed.error.issues).toEqual([
          expect.objectContaining({ path: ["fdm", "layerHeightMm"] }),
        ])
    }
    expect(
      structuralOptimizationInputSchema.safeParse({
        ...input(),
        fdm: { ...fdm, layerHeightMm: 1 },
      }).success,
    ).toBe(true)
    expect(structuralOptimizationSettingsSchema.safeParse(settings).success).toBe(true)
  })
  it("passes the optional domain objective through the worker contract", () => {
    const objective = { kind: "maximize-stiffness", retainedMassFraction: 0.96 }
    expect(
      structuralOptimizationInputSchema.parse({ ...input(), objective }).objective,
    ).toEqual<unknown>(objective)
    expect(
      structuralOptimizationInputSchema.safeParse({
        ...input(),
        objective: { ...objective, retainedMassFraction: 0.01 },
      }).success,
    ).toBe(false)
  })
  it("accepts indices within the exact source mesh", () => {
    expect(structuralOptimizationInputSchema.parse(input())).toEqual<unknown>(input())
  })

  it.each(["support", "load", "preserve"])("rejects an out-of-source %s triangle", (kind) => {
    const request = input()
    const region =
      kind === "support"
        ? request.supports[0]
        : kind === "load"
          ? request.loadCases[0]?.region
          : request.preserveRegions[0]
    if (!region) throw new Error("The fixture region is required.")
    region.triangleIndices = [4]
    const result = structuralOptimizationInputSchema.safeParse(request)
    expect(result.success).toBe(false)
    if (result.success) throw new Error("An out-of-source triangle must be rejected.")
    expect(
      result.error.issues.some(({ message }) => message.includes("captured source mesh")),
    ).toBe(true)
  })

  it("retains support, load-case, and preservation count bounds", () => {
    const request = input()
    const support = request.supports[0]
    const preserved = request.preserveRegions[0]
    const load = request.loadCases[0]
    if (!support || !preserved || !load) throw new Error("The fixture regions are required.")
    request.supports = Array.from({ length: 9 }, () => support)
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(false)
    request.supports = [support]
    request.preserveRegions = Array.from({ length: 17 }, () => preserved)
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(false)
    request.preserveRegions = []
    request.loadCases = Array.from({ length: 9 }, (_, index) => ({
      ...load,
      name: `load-${index}`,
    }))
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(false)
  })
})
