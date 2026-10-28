import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { StructuralFdmSummary } from "@vibeshape/domain/lightweighting"
import { vi } from "../../../tests/unit/support/bun-test"
import { denseBoxMesh } from "../tests/dense-box-fixture"
import { optimizeStructuralModel } from "./client"
import type { StructuralOptimizationInput, StructuralOptimizationResult } from "./contract"

const mesh = {
  vertices: [-5, -1, -1, -5, -1, 1, -5, 1, -1, -5, 1, 1, 5, -1, -1, 5, -1, 1, 5, 1, -1, 5, 1, 1],
  indices: [
    1, 3, 0, 4, 1, 0, 0, 3, 2, 2, 4, 0, 1, 7, 3, 5, 1, 4, 5, 7, 1, 3, 7, 2, 6, 4, 2, 2, 7, 6, 6, 5,
    4, 7, 5, 6,
  ],
}
const input: StructuralOptimizationInput = {
  schemaVersion: 1,
  mesh,
  material: { youngModulusMpa: 1000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1000 },
  safetyFactor: 2,
  maxDisplacementMm: 1,
  cellSizeMm: 1,
  supports: [{ min: [-5, -1, -1], max: [-5, 1, 1] }],
  loadCases: [{ name: "axial", region: { min: [5, -1, -1], max: [5, 1, 1] }, forceN: [10, 0, 0] }],
  preserveRegions: [],
  maxIterations: 0,
}
function result(): StructuralOptimizationResult {
  const metrics = {
    volumeMm3: 40,
    massKg: 0.00004,
    maxVonMisesMpa: 2.5,
    maxDisplacementMm: 0.025,
    safetyFactor: 40,
    cases: [
      {
        name: "axial",
        maxVonMisesMpa: 2.5,
        maxDisplacementMm: 0.025,
        safetyFactor: 40,
        complianceNmm: 0.25,
      },
    ],
  }
  return {
    schemaVersion: 1,
    status: "no-improvement",
    mesh: structuredClone(mesh),
    baseline: structuredClone(metrics),
    optimized: structuredClone(metrics),
    sourceVolumeMm3: 40,
    sourceVolumeLossFraction: 0,
    cellSizeMm: 1,
    initialCellCount: 40,
    finalCellCount: 40,
    iterations: 0,
    evaluations: 2,
    termination: "iteration-limit",
    warnings: [],
  }
}
function stiffnessMetadata(output: StructuralOptimizationResult) {
  if (output.objective?.kind !== "maximize-stiffness")
    throw new Error("The fixture requires stiffness metadata.")
  return output.objective
}
class FakeWorker {
  static instance: FakeWorker
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    FakeWorker.instance = this
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>)
  }
}
const options = { runtimeBaseUrl: "http://localhost/structural-runtime/" }
describe("bounded structural worker client", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("Worker", FakeWorker)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it("starts analysis for a closed source above the former vertex and triangle counts", async () => {
    const source = { ...input, mesh: denseBoxMesh() }
    const pending = optimizeStructuralModel(source, options)
    expect(FakeWorker.instance.postMessage).toHaveBeenCalledWith({
      input: source,
      runtimeBaseUrl: options.runtimeBaseUrl,
    })
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: result() } })
    await expect(pending).resolves.toMatchObject({ initialCellCount: 40 })
  })
  it.each(["mesh", "support"])(
    "identifies an invalid captured %s triangle before starting a worker",
    async (kind) => {
      const worker = vi.fn()
      vi.stubGlobal("Worker", worker)
      const source = structuredClone(input)
      if (kind === "mesh") source.mesh.indices[0] = 8
      else source.supports = [{ kind: "surface", triangleIndices: [12], depthMm: 1 }]
      await expect(optimizeStructuralModel(source, options)).rejects.toMatchObject({
        code: "invalid-input",
        message: expect.stringContaining(
          kind === "mesh"
            ? "mesh: Meshes require complete XYZ triples and valid triangle indices."
            : "supports.0.triangleIndices: Surface triangle indices must reference the captured source mesh.",
        ),
      })
      expect(worker).not.toHaveBeenCalled()
    },
  )
  it("bounds input diagnostics for browser automation without discarding the first issue path", async () => {
    const source = {
      ...input,
      mesh: { ...mesh, vertices: Array(30).fill(Number.NaN) },
    }
    try {
      await optimizeStructuralModel(source, options)
      throw new Error("Malformed coordinates must reject before analysis.")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain("mesh.vertices.0:")
      expect(error.message).toContain("mesh.vertices.2:")
      expect(error.message).not.toContain("mesh.vertices.3:")
      expect(error.message.length).toBeLessThanOrEqual(512)
    }
  })
  it("bounds diagnostics containing long unrecognized keys to the automation message limit", async () => {
    const extra = { ["unsupported".repeat(100)]: true }
    try {
      await optimizeStructuralModel(
        {
          ...input,
          ...extra,
          mesh: { ...mesh, ...extra },
          material: { ...input.material, ...extra },
        },
        options,
      )
      throw new Error("Unrecognized keys must reject before analysis.")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain("material:")
      expect(error.message).toContain("mesh:")
      expect(error.message.length).toBeLessThanOrEqual(512)
    }
  })
  function fdmOutput(): StructuralFdmSummary {
    return {
      settings: {
        buildDirection: "+x",
        supportMode: "allowed",
        minFeatureSizeMm: 1,
        layerHeightMm: 0.2,
        maxOverhangAngleDeg: 45,
      },
      approximation: "conservative-voxel",
      minimumFeatureCubeCells: 1,
      horizontalReachMm: 0.2,
      buildPlateCoordinateMm: -5,
      baseline: {
        unsupportedAreaMm2: 0,
        requiresSupports: false,
        minFeatureSizeBoundMm: 1,
        buildHeightMm: 10,
      },
      optimized: {
        unsupportedAreaMm2: 0,
        requiresSupports: false,
        minFeatureSizeBoundMm: 1,
        buildHeightMm: 10,
      },
    }
  }
  const algorithms = [
    { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 },
    {
      kind: "adaptive-lattice",
      lattice: "gyroid",
      cellPeriodMm: 12,
      minWallThicknessMm: 2,
      maxWallThicknessMm: 3,
      skinThicknessMm: 0,
      field: "strain-energy",
      gamma: 1,
    },
  ] as const
  function algorithmResult(algorithm: (typeof algorithms)[number]): StructuralOptimizationResult {
    const algorithmEvidence =
      algorithm.kind === "simp"
        ? {
            kind: "simp" as const,
            settings: algorithm,
            densityIterations: 0,
            converged: false,
            maxDensityChange: 1,
            targetCellCount: 32,
            achievedCellCount: 40,
            targetStatus: "not-reached" as const,
            projectionEvaluations: 0,
          }
        : {
            kind: "adaptive-lattice" as const,
            settings: algorithm,
            fieldMin: 1,
            fieldMax: 2,
            requestedWallMinMm: 2.5,
            requestedWallMaxMm: 3,
            minimumFeatureSizeBoundMm: 2,
            projectionEvaluations: 0,
            thresholdPasses: 0,
          }
    return { ...result(), algorithm: algorithmEvidence }
  }
  it.each(algorithms)(
    "binds %s projection evidence to the request and FEM counts",
    async (algorithm) => {
      for (const [budget, iterations, projections, evaluationDelta, accepted] of [
        [0, 0, 0, 0, true],
        [0, 0, 80, -80, false],
        [0, 0, 1, 0, false],
        [1, 1, 1, 0, true],
        [1, 1, 2, 0, algorithm.kind === "simp"],
        [1, 1, 3, 0, false],
        [40, 40, 80, 0, false],
        [40, 40, 2, 0, true],
        [4, 4, 1, -1, false],
        [4, 4, 1, 1, false],
      ] as const) {
        const output = algorithmResult(algorithm)
        const evidence = output.algorithm
        if (!evidence) throw new Error("Expected algorithm evidence.")
        output.algorithm =
          evidence.kind === "simp"
            ? { ...evidence, densityIterations: iterations, projectionEvaluations: projections }
            : { ...evidence, thresholdPasses: iterations, projectionEvaluations: projections }
        output.iterations = iterations
        output.evaluations =
          2 + (algorithm.kind === "simp" ? iterations : 0) + projections + evaluationDelta
        const pending = optimizeStructuralModel(
          { ...input, algorithm, maxIterations: budget },
          options,
        )
        FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
        if (accepted) await expect(pending).resolves.toEqual(output)
        else await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
      }
    },
  )
  it.each(algorithms)("accepts exact %s request evidence", async (algorithm) => {
    const output = algorithmResult(algorithm)
    const pending = optimizeStructuralModel({ ...input, algorithm }, options)
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
    await expect(pending).resolves.toEqual(output)
  })
  it.each(algorithms)("rejects missing or forged %s algorithm evidence", async (algorithm) => {
    for (const evidence of [
      undefined,
      { ...algorithmResult(algorithm).algorithm, settings: { ...algorithm, kind: "forged" } },
    ]) {
      const output = { ...result(), ...(evidence ? { algorithm: evidence } : {}) }
      const pending = optimizeStructuralModel({ ...input, algorithm }, options)
      FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
      await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    }
  })
  it.each(algorithms)(
    "terminates canceled %s searches and ignores late output",
    async (algorithm) => {
      const controller = new AbortController()
      const pending = optimizeStructuralModel(
        { ...input, algorithm },
        { ...options, signal: controller.signal },
      )
      controller.abort()
      FakeWorker.instance.emit({
        type: "complete",
        response: { ok: true, result: algorithmResult(algorithm) },
      })
      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
      expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )
  it("accepts request-bound FDM metrics and releases the worker", async () => {
    const fdm = fdmOutput()
    const output = { ...result(), fdm }
    const pending = optimizeStructuralModel({ ...input, fdm: fdm.settings }, options)
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
    await expect(pending).resolves.toEqual(output)
  })
  it.each<[string, (fdm: StructuralFdmSummary) => void]>([
    [
      "settings",
      (fdm) => {
        fdm.settings.buildDirection = "-x"
      },
    ],
    [
      "bound",
      (fdm) => {
        fdm.optimized.minFeatureSizeBoundMm = 0.99
      },
    ],
    [
      "cube",
      (fdm) => {
        fdm.minimumFeatureCubeCells = 2
      },
    ],
    [
      "area",
      (fdm) => {
        fdm.optimized.unsupportedAreaMm2 = 1
      },
    ],
    [
      "reach",
      (fdm) => {
        fdm.horizontalReachMm = 2
      },
    ],
  ])("rejects mismatched FDM %s metrics", async (_, change) => {
    const fdm = fdmOutput()
    const request = { ...input, fdm: { ...fdm.settings } }
    change(fdm)
    const pending = optimizeStructuralModel(request, options)
    FakeWorker.instance.emit({
      type: "complete",
      response: { ok: true, result: { ...result(), fdm } },
    })
    await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })
  it.each(["missing", "unsolicited"])("rejects %s FDM response metadata", async (kind) => {
    const fdm = fdmOutput()
    const pending = optimizeStructuralModel(
      kind === "missing" ? { ...input, fdm: fdm.settings } : input,
      options,
    )
    FakeWorker.instance.emit({
      type: "complete",
      response: { ok: true, result: kind === "missing" ? result() : { ...result(), fdm } },
    })
    await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
  })
  it("accepts a feasible closed result and releases the worker", async () => {
    const progress = vi.fn()
    const pending = optimizeStructuralModel(input, { ...options, onProgress: progress })
    FakeWorker.instance.emit({ type: "progress", stage: "solving" })
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: result() } })
    await expect(pending).resolves.toMatchObject({ status: "no-improvement" })
    expect(progress).toHaveBeenCalledWith("solving")
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(["reached", "not-reached"] as const)(
    "accepts measured %s stiffness-target metadata",
    async (targetStatus) => {
      const retainedMassFraction = targetStatus === "reached" ? 1 : 0.96
      const request = {
        ...input,
        objective: { kind: "maximize-stiffness" as const, retainedMassFraction },
      }
      const output = result()
      output.objective = {
        ...request.objective,
        targetMassKg: 0.00004 * retainedMassFraction,
        targetCellCount: targetStatus === "reached" ? 40 : 39,
        achievedRetainedMassFraction: 1,
        targetStatus,
      }
      if (targetStatus === "reached") output.termination = "target-mass-reached"
      const pending = optimizeStructuralModel(request, options)
      FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
      await expect(pending).resolves.toEqual(output)
    },
  )
  it.each<
    [string, (output: StructuralOptimizationResult, request: StructuralOptimizationInput) => void]
  >([
    [
      "missing",
      (output) => {
        delete output.objective
      },
    ],
    [
      "request-objective",
      (_, request) => {
        delete request.objective
      },
    ],
    [
      "fraction",
      (output) => {
        stiffnessMetadata(output).retainedMassFraction = 0.9
      },
    ],
    [
      "target-count",
      (output) => {
        stiffnessMetadata(output).targetCellCount = 40
      },
    ],
    [
      "target-mass",
      (output) => {
        stiffnessMetadata(output).targetMassKg = 0.00004
      },
    ],
    [
      "achieved-fraction",
      (output) => {
        stiffnessMetadata(output).achievedRetainedMassFraction = 0.975
      },
    ],
    [
      "status",
      (output) => {
        stiffnessMetadata(output).targetStatus = "reached"
      },
    ],
    [
      "termination",
      (output) => {
        output.termination = "target-mass-reached"
      },
    ],
    [
      "mass",
      (output) => {
        output.optimized.massKg *= 0.5
      },
    ],
    [
      "undershoot",
      (output) => {
        output.finalCellCount = 38
        output.optimized.massKg = 0.000038
        output.optimized.volumeMm3 = 38
        output.status = "improved"
        stiffnessMetadata(output).achievedRetainedMassFraction = 0.95
      },
    ],
    [
      "compliance",
      (output) => {
        const loadCase = output.optimized.cases[0]
        if (!loadCase) throw new Error("The fixture load case is required.")
        loadCase.complianceNmm = 0
      },
    ],
  ])("rejects forged stiffness %s metadata", async (_, forge) => {
    const output = result()
    output.objective = {
      kind: "maximize-stiffness",
      retainedMassFraction: 0.96,
      targetMassKg: 0.0000384,
      targetCellCount: 39,
      achievedRetainedMassFraction: 1,
      targetStatus: "not-reached",
    }
    const request: StructuralOptimizationInput = {
      ...input,
      objective: { kind: "maximize-stiffness" as const, retainedMassFraction: 0.96 },
    }
    forge(output, request)
    const pending = optimizeStructuralModel(request, options)
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
    await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })
  it("terminates canceled work and ignores a late result", async () => {
    const controller = new AbortController()
    const pending = optimizeStructuralModel(input, { ...options, signal: controller.signal })
    controller.abort()
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: result() } })
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("keeps long-running work pending and cancellable", async () => {
    const controller = new AbortController()
    const pending = optimizeStructuralModel(input, { ...options, signal: controller.signal })
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000)
    expect(FakeWorker.instance.terminate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })
  it.each(["stress", "case", "cells", "mesh", "bounds"])(
    "rejects a forged %s result",
    async (kind) => {
      const pending = optimizeStructuralModel(input, options)
      const invalid = result()
      if (kind === "stress") invalid.optimized.maxVonMisesMpa = 51
      if (kind === "case") {
        const first = invalid.optimized.cases[0]
        if (!first) throw new Error("Missing case fixture.")
        first.name = "other"
      }
      if (kind === "cells") invalid.finalCellCount = 41
      if (kind === "mesh") invalid.mesh.indices.splice(0, 3)
      if (kind === "bounds")
        invalid.mesh.vertices = invalid.mesh.vertices.map(
          (value, index) => value + (index % 3 === 0 ? 10000.0004 : 0),
        )
      FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: invalid } })
      await expect(pending).rejects.toMatchObject({
        code: "invalid-result",
      })
      expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    },
  )
  it("accepts a matching translated source through exact 3MF validation", async () => {
    const translated = structuredClone(input)
    const shift = 10000.0004
    const coordinate = (value: number, index: number) => value + (index % 3 === 0 ? shift : 0)
    translated.mesh.vertices = translated.mesh.vertices.map(coordinate)
    translated.supports = [{ min: [-5 + shift, -1, -1], max: [-5 + shift, 1, 1] }]
    translated.loadCases = [
      {
        name: "axial",
        region: { min: [5 + shift, -1, -1], max: [5 + shift, 1, 1] },
        forceN: [10, 0, 0],
      },
    ]
    const output = result()
    output.mesh.vertices = output.mesh.vertices.map(coordinate)
    const pending = optimizeStructuralModel(translated, options)
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: output } })
    await expect(pending).resolves.toEqual(output)
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })
  it.each([
    { code: "infeasible-baseline", message: "Baseline exceeds limits." },
    {
      code: "runtime-unavailable",
      message: "The numerical runtime failed during module loading: Failed to fetch pyodide.mjs",
    },
  ])("preserves worker failure codes and causes without publishing a result: %s", async (error) => {
    const pending = optimizeStructuralModel(input, options)
    FakeWorker.instance.emit({
      type: "complete",
      response: {
        ok: false,
        error,
      },
    })
    await expect(pending).rejects.toMatchObject(error)
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })
  it("releases the worker if a progress consumer throws", async () => {
    const pending = optimizeStructuralModel(input, {
      ...options,
      onProgress() {
        throw new Error("consumer failed")
      },
    })
    FakeWorker.instance.emit({ type: "progress", stage: "loading" })
    await expect(pending).rejects.toThrow("consumer failed")
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
