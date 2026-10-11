import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { StructuralFdmSummary } from "@vibeshape/domain/lightweighting"
import { vi } from "../../../tests/unit/support/bun-test"
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
  it("enforces the hard time budget", async () => {
    const pending = optimizeStructuralModel(input, options)
    const rejected = pending.then(
      () => {
        throw new Error("Expected the hard time budget to reject the operation.")
      },
      (error: unknown) => error,
    )
    vi.advanceTimersByTime(180_000)
    expect(await rejected).toMatchObject({ code: "timeout" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })
  it.each(["stress", "case", "cells", "mesh", "precision"])(
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
      if (kind === "precision")
        invalid.mesh.vertices = invalid.mesh.vertices.map(
          (value, index) => value + (index % 3 === 0 ? 10000.0004 : 0),
        )
      FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: invalid } })
      await expect(pending).rejects.toMatchObject({
        code: kind === "precision" ? "serialization-precision" : "invalid-result",
      })
      expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    },
  )
  it("preserves solver failure codes without publishing a result", async () => {
    const pending = optimizeStructuralModel(input, options)
    FakeWorker.instance.emit({
      type: "complete",
      response: {
        ok: false,
        error: { code: "infeasible-baseline", message: "Baseline exceeds limits." },
      },
    })
    await expect(pending).rejects.toMatchObject({ code: "infeasible-baseline" })
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
