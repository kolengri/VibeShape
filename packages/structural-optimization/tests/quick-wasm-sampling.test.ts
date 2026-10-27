import { describe, expect, it } from "bun:test"
import {
  type QuickLightweightingInput,
  quickLightweightingInputSchema,
  quickLightweightingResponseSchema,
} from "../src/quick-contract"
import { generateValidatedQuickLightweighting } from "../src/quick-generation"
import { encodeQuickLightweightingStl } from "../src/quick-mesh"
import { createQuickWasmHarness, input, timeout, volume } from "./quick-wasm-helpers"

const wasm = createQuickWasmHarness()

async function finish(candidate: unknown) {
  wasm.runtime.globals.set("_quick_candidate_json", JSON.stringify(candidate))
  const response = await wasm.runtime.runPythonAsync("finish_quick_json(_quick_candidate_json)")
  return quickLightweightingResponseSchema.parse(JSON.parse(String(response)))
}

async function fixture(mode: QuickLightweightingInput["mode"]) {
  const raw = await wasm.runtime.runPythonAsync(
    "_fixture = trimesh.creation.box(extents=[24, 16, 8]); json.dumps({'vertices': _fixture.vertices.ravel().tolist(), 'indices': _fixture.faces.ravel().tolist()})",
  )
  return quickLightweightingInputSchema.parse({
    ...input(mode),
    mesh: JSON.parse(String(raw)),
    cellSizeMm: 0.5,
    skinThicknessMm: mode === "preserve-exterior" ? 1 : 0,
    removalPercent: mode === "preserve-exterior" ? 10 : 40,
  })
}

