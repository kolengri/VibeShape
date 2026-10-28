import { describe, expect, it } from "bun:test"
import type { PyBuffer } from "pyodide/ffi"
import { quickLightweightingInputSchema } from "../src/quick-contract"
import { createQuickSampling } from "../src/quick-sampling"
import { createQuickWasmHarness, input, timeout } from "./quick-wasm-helpers"

const wasm = createQuickWasmHarness()

describe("BVH Quick sampling in the numerical runtime", () => {
  it(
    "retains interior grid nodes when a fixed ray misses a vertex exit",
    async () => {
      const request = input()
      const extents = [20.30612373898844, 13.82357190716471, 15.451939457924883]
      request.mesh.vertices = request.mesh.vertices.map(
        (value, index) => (value * (extents[index % 3] as number)) / 10,
      )
      request.cellSizeMm = 1
      request.skinThicknessMm = 2
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const sampling = createQuickSampling(request)
      wasm.runtime.globals.set("_QUICK_SAMPLE", sampling.sample)
      try {
        const distances = JSON.parse(
          String(
            await wasm.runtime.runPythonAsync(
              "json.dumps(_distances(_QUICK_CONTEXT, np.array([[10.,10.,10.],[0.1,0.1,0.1]]), 'sampling').tolist())",
            ),
          ),
        )
        expect(distances[0]).toBeCloseTo(3.8235719071647107, 10)
        expect(distances[1]).toBeCloseTo(0.1, 10)
      } finally {
        wasm.runtime.runPython("_QUICK_SAMPLE = None")
        sampling.dispose()
      }
      const repeated = JSON.parse(
        String(await wasm.runtime.runPythonAsync("prepare_quick_json(_quick_request_json)")),
      )
      expect(repeated.ok).toBe(true)
    },
    timeout,
  )

  it.each(["box", "annulus"])(
    "matches exact signed distances for a %s, including edges, vertices and exterior points",
    async (shape) => {
      const raw = await wasm.runtime.runPythonAsync(`
_shape = trimesh.creation.box(extents=[8., 12., 10.]) if '${shape}' == 'box' else trimesh.creation.annulus(r_min=3., r_max=6., height=8., sections=24)
json.dumps({'vertices': _shape.vertices.ravel().tolist(), 'indices': _shape.faces.ravel().tolist()})
`)
      const request = quickLightweightingInputSchema.parse({
        ...input(),
        mesh: JSON.parse(String(raw)),
      })
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const sampling = createQuickSampling(request)
      let queries = 0
      wasm.runtime.globals.set("_QUICK_SAMPLE", (points: PyBuffer) => {
        queries++
        return sampling.sample(points)
      })
      try {
        const comparison = JSON.parse(
          String(
            await wasm.runtime.runPythonAsync(`
_rng = np.random.default_rng(1741)
_mesh = _QUICK_CONTEXT['source']
_points = np.vstack((_rng.uniform(_mesh.bounds[0]-2, _mesh.bounds[1]+2, (512,3)), _mesh.vertices, _mesh.triangles_center))
_expected = _distances(_QUICK_CONTEXT, _points)
_actual = _distances(_QUICK_CONTEXT, _points, 'sampling')
_inside = np.all((_points >= _mesh.bounds[0]) & (_points <= _mesh.bounds[1]), axis=1)
json.dumps({'maxDifference':float(np.max(np.abs(_expected[_inside]-_actual[_inside]))), 'signMismatches':int(np.count_nonzero((_expected>1e-8)!=(_actual>1e-8)))})
`),
          ),
        )
        expect(queries).toBeGreaterThan(0)
        expect(comparison.maxDifference).toBeLessThan(1e-9)
        expect(comparison.signMismatches).toBe(0)
        if (shape === "annulus") {
          // Above the outer corner, all three fixed rays leave the AABB without
          // entering material. The surface-directed ray still resolves the sign.
          const corner = JSON.parse(
            String(
              await wasm.runtime.runPythonAsync(`
_corner = (_mesh.bounds[1]-1).reshape(1,3)
json.dumps({'sampled':np.asarray(_QUICK_SAMPLE(_corner.ravel()).to_py()).tolist()[0], 'exact':float(trimesh.proximity.signed_distance(_mesh, _corner)[0])})
`),
            ),
          )
          expect(Number.isFinite(corner.sampled)).toBe(true)
          expect(corner.sampled).toBeLessThan(0)
          expect(corner.sampled).toBeCloseTo(corner.exact, 9)
        }
      } finally {
        wasm.runtime.runPython("_QUICK_SAMPLE = None")
        sampling.dispose()
      }
    },
    timeout,
  )

  it(
    "falls back in bounded scratch batches when every accelerated sign is ambiguous",
    async () => {
      const prepared = await wasm.prepare(input())
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      wasm.runtime.globals.set("_QUICK_SAMPLE", (points: PyBuffer) =>
        new Float64Array(points.length / 3).fill(NaN),
      )
      try {
        const comparison = JSON.parse(
          String(
            await wasm.runtime.runPythonAsync(`
_points = np.random.default_rng(22).uniform(1, 39, (160,3))
_expected = _distances(_QUICK_CONTEXT, _points)
_original_distance = trimesh.proximity.signed_distance
_fallback_sizes = []
def _record_fallback(mesh, points):
    _fallback_sizes.append(len(points))
    return _original_distance(mesh, points)
trimesh.proximity.signed_distance = _record_fallback
try:
    _actual = _distances(_QUICK_CONTEXT, _points, 'sampling')
finally:
    trimesh.proximity.signed_distance = _original_distance
json.dumps({'maxDifference':float(np.max(np.abs(_expected-_actual))), 'count':sum(_fallback_sizes), 'maxBatch':max(_fallback_sizes)})
`),
          ),
        )
        expect(comparison.maxDifference).toBeLessThan(1e-10)
        expect(comparison.count).toBe(160)
        expect(comparison.maxBatch).toBeLessThanOrEqual(128)
      } finally {
        wasm.runtime.runPython("_QUICK_SAMPLE = None")
      }
    },
    timeout,
  )

  it(
    "rejects proven insufficient clearance before allocating or sampling the grid",
    async () => {
      const request = { ...input(), cellSizeMm: 1, skinThicknessMm: 4 }
      let calls = 0
      wasm.runtime.globals.set("_QUICK_SAMPLE", () => {
        calls++
        throw new Error("Sampling must not start.")
      })
      try {
        wasm.runtime.globals.set("_quick_request_json", JSON.stringify(request))
        const result = JSON.parse(
          String(await wasm.runtime.runPythonAsync("prepare_quick_json(_quick_request_json)")),
        )
        expect(calls).toBe(0)
        expect(result.ok).toBe(false)
        expect(result.error.code).toBe("no-removable-material")
        expect(result.error.message).toContain("Source bounds limit interior clearance to 5 mm")
      } finally {
        wasm.runtime.runPython("_QUICK_SAMPLE = None")
      }
    },
    timeout,
  )
})
