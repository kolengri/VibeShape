import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import type {
  PrintOptimizationReconstruction,
  PrintOptimizationReconstructionInput,
  SourceImportInspection,
} from "@vibeshape/protocol"
import type {
  StructuralOptimizationInput,
  StructuralOptimizationResult,
} from "@vibeshape/structural-optimization/contract"
import { StructuralOptimizationError } from "../../../../../packages/structural-optimization/src/errors"
import { vi } from "../../../../../tests/unit/support/bun-test"
import {
  id,
  inspection as importedInspection,
  meshInspection,
} from "../import/import-test-fixtures"
import type { LightweightingSource } from "./lightweighting-model"
import type { PrepareExactPrintSnapshotOptions } from "./prepare-exact-print-snapshot"

const reconstruct = mock(async (_input: PrintOptimizationReconstructionInput) => reconstruction())
const inspect = mock(async (_input: unknown): Promise<SourceImportInspection> => inspection())
const solve = mock(
  async (
    _input: StructuralOptimizationInput,
    _options: { signal?: AbortSignal; runtimeBaseUrl?: string },
  ) => verification(),
)
const commit = mock()
mock.module("../../document/document-controller", () => ({ commitAuthoredTransaction: commit }))
mock.module("@vibeshape/structural-optimization/client", () => ({
  optimizeStructuralModel: solve,
  StructuralOptimizationError,
}))
const { prepareExactPrintSnapshot } = await import("./prepare-exact-print-snapshot")

const mesh = {
  vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
  indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
}
const body = meshInspection.outputs[0]
if (!body) throw new Error("Expected an inspection fixture.")
const featureId = featureIdSchema.parse(id(3))
const source: LightweightingSource = {
  context: { documentId: id(1), revision: 4, authorityVersion: 4, historyAfter: null },
  partId: id(2),
  partName: "Beam",
  featureId,
  contentHash: "a".repeat(64),
  outputRole: "result",
  body: {
    ...body,
    shape: { ...body.shape, volume: 1000, solidCount: 1 },
    featureId,
    contentHash: "a".repeat(64),
    outputRole: "result",
    topologyCandidates: [],
  },
}
const input: StructuralOptimizationInput = {
  schemaVersion: 1,
  mesh,
  material: { youngModulusMpa: 2000, poissonRatio: 0.35, yieldStrengthMpa: 40, densityKgM3: 1250 },
  safetyFactor: 1,
  maxDisplacementMm: 1,
  cellSizeMm: 1,
  maxIterations: 10,
  supports: [{ min: [0, 0, 0], max: [2, 10, 10] }],
  loadCases: [
    { name: "axial", region: { min: [8, 0, 0], max: [10, 10, 10] }, forceN: [1, 0, 0] },
    {
      name: "torsion",
      region: { min: [8, 0, 0], max: [10, 2, 10] },
      forceN: [0, 0, 0.5],
      additionalLoads: [{ region: { min: [8, 8, 0], max: [10, 10, 10] }, forceN: [0, 0, -0.5] }],
    },
  ],
  preserveRegions: [{ kind: "surface", triangleIndices: [2, 3], depthMm: 2 }],
  algorithm: { kind: "simp", volumeFraction: 0.1, filterRadiusMm: 1.5, penalty: 3 },
  objective: { kind: "minimize-mass" },
  relativePerformance: { minStiffnessFraction: 0.9, minStrengthFraction: 0.9 },
  includeVoxelGrid: true,
  fdm: {
    buildDirection: "+z",
    supportMode: "allowed",
    minFeatureSizeMm: 1,
    layerHeightMm: 0.2,
    maxOverhangAngleDeg: 45,
  },
}
function metrics(compliance = 10, stress = 5) {
  return {
    volumeMm3: 1000,
    massKg: 0.00125,
    maxVonMisesMpa: stress,
    maxDisplacementMm: 0.1,
    safetyFactor: 8,
    cases: ["axial", "torsion"].map((name) => ({
      name,
      maxVonMisesMpa: stress,
      maxDisplacementMm: 0.1,
      safetyFactor: 8,
      complianceNmm: compliance,
    })),
  }
}
function result(): StructuralOptimizationResult {
  return {
    schemaVersion: 1,
    status: "improved",
    baseline: metrics(),
    optimized: metrics(11, 5.5),
    sourceVolumeMm3: 1000,
    sourceVolumeLossFraction: 0,
    cellSizeMm: 1,
    initialCellCount: 1000,
    finalCellCount: 2,
    iterations: 2,
    evaluations: 4,
    termination: "iteration-limit",
    warnings: [],
    mesh: structuredClone(mesh),
    voxelGrid: {
      originMm: [-0.5, -1.5, -2.5],
      cellSizeMm: 1,
      cells: [
        [1, 2, 3],
        [2, 2, 3],
      ],
    },
  }
}
function verification(): StructuralOptimizationResult {
  return {
    ...result(),
    status: "no-improvement",
    baseline: metrics(11, 5.5),
    optimized: metrics(11, 5.5),
    iterations: 0,
    initialCellCount: 2,
  }
}
function reconstruction(): PrintOptimizationReconstruction {
  return {
    source: {
      documentId: source.context.documentId,
      featureId: source.featureId,
      contentHash: source.contentHash,
      outputRole: source.outputRole,
    },
    stepBytes: new TextEncoder().encode("ISO-10303-21;exact kernel shape;END-ISO-10303-21;"),
    verificationMesh: {
      positions: Float64Array.from(
        mesh.vertices,
        (value, index) => value + ([100, 200, 300][index % 3] ?? 0),
      ),
      indices: Uint32Array.from(mesh.indices),
    },
    sourceVolumeMm3: 1000,
    volumeMm3: 500,
    preservedFaceCount: 2,
  }
}
function inspection(): SourceImportInspection {
  const value = structuredClone(importedInspection)
  const output = value.outputs[0]
  if (!output) throw new Error("Expected one exact-solid fixture.")
  output.signature.volume = 500
  return value
}
function options(): PrepareExactPrintSnapshotOptions {
  return {
    geometry: { reconstructPrintOptimization: reconstruct, inspectGeometrySource: inspect },
    source: structuredClone(source),
    input: structuredClone(input),
    result: result(),
    preserveFaceIds: [7, 8, 7],
    frame: { originMm: [100, 200, 300], rotation: [0, 0, 0, 1] },
    toPrintMesh: (value) => ({
      vertices: value.vertices.map(
        (coordinate, index) => coordinate - ([100, 200, 300][index % 3] ?? 0),
      ),
      indices: [...value.indices],
    }),
    signal: new AbortController().signal,
    current: () => true,
    onProgress: mock(),
  }
}
beforeEach(() => {
  reconstruct.mockReset().mockImplementation(async () => reconstruction())
  inspect.mockReset().mockImplementation(async () => inspection())
  solve.mockReset().mockImplementation(async () => verification())
  commit.mockClear()
  vi.stubGlobal("window", { location: { href: "http://localhost/editor/" } })
})
afterEach(() => vi.unstubAllGlobals())

