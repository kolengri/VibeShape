import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import { generateQuickLightweighting } from "./quick-client"
import type { QuickLightweightingInput, QuickLightweightingResult } from "./quick-contract"

const vertices = [
  0, 0, 0, 0, 0, 10, 0, 10, 0, 0, 10, 10, 10, 0, 0, 10, 0, 10, 10, 10, 0, 10, 10, 10,
]
const indices = [
  0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7,
  1, 7, 3,
]
const input: QuickLightweightingInput = {
  schemaVersion: 1,
  mesh: { vertices, indices },
  mode: "preserve-exterior",
  removalPercent: 50,
  cellSizeMm: 1,
  skinThicknessMm: 2,
}
const options = { runtimeBaseUrl: "http://localhost/structural-runtime/" }

function result(): QuickLightweightingResult {
  const inner = vertices.map((value) => (value === 0 ? 2 : 8))
  const reversed = []
  for (let index = 0; index < indices.length; index += 3) {
    reversed.push(
      (indices[index + 2] ?? 0) + 8,
      (indices[index + 1] ?? 0) + 8,
      (indices[index] ?? 0) + 8,
    )
  }
  return {
    schemaVersion: 1,
    mode: input.mode,
    requestedRemovalPercent: 50,
    removedPercent: 21.6,
    sourceVolumeMm3: 1000,
    resultVolumeMm3: 784,
    cellSizeMm: 1,
    skinThicknessMm: 2,
    cellType: "gyroid",
    latticeCellSizeMm: 6,
    warnings: [],
    mesh: { vertices: [...vertices, ...inner], indices: [...indices, ...reversed] },
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

describe("disposable quick lightweighting worker client", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("Worker", FakeWorker)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("accepts measured geometry and releases its worker", async () => {
    const progress = vi.fn()
    const pending = generateQuickLightweighting(input, { ...options, onProgress: progress })
    FakeWorker.instance.emit({ type: "progress", stage: "generating" })
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: result() } })
    await expect(pending).resolves.toMatchObject({ removedPercent: 21.6 })
    expect(progress).toHaveBeenCalledWith("generating", undefined)
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects a worker response that changes the captured exterior", async () => {
    const pending = generateQuickLightweighting(input, options)
    const changed = result()
    changed.mesh.vertices[0] = 0.1
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: changed } })
    await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })

  it("rejects inconsistent actual volume evidence", async () => {
    const pending = generateQuickLightweighting(input, options)
    FakeWorker.instance.emit({
      type: "complete",
      response: { ok: true, result: { ...result(), removedPercent: 50 } },
    })
    await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
  })

  it.each([{ cellType: "schwarz-p" as const }, { latticeCellSizeMm: 12 }])(
    "rejects a response from another effective lattice %s",
    async (changed) => {
      const pending = generateQuickLightweighting(input, options)
      FakeWorker.instance.emit({
        type: "complete",
        response: { ok: true, result: { ...result(), ...changed } },
      })
      await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    },
  )

  it.each([6, 12])(
    "binds omitted Schwarz D periods to twelve samples, receiving %s",
    async (period) => {
      const pending = generateQuickLightweighting({ ...input, cellType: "schwarz-d" }, options)
      FakeWorker.instance.emit({
        type: "complete",
        response: {
          ok: true,
          result: { ...result(), cellType: "schwarz-d", latticeCellSizeMm: period },
        },
      })
      if (period === 12) await expect(pending).resolves.toMatchObject({ latticeCellSizeMm: 12 })
      else await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    },
  )

  it("terminates immediately on cancellation and ignores a late response", async () => {
    const controller = new AbortController()
    const pending = generateQuickLightweighting(input, { ...options, signal: controller.signal })
    controller.abort()
    FakeWorker.instance.emit({ type: "complete", response: { ok: true, result: result() } })
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps long computation alive until explicit cancellation", async () => {
    const controller = new AbortController()
    const progress = vi.fn()
    const pending = generateQuickLightweighting(input, {
      ...options,
      signal: controller.signal,
      onProgress: progress,
    })
    vi.advanceTimersByTime(10 * 60_000)
    expect(FakeWorker.instance.terminate).not.toHaveBeenCalled()
    FakeWorker.instance.emit({
      type: "progress",
      stage: "generating",
      progress: { phase: "sampling", completed: 200, total: 500 },
    })
    expect(progress).toHaveBeenCalledWith("generating", {
      phase: "sampling",
      completed: 200,
      total: 500,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed computation progress and releases the worker", async () => {
    const pending = generateQuickLightweighting(input, options)
    FakeWorker.instance.emit({
      type: "progress",
      stage: "generating",
      progress: { phase: "validation", completed: 501, total: 500 },
    })
    await expect(pending).rejects.toMatchObject({ code: "invalid-result" })
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })

  it("preserves the runtime stage and original cause while releasing a failed worker", async () => {
    const error = {
      code: "runtime-unavailable",
      message: "The numerical runtime failed during package loading: Wheel request returned 404",
    }
    const pending = generateQuickLightweighting(input, options)
    FakeWorker.instance.emit({ type: "complete", response: { ok: false, error } })
    await expect(pending).rejects.toMatchObject(error)
    expect(FakeWorker.instance.terminate).toHaveBeenCalledTimes(1)
  })

  it("rejects invalid source indices before starting a worker", async () => {
    const worker = vi.fn()
    vi.stubGlobal("Worker", worker)
    await expect(
      generateQuickLightweighting(
        { ...input, mesh: { vertices, indices: [90, ...indices.slice(1)] } },
        options,
      ),
    ).rejects.toMatchObject({
      code: "invalid-input",
      message: expect.stringContaining("mesh:"),
    })
    expect(worker).not.toHaveBeenCalled()
  })

  it("explains invalid skin and period settings before creating a worker", async () => {
    const worker = vi.fn()
    vi.stubGlobal("Worker", worker)
    const error = await generateQuickLightweighting(
      { ...input, skinThicknessMm: 1, latticeCellSizeMm: 3 },
      options,
    ).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error("Expected a validation diagnostic.")
    expect(error.message).toContain("Lightweighting settings are invalid. input:")
    expect(error.message).toContain("skin")
    expect(worker).not.toHaveBeenCalled()
  })

  it("bounds validation diagnostics forwarded through automation", async () => {
    const malformed = {
      ...input,
      mode: "x".repeat(1_000),
      removalPercent: -1,
      cellSizeMm: -1,
      skinThicknessMm: -1,
    } as unknown as QuickLightweightingInput
    const error = await generateQuickLightweighting(malformed, options).catch(
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error("Expected a validation diagnostic.")
    expect(error.message).toContain("mode:")
    expect(error.message).toContain("cellSizeMm:")
    expect(error.message.length).toBeLessThanOrEqual(512)
    expect(error.message).not.toContain("skinThicknessMm:")
  })
})
