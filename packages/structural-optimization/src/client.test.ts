import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" })
    vi.advanceTimersByTime(180_000)
    await rejected
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