describe("Quick sampling outside the source bounds", () => {
  it(
    "rejects serialized cavity intersections before returning an analysis result",
    async () => {
      const request = input()
      request.mesh.vertices = request.mesh.vertices.map((value) => 99_999 + value / 160)
      request.cellSizeMm = 1 / 512
      request.skinThicknessMm = 2 / 512
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const intermediate = await finish({
        vertices: [
          26.3, 26.3, 26.3, 26.8, 25.9, 25.9, 25.9, 26.8, 25.9, 25.9, 25.9, 26.8, 25.7, 25.7, 25.7,
          25.2, 26.1, 26.1, 26.1, 25.2, 26.1, 26.1, 26.1, 25.2,
        ],
        indices: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2, 4, 6, 5, 4, 5, 7, 4, 7, 6, 5, 6, 7],
        threshold: 1.5,
      })
      expect(intermediate.ok).toBe(true)
      const response = await generateValidatedQuickLightweighting(
        request,
        prepared.grid,
        async () => intermediate,
      )
      expect(response.ok).toBe(false)
      if (response.ok)
        throw new Error("Intersecting serialized cavities must not reach analysis consumers.")
      expect(response.error.code).toBe("serialization-precision")
      expect(response.error.message).toContain("touch or intersect")
    },
    timeout,
  )

  it(
    "retains logical-source skin checks when rounding expands the serialized exterior",
    async () => {
      const request = input()
      request.mesh.vertices = request.mesh.vertices.map((value) => 99_999 + 1.5 / 512 + value / 160)
      request.cellSizeMm = 1 / 512
      request.skinThicknessMm = 2 / 512
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const response = await finish({
        vertices: [1.1, 13, 13, 5.1, 13, 13, 1.1, 17, 13, 1.1, 13, 17],
        indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
        threshold: 1.5,
      })
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Serialized expansion must not weaken logical skin.")
      expect(response.error.code).toBe("invalid-mesh")
      expect(response.error.message).toContain("source envelope")
    },
    timeout,
  )

  it(
    "rejects a closed cavity that float32 rounding turns into added material",
    async () => {
      const request = input()
      request.mesh.vertices = request.mesh.vertices.map((value) => 99_999 + value / 160)
      request.cellSizeMm = 1 / 512
      request.skinThicknessMm = 2 / 512
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const response = await finish({
        vertices: [
          25.891325250267982, 26.394007205963135, 26.086774595081806, 25.724759802222252,
          26.046637073159218, 25.807555451989174, 26.47634046524763, 25.84394610673189,
          25.625500351190567, 26.206970795989037, 26.29716120660305, 26.490000940859318,
        ],
        indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
        threshold: 1.5,
      })
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Serialized cavity winding must survive rounding.")
      expect(response.error.code).toBe("serialization-precision")
      expect(response.error.message).toContain("inverted")
    },
    timeout,
  )

  it(
    "measures serialized skin against the rounded captured exterior",
    async () => {
      const request = input()
      request.mesh.vertices = request.mesh.vertices.map((value) => 99_999 + 1.5 / 512 + value / 160)
      request.cellSizeMm = 1 / 512
      request.skinThicknessMm = 5 / 512
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const response = await finish({
        vertices: [21.1, 13.1, 13.1, 25.1, 13.1, 13.1, 21.1, 17.1, 13.1, 21.1, 13.1, 17.1],
        indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
        threshold: 1.5,
      })
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("The physical serialized skin must retain its thickness.")
      expect(response.error.code).toBe("invalid-mesh")
      expect(response.error.message).toContain("source envelope")
    },
    timeout,
  )

  it(
    "rejects a surviving float32 cavity whose rounding breaches the preserved skin",
    async () => {
      const request = input()
      request.mesh.vertices = request.mesh.vertices.map((value) => 99_999 + value * 0.0125)
      request.cellSizeMm = 1 / 512
      request.skinThicknessMm = 5 / 512
      const prepared = await wasm.prepare(request)
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const response = await finish({
        vertices: [5.1, 10, 10, 10, 5.1, 10, 10, 10, 5.1, 20, 20, 20],
        indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
        threshold: 1.5,
      })
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Rounded cavities must retain the requested skin.")
      expect(response.error.code).toBe("invalid-mesh")
      expect(response.error.message).toContain("source envelope")
    },
    timeout,
  )

  it(
    "rejects a translated snapshot when float32 rounding destroys its actual surface",
    async () => {
      const request = await fixture("preserve-exterior")
      request.mesh.vertices = request.mesh.vertices.map((value) => 99_999 + value * 0.0001)
      request.cellSizeMm *= 0.0001
      request.skinThicknessMm *= 0.0001
      const response = await wasm.run(request)
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Collapsed float32 geometry must not be published.")
      expect(response.error.code).toBe("serialization-precision")
      expect(response.error.message).toContain("collapsed")
    },
    timeout,
  )

  it.each(["preserve-exterior", "open-organic"] as const)(
    "validates the actual float32 snapshot at a translated origin in %s",
    async (mode) => {
      const request = await fixture(mode)
      request.mesh.vertices = request.mesh.vertices.map(
        (value, index) => value + ([140.1234567, 80.7654321, 17.3456789][index % 3] ?? 0),
      )
      const response = await wasm.run(request)
      if (!response.ok) throw new Error(JSON.stringify(response.error))
      const rounded = response.result.mesh.vertices.map(Math.fround)
      expect(
        Math.max(
          ...rounded.map((value, index) =>
            Math.abs(value - (response.result.mesh.vertices[index] ?? 0)),
          ),
        ),
      ).toBeGreaterThan(0.5e-5)
      expect(() => encodeQuickLightweightingStl(response.result.mesh, 0.5)).not.toThrow()
      expect(
        volume({ ...response.result.mesh, vertices: rounded }) / response.result.resultVolumeMm3,
      ).toBeCloseTo(1, 5)
      if (mode === "preserve-exterior") {
        expect(response.result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
          request.mesh.vertices,
        )
        expect(response.result.skinThicknessMm).toBe(1)
      }
    },
    timeout,
  )

  it(
    "keeps exact triangle-box overlap for volumetric, planar and touching queries",
    async () => {
      const matches = await wasm.runtime.runPythonAsync(`
_rng = np.random.default_rng(42)
_triangles = _rng.uniform(-5, 5, (200, 3, 3))
_index = _SpatialTriangleIndex(_triangles)
_queries = [np.r_[lo, hi] for lo, hi in zip(_index.lo, _index.hi)]
_queries += [np.r_[point, point] for point in _triangles[:, 0]]
_queries += [np.array([-5., -5., 0., 5., 5., 0.]), np.array([20., 20., 20., 21., 21., 21.])]
all(np.array_equal(np.sort(_index.intersection(bounds)),
                   np.flatnonzero(np.all((_index.lo <= bounds[3:]) & (_index.hi >= bounds[:3]), axis=1)))
    for bounds in _queries)
`)
      expect(matches).toBe(true)
    },
    timeout,
  )

  it(
    "explains a thin solid's unavailable clearance and retains its skin with finer cells",
    async () => {
      const raw = await wasm.runtime.runPythonAsync(
        "_fixture = trimesh.creation.box(extents=[6.2, 12, 12]); json.dumps({'vertices': _fixture.vertices.ravel().tolist(), 'indices': _fixture.faces.ravel().tolist()})",
      )
      const request = quickLightweightingInputSchema.parse({
        ...input(),
        mesh: JSON.parse(String(raw)),
        cellSizeMm: 1,
        skinThicknessMm: 2,
        latticeCellSizeMm: 12,
        cellType: "schwarz-p",
        removalPercent: 35,
      })
      const coarse = await wasm.prepare(request)
      expect(coarse.ok).toBe(false)
      expect(coarse.error?.code).toBe("no-removable-material")
      expect(coarse.error?.message).toContain("Maximum sampled interior clearance 3 mm")
      expect(coarse.error?.message).toContain("preserved skin 2 mm plus sampling margin 1.73205 mm")
      const fine = await wasm.run({ ...request, cellSizeMm: 0.5 })
      if (!fine.ok) throw new Error(JSON.stringify(fine.error))
      expect(fine.result.skinThicknessMm).toBe(2)
      expect(fine.result.removedPercent).toBeGreaterThan(0)
      expect(fine.result.removedPercent).toBeLessThan(35)
      expect(fine.result.warnings.some((warning) => warning.includes("Requested 35%"))).toBe(true)
      expect(fine.result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
        request.mesh.vertices,
      )
      expect(volume(fine.result.mesh)).toBeCloseTo(fine.result.resultVolumeMm3, 7)
    },
    timeout,
  )

  it.each(["preserve-exterior", "open-organic"] as const)(
    "retains the exact-distance result in %s while querying only source-bound samples",
    async (mode) => {
      const request = await fixture(mode)
      await wasm.runtime.runPythonAsync(`
_original_signed_distance = trimesh.proximity.signed_distance
_queried_samples = 0
_queried_outside = False
def _record_signed_distance(mesh, points):
    global _queried_samples, _queried_outside
    _queried_samples += len(points)
    _queried_outside |= bool(np.any((points < mesh.bounds[0]) | (points > mesh.bounds[1])))
    return _original_signed_distance(mesh, points)
trimesh.proximity.signed_distance = _record_signed_distance
`)
      let prepared: Awaited<ReturnType<typeof wasm.prepare>>
      try {
        prepared = await wasm.prepare(request)
      } finally {
        await wasm.runtime.runPythonAsync(
          "trimesh.proximity.signed_distance = _original_signed_distance",
        )
      }
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
      const queried = JSON.parse(
        String(
          await wasm.runtime.runPythonAsync(
            "json.dumps({'count': _queried_samples, 'outside': _queried_outside})",
          ),
        ),
      )
      expect(queried).toEqual({ count: 27_489, outside: false })
      const reference = JSON.parse(
        String(
          await wasm.runtime.runPythonAsync(`
_context = _QUICK_CONTEXT
_r = _context['resolution']
_z, _y, _x = np.indices((_r,)*3, dtype=np.float64)-3
_points = np.column_stack((_x.ravel(), _y.ravel(), _z.ravel()))
_exact = _distances(_context, _points)
_reference_context = dict(_context)
_reference_context['distance'] = _exact
_reference_context['envelope'] = _exact - (_context['distance'] - _context['envelope'])
json.dumps({'resolution': _r, 'envelope': _reference_context['envelope'].tolist(), 'lattice': _context['lattice'].tolist(), 'sourceVolumeCells': _context['source'].volume, 'thresholdMin': _context['thresholdMin'], 'thresholdMax': _context['thresholdMax']})
`),
        ),
      )
      const optimized = await generateValidatedQuickLightweighting(request, prepared.grid, finish)
      await wasm.runtime.runPythonAsync("_QUICK_CONTEXT = _reference_context")
      const exact = await generateValidatedQuickLightweighting(request, reference, finish)
      if (!optimized.ok) throw new Error(JSON.stringify(optimized.error))
      if (!exact.ok) throw new Error(JSON.stringify(exact.error))
      expect(optimized.result.resultVolumeMm3).toBeCloseTo(exact.result.resultVolumeMm3, 9)
      expect(optimized.result.removedPercent).toBeCloseTo(exact.result.removedPercent, 9)
      expect(volume(optimized.result.mesh)).toBeCloseTo(optimized.result.resultVolumeMm3, 7)
      if (mode === "preserve-exterior") {
        expect(optimized.result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
          request.mesh.vertices,
        )
        expect(optimized.result.mesh.indices.slice(0, request.mesh.indices.length)).toEqual(
          request.mesh.indices,
        )
      }
      const outsideDistance = await wasm.runtime.runPythonAsync(
        "float(_distances(_QUICK_CONTEXT, np.array([[58., 16., 8.]]))[0])",
      )
      expect(outsideDistance).toBeCloseTo(-10, 9)
    },
    timeout,
  )
})
