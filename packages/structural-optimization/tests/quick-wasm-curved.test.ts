import { describe, expect, it } from "bun:test"
import {
  type QuickLightweightingProgress,
  quickLightweightingInputSchema,
} from "../src/quick-contract"
import { encodeQuickLightweightingStl } from "../src/quick-mesh"
import { createQuickWasmHarness, input, timeout, volume } from "./quick-wasm-helpers"

const wasm = createQuickWasmHarness()
const { run } = wasm

function expectCompletedBatches(
  progress: QuickLightweightingProgress[],
  maximumStep: Record<QuickLightweightingProgress["phase"], number>,
) {
  for (const phase of ["sampling", "validation"] as const) {
    const updates = progress.filter((update) => update.phase === phase)
    expect(updates.length).toBeGreaterThan(1)
    expect(updates[0]?.completed).toBe(0)
    const last = updates.at(-1)
    expect(last?.completed).toBe(last?.total)
    const steps = updates.map((update, index) =>
      update.completed === 0 ? 0 : update.completed - (updates[index - 1]?.completed ?? 0),
    )
    expect(Math.max(...steps)).toBeLessThanOrEqual(maximumStep[phase])
  }
}

// Shared CI runs can take nearly two minutes; this checks batching, not speed.
const denseSourceTimeout = 180_000

describe("load-free TPMS nodal geometry in the pinned WASM runtime", () => {
  it.each(
    (["cylinder", "sphere"] as const).flatMap((shape) =>
      (["preserve-exterior", "open-organic"] as const).map((mode) => ({ shape, mode })),
    ),
  )(
    "generates a curved $shape at default detail in $mode without a false proximity limit",
    async ({ shape, mode }) => {
      const primitive =
        shape === "cylinder"
          ? "trimesh.creation.cylinder(radius=5, height=10, sections=64)"
          : "trimesh.creation.icosphere(subdivisions=3, radius=5)"
      const raw = await wasm.runtime.runPythonAsync(
        `_fixture = ${primitive}; json.dumps({'vertices': _fixture.vertices.ravel().tolist(), 'indices': _fixture.faces.ravel().tolist()})`,
      )
      const request = quickLightweightingInputSchema.parse({
        ...input(mode),
        mesh: JSON.parse(String(raw)),
        cellSizeMm: 10 / 32,
        skinThicknessMm: mode === "preserve-exterior" ? (2.5 * 10) / 32 : 0,
      })
      const sourceVolume = volume(request.mesh)
      const response = await run(request)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      const result = response.result
      expect(result.sourceVolumeMm3).toBeCloseTo(sourceVolume, 7)
      expect(volume(result.mesh)).toBeCloseTo(result.resultVolumeMm3, 6)
      expect(result.removedPercent).toBeGreaterThan(20)
      expect(result.removedPercent).toBeLessThan(55)
      if (mode === "preserve-exterior") {
        expect(result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
          request.mesh.vertices,
        )
        expect(result.mesh.indices.slice(0, request.mesh.indices.length)).toEqual(
          request.mesh.indices,
        )
      }
      expect(() => encodeQuickLightweightingStl(result.mesh, result.cellSizeMm)).not.toThrow()
    },
    timeout,
  )

  it(
    "finishes a dense curved source in memory-bounded batches without a cumulative query cutoff",
    async () => {
      const raw = await wasm.runtime.runPythonAsync(
        "_fixture = trimesh.creation.icosphere(subdivisions=4, radius=5); json.dumps({'vertices': _fixture.vertices.ravel().tolist(), 'indices': _fixture.faces.ravel().tolist()})",
      )
      const request = quickLightweightingInputSchema.parse({
        ...input(),
        mesh: JSON.parse(String(raw)),
        cellSizeMm: 10 / 32,
        skinThicknessMm: (2.5 * 10) / 32,
      })
      const progress: QuickLightweightingProgress[] = []
      wasm.runtime.globals.set(
        "_QUICK_PROGRESS",
        (phase: QuickLightweightingProgress["phase"], completed: number, total: number) => {
          progress.push({ phase, completed, total })
        },
      )
      await wasm.runtime.runPythonAsync(`
_original_signed_distance = trimesh.proximity.signed_distance
_maximum_exact_batch = 0
def _record_exact_batch(mesh, points):
    global _maximum_exact_batch
    _maximum_exact_batch = max(_maximum_exact_batch, len(points))
    return _original_signed_distance(mesh, points)
trimesh.proximity.signed_distance = _record_exact_batch
`)
      try {
        const response = await run(request)
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
        expect(response.result.removedPercent).toBeGreaterThan(20)
        expect(volume(response.result.mesh)).toBeCloseTo(response.result.resultVolumeMm3, 6)
        expect(() =>
          encodeQuickLightweightingStl(response.result.mesh, response.result.cellSizeMm),
        ).not.toThrow()
        // BVH queries visit one point at a time within the bridge batch. Exact
        // Trimesh fallback and validation retain the dense pair scratch budget.
        expectCompletedBatches(progress, { sampling: 8192, validation: 25 })
        const exactBatch: unknown = await wasm.runtime.runPythonAsync("_maximum_exact_batch")
        expect(exactBatch).toBeGreaterThan(0)
        expect(exactBatch).toBeLessThanOrEqual(25)
      } finally {
        await wasm.runtime.runPythonAsync(
          "_QUICK_PROGRESS = None; trimesh.proximity.signed_distance = _original_signed_distance",
        )
      }
    },
    denseSourceTimeout,
  )
})