describe("exact print snapshot preparation", () => {
  it("uses only the captured document's injected geometry port", async () => {
    const settings = options()
    const ownedReconstruct = mock(async () => reconstruction())
    const ownedInspect = mock(async () => inspection())
    settings.geometry = {
      reconstructPrintOptimization: ownedReconstruct,
      inspectGeometrySource: ownedInspect,
    }
    const ready = await prepareExactPrintSnapshot(settings)
    expect(ready?.exact.preservedFaceCount).toBe(2)
    expect(ownedReconstruct).toHaveBeenCalledTimes(1)
    expect(ownedInspect).toHaveBeenCalledTimes(1)
    expect(reconstruct).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
  it("captures every structural interface and imports only the reconstructed STEP bytes", async () => {
    const settings = options()
    const grid = settings.result.voxelGrid
    if (!grid) throw new Error("Expected a retained-cell fixture.")
    const captured = structuredClone({
      source: settings.source,
      input: settings.input,
      result: settings.result,
    })
    const ready = await prepareExactPrintSnapshot(settings)
    expect(reconstruct.mock.calls[0]?.[0]).toEqual({
      source: reconstruction().source,
      preserveFaceIds: [7, 8],
      voxelGrid: grid,
      sourceToPrintFrame: settings.frame,
      protectedBoxes: [
        { minMm: [0, 0, 0], maxMm: [2, 10, 10] },
        { minMm: [8, 0, 0], maxMm: [10, 10, 10] },
        { minMm: [8, 0, 0], maxMm: [10, 2, 10] },
        { minMm: [8, 8, 0], maxMm: [10, 10, 10] },
      ],
      preserveDepthMm: 2,
    })
    expect(ready?.prepared).toMatchObject({
      filename: "Beam-print-optimized.step",
      representation: "exact-solid",
      source: {
        format: "step",
        unitPolicy: "step-system-mm",
        normalization: {
          sourceUnit: "millimeter",
          scaleToMillimeters: 1,
          normalizedUnit: "millimeter",
        },
      },
    })
    expect(ready?.prepared.bytes).toEqual(reconstruction().stepBytes)
    expect(inspect.mock.calls[0]?.[0]).toEqual({
      source: ready?.prepared.source,
      bytes: reconstruction().stepBytes,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })
    expect(ready?.inspection).toEqual(inspection())
    expect(ready?.exact).toMatchObject({
      sourceVolumeMm3: 1000,
      volumeMm3: 500,
      preservedFaceCount: 2,
    })
    expect(ready?.exact.verification).not.toHaveProperty("mesh")
    expect(ready?.exact.verification).not.toHaveProperty("voxelGrid")
    expect(settings.onProgress).toHaveBeenNthCalledWith(1, "reconstructing")
    expect(settings.onProgress).toHaveBeenNthCalledWith(2, "verifying")
    expect(settings.onProgress).toHaveBeenNthCalledWith(3, "inspecting")
    expect({ source: settings.source, input: settings.input, result: settings.result }).toEqual(
      captured,
    )
    expect(commit).not.toHaveBeenCalled()
  })

  it("reanalyzes the exact print mesh on the original lattice with captured boundary interfaces", async () => {
    const settings = options()
    await prepareExactPrintSnapshot(settings)
    const fixed = solve.mock.calls[0]?.[0]
    expect(fixed).toMatchObject({
      mesh,
      boundaryReferenceMesh: input.mesh,
      maxIterations: 0,
      preserveRegions: [],
      includeVoxelGrid: false,
      voxelGridOriginMm: [-0.5, -1.5, -2.5],
      material: input.material,
      supports: input.supports,
      loadCases: input.loadCases,
      fdm: input.fdm,
      safetyFactor: 1,
      maxDisplacementMm: 1,
    })
    for (const key of ["algorithm", "objective", "relativePerformance"])
      expect(fixed).not.toHaveProperty(key)
    expect(solve.mock.calls[0]?.[1]).toEqual({
      signal: settings.signal,
      runtimeBaseUrl: "http://localhost/structural-runtime/",
    })
  })

  it("preserves only user-selected native faces, with no implicit bed-face request", async () => {
    reconstruct.mockImplementationOnce(async () => ({ ...reconstruction(), preservedFaceCount: 0 }))
    const ready = await prepareExactPrintSnapshot({ ...options(), preserveFaceIds: [] })
    expect(reconstruct.mock.calls[0]?.[0].preserveFaceIds).toEqual([])
    expect(ready?.exact.preservedFaceCount).toBe(0)
  })

  it.each(["missing", "spacing"])(
    "rejects a %s retained-cell grid before native reconstruction",
    async (kind) => {
      const settings = options()
      if (kind === "missing") delete settings.result.voxelGrid
      else if (settings.result.voxelGrid) settings.result.voxelGrid.cellSizeMm = 2
      await expect(prepareExactPrintSnapshot(settings)).rejects.toMatchObject({
        code: "exact-reconstruction-failed",
      })
      expect(reconstruct).not.toHaveBeenCalled()
    },
  )

  it.each(["documentId", "featureId", "contentHash", "outputRole"] as const)(
    "rejects a stale %s echo",
    async (key) => {
      reconstruct.mockImplementationOnce(async () => {
        const value = reconstruction()
        value.source[key] =
          key === "contentHash" ? "b".repeat(64) : key === "outputRole" ? "other" : id(99)
        return value
      })
      await expect(prepareExactPrintSnapshot(options())).rejects.toMatchObject({
        code: "exact-reconstruction-failed",
      })
      expect(solve).not.toHaveBeenCalled()
      expect(inspect).not.toHaveBeenCalled()
    },
  )

  it.each([
    { preservedFaceCount: 1 },
    { volumeMm3: 1000 },
    { volumeMm3: 1001 },
    { volumeMm3: 0 },
    { sourceVolumeMm3: 0 },
    { sourceVolumeMm3: 2000 },
  ])("rejects inconsistent native proof and actual volume %j", async (change) => {
    reconstruct.mockImplementationOnce(async () => ({ ...reconstruction(), ...change }))
    await expect(prepareExactPrintSnapshot(options())).rejects.toMatchObject({
      code: "exact-reconstruction-failed",
    })
    expect(solve).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })

  it.each([
    "stiffness",
    "strength",
    "zero-compliance",
    "zero-stress",
    "baseline-zero-compliance",
    "baseline-zero-stress",
    "case-name",
    "missing-case",
  ])("rejects %s against the original baseline before import inspection", async (kind) => {
    const settings = options()
    const baseline = settings.result.baseline.cases[0]
    if (!baseline) throw new Error("Expected an original baseline case.")
    if (kind === "baseline-zero-compliance") baseline.complianceNmm = 0
    if (kind === "baseline-zero-stress") baseline.maxVonMisesMpa = 0
    solve.mockImplementationOnce(async () => {
      const value = verification()
      const candidate = value.optimized.cases[0]
      if (!candidate) throw new Error("Expected a loaded verification case.")
      if (kind === "stiffness") candidate.complianceNmm = 12
      if (kind === "strength") candidate.maxVonMisesMpa = 6
      if (kind === "zero-compliance") candidate.complianceNmm = 0
      if (kind === "zero-stress") candidate.maxVonMisesMpa = 0
      if (kind === "case-name") candidate.name = "other"
      if (kind === "missing-case") value.optimized.cases.pop()
      // A self-relative analysis would admit every nonzero candidate here.
      value.baseline = structuredClone(value.optimized)
      return value
    })
    await expect(prepareExactPrintSnapshot(settings)).rejects.toMatchObject({
      code: "final-verification-failed",
    })
    expect(inspect).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it.each(["volume", "multiple-solids", "invalid-solid"])(
    "rejects %s in the independent STEP inspection",
    async (kind) => {
      inspect.mockImplementationOnce(async () => {
        const value = inspection()
        const output = value.outputs[0]
        if (!output) throw new Error("Expected one exact-solid fixture.")
        if (kind === "volume") output.signature.volume = 499
        if (kind === "multiple-solids") value.outputs.push(structuredClone(output))
        if (kind === "invalid-solid") output.signature.volume = 0
        return value
      })
      await expect(prepareExactPrintSnapshot(options())).rejects.toMatchObject({
        code: "exact-reconstruction-failed",
      })
      expect(commit).not.toHaveBeenCalled()
    },
  )

  it.each(["native", "FEM", "inspection"])(
    "discards cancellation during %s without a later stage",
    async (boundary) => {
      const controller = new AbortController()
      if (boundary === "native")
        reconstruct.mockImplementationOnce(async () => {
          controller.abort()
          return reconstruction()
        })
      if (boundary === "FEM")
        solve.mockImplementationOnce(async () => {
          controller.abort()
          return verification()
        })
      if (boundary === "inspection")
        inspect.mockImplementationOnce(async () => {
          controller.abort()
          return inspection()
        })
      expect(
        await prepareExactPrintSnapshot({ ...options(), signal: controller.signal }),
      ).toBeNull()
      if (boundary === "native") expect(solve).not.toHaveBeenCalled()
      if (boundary !== "inspection") expect(inspect).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
    },
  )

  it.each(["native", "FEM", "inspection"])(
    "discards a stale source during %s without a later stage",
    async (boundary) => {
      let current = true
      if (boundary === "native")
        reconstruct.mockImplementationOnce(async () => {
          current = false
          return reconstruction()
        })
      if (boundary === "FEM")
        solve.mockImplementationOnce(async () => {
          current = false
          return verification()
        })
      if (boundary === "inspection")
        inspect.mockImplementationOnce(async () => {
          current = false
          return inspection()
        })
      expect(await prepareExactPrintSnapshot({ ...options(), current: () => current })).toBeNull()
      if (boundary === "native") expect(solve).not.toHaveBeenCalled()
      if (boundary !== "inspection") expect(inspect).not.toHaveBeenCalled()
    },
  )

  it("starts no work for an already canceled source and suppresses late native failures", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await prepareExactPrintSnapshot({ ...options(), signal: controller.signal })).toBeNull()
    expect(reconstruct).not.toHaveBeenCalled()
    const active = new AbortController()
    reconstruct.mockImplementationOnce(async () => {
      active.abort()
      throw new Error("Late kernel failure")
    })
    expect(await prepareExactPrintSnapshot({ ...options(), signal: active.signal })).toBeNull()
    expect(solve).not.toHaveBeenCalled()
  })

  it("discards cancellation while reading STEP bytes before native inspection", async () => {
    const controller = new AbortController()
    const read = File.prototype.arrayBuffer
    const spy = vi.spyOn(File.prototype, "arrayBuffer").mockImplementation(async function (
      this: File,
    ) {
      const bytes = await read.call(this)
      controller.abort()
      return bytes
    })
    try {
      expect(
        await prepareExactPrintSnapshot({ ...options(), signal: controller.signal }),
      ).toBeNull()
      expect(solve).toHaveBeenCalledTimes(1)
      expect(inspect).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
