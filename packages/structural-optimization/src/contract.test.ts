import { describe, expect, it } from "bun:test"
import { structuralOptimizationSettingsSchema } from "@vibeshape/domain/lightweighting"
import { denseBoxMesh } from "../tests/dense-box-fixture"
import {
  type StructuralVoxelGrid,
  structuralMeshSchema,
  structuralOptimizationInputSchema,
  structuralOptimizationResultSchema,
} from "./contract"
import {
  quickLightweightingInputSchema,
  quickLightweightingMeshSchema,
  quickLightweightingProgressSchema,
} from "./quick-contract"

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
  it("binds fixed-design interfaces to a strict worker-only boundary reference mesh", () => {
    const request = { ...input(), preserveRegions: [], boundaryReferenceMesh: denseBoxMesh() }
    request.supports = [{ kind: "surface", triangleIndices: [10], depthMm: 1 }]
    request.loadCases = request.loadCases.map((load) => ({
      ...load,
      region: { ...load.region, triangleIndices: [11] },
    }))
    expect(structuralOptimizationInputSchema.parse(request).boundaryReferenceMesh).toEqual(
      request.boundaryReferenceMesh,
    )
    expect(
      structuralOptimizationInputSchema.safeParse({
        ...request,
        boundaryReferenceMesh: input().mesh,
      }).success,
    ).toBe(false)
    const { mesh: _mesh, schemaVersion: _version, ...settings } = request
    expect(structuralOptimizationSettingsSchema.safeParse(settings).success).toBe(false)
    for (const patch of [
      { boundaryReferenceMesh: null },
      { boundaryReferenceMesh: { ...request.boundaryReferenceMesh, extra: true } },
      { boundaryReferenceMesh: { vertices: [NaN, 0, 0], indices: [] } },
      { maxIterations: 1 },
      { algorithm: { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 } },
      { objective: { kind: "minimize-mass" } },
      { relativePerformance: { minStiffnessFraction: 0.9, minStrengthFraction: 0.9 } },
      { preserveRegions: input().preserveRegions },
    ])
      expect(structuralOptimizationInputSchema.safeParse({ ...request, ...patch }).success).toBe(
        false,
      )
  })
  it("keeps grid evidence and lattice phase worker-only and preserves omission", () => {
    const request = input()
    expect(structuralOptimizationInputSchema.parse(request)).not.toHaveProperty("includeVoxelGrid")
    expect(
      structuralOptimizationInputSchema.parse({
        ...request,
        includeVoxelGrid: true,
        voxelGridOriginMm: [0.25, 0, -0.5],
      }),
    ).toMatchObject({ includeVoxelGrid: true, voxelGridOriginMm: [0.25, 0, -0.5] })
    expect(
      structuralOptimizationInputSchema.parse({ ...request, voxelGridOriginMm: [0, -100000.5, 0] })
        .voxelGridOriginMm,
    ).toEqual([0, -100000.5, 0])
    const { mesh: _mesh, schemaVersion: _version, ...settings } = request
    expect(
      structuralOptimizationSettingsSchema.safeParse({ ...settings, includeVoxelGrid: true })
        .success,
    ).toBe(false)
    expect(
      structuralOptimizationSettingsSchema.safeParse({ ...settings, voxelGridOriginMm: [0, 0, 0] })
        .success,
    ).toBe(false)
    for (const patch of [
      { includeVoxelGrid: 1 },
      { includeVoxelGrid: null },
      { voxelGridOriginMm: [0, 0] },
      { voxelGridOriginMm: [0, 0, Infinity] },
      { voxelGridOriginMm: [0, 0, 200_001] },
      { voxelGridOriginMm: null },
    ])
      expect(structuralOptimizationInputSchema.safeParse({ ...request, ...patch }).success).toBe(
        false,
      )
  })
  it("requires a strict unique finite integer voxel grid", () => {
    const grid: StructuralVoxelGrid = {
      originMm: [-5, -1, -1],
      cellSizeMm: 1,
      cells: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    }
    const schema = structuralOptimizationResultSchema.shape.voxelGrid
    expect(schema.parse(grid)).toEqual(grid)
    for (const invalid of [
      { ...grid, extra: true },
      { ...grid, cells: [] },
      {
        ...grid,
        cells: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
      { ...grid, cells: [[0.1, 0, 0]] },
      { ...grid, cells: [[-1, 0, 0]] },
      { ...grid, cells: [[Number.MAX_SAFE_INTEGER, 0, 0]] },
      { ...grid, originMm: [0, 0, NaN] },
      { ...grid, originMm: [0, 0, 200_001] },
      { ...grid, cellSizeMm: 0 },
      { ...grid, cellSizeMm: Infinity },
    ])
      expect(schema.safeParse(invalid).success).toBe(false)
  })
  it("accepts geometry validation progress beyond one million checks with ordered finite counts", () => {
    const progress = { phase: "validation", completed: 1_000_001, total: 2_000_000 }
    expect(quickLightweightingProgressSchema.parse(progress)).toEqual<unknown>(progress)
    for (const invalid of [
      { ...progress, completed: -1 },
      { ...progress, completed: 2_000_001 },
      { ...progress, completed: Number.POSITIVE_INFINITY },
      { ...progress, total: 0 },
      { ...progress, total: 2_000_000.5 },
    ])
      expect(quickLightweightingProgressSchema.safeParse(invalid).success).toBe(false)
  })

  it("uses actual captured mesh bounds for large surface IDs and selections", () => {
    const request = {
      ...input(),
      mesh: denseBoxMesh(),
      supports: [
        {
          kind: "surface",
          triangleIndices: Array.from({ length: 21_168 }, (_, index) => index),
          depthMm: 1,
        },
      ],
      preserveRegions: [{ kind: "surface", triangleIndices: [20_000, 21_167], depthMm: 1 }],
    }
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(true)
    request.preserveRegions[0]?.triangleIndices.push(21_168)
    const parsed = structuralOptimizationInputSchema.safeParse(request)
    expect(parsed.success).toBe(false)
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ["preserveRegions", 0, "triangleIndices"] }),
      )
  })

  it("accepts dense source and result meshes without a replacement geometry count ceiling", () => {
    const mesh = denseBoxMesh({ subdivisions: 120 })
    expect(mesh.vertices.length / 3).toBe(87_846)
    expect(mesh.indices.length / 3).toBe(172_800)
    for (const schema of [structuralMeshSchema, quickLightweightingMeshSchema])
      expect(schema.safeParse(mesh).success).toBe(true)
    expect(structuralOptimizationInputSchema.safeParse({ ...input(), mesh }).success).toBe(true)
    expect(
      quickLightweightingInputSchema.safeParse({
        schemaVersion: 1,
        mesh,
        mode: "open-organic",
        removalPercent: 50,
        cellSizeMm: 0.25,
        skinThicknessMm: 0,
      }).success,
    ).toBe(true)
  })

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

  it("accepts support, load-case, and preservation counts beyond former bounds", () => {
    const request = input()
    const support = request.supports[0]
    const preserved = request.preserveRegions[0]
    const load = request.loadCases[0]
    if (!support || !preserved || !load) throw new Error("The fixture regions are required.")
    request.supports = Array.from({ length: 9 }, () => support)
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(true)
    request.supports = [support]
    request.preserveRegions = Array.from({ length: 17 }, () => preserved)
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(true)
    request.preserveRegions = []
    request.loadCases = Array.from({ length: 9 }, (_, index) => ({
      ...load,
      name: `load-${index}`,
    }))
    expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(true)
  })
})
