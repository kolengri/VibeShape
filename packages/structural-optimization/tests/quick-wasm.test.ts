import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPyodide, type PyodideInterface } from "pyodide"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { StructuralMesh } from "../src/contract"
import {
  type QuickLightweightingInput,
  type QuickLightweightingProgress,
  quickLightweightingInputSchema,
  quickLightweightingResponseSchema,
} from "../src/quick-contract"
import { generateValidatedQuickLightweighting } from "../src/quick-generation"
import { quickGridSchema } from "../src/quick-isosurface"
import { encodeQuickLightweightingStl } from "../src/quick-mesh"

const timeout = 120_000
// Shared CI runs can take nearly two minutes; this checks batching, not speed.
const denseSourceTimeout = 180_000
const root = fileURLToPath(new URL("../../../", import.meta.url))
let runtime: PyodideInterface
const matrixReceipts: unknown[] = []
const cellMatrixReceipts: unknown[] = []
const occtMatrixReceipts: unknown[] = []

function source(): StructuralMesh {
  return {
    vertices: [0, 0, 0, 0, 0, 10, 0, 10, 0, 0, 10, 10, 10, 0, 0, 10, 0, 10, 10, 10, 0, 10, 10, 10],
    indices: [
      0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1,
      5, 7, 1, 7, 3,
    ],
  }
}

function occtCube(): StructuralMesh {
  return {
    vertices: [
      -5, -5, 0, -5, -5, 10, -5, 5, 0, -5, 5, 10, 5, -5, 0, 5, -5, 10, 5, 5, 0, 5, 5, 10, -5, -5, 0,
      5, -5, 0, -5, -5, 10, 5, -5, 10, -5, 5, 0, 5, 5, 0, -5, 5, 10, 5, 5, 10, -5, -5, 0, -5, 5, 0,
      5, -5, 0, 5, 5, 0, -5, -5, 10, -5, 5, 10, 5, -5, 10, 5, 5, 10,
    ],
    indices: [
      0, 1, 2, 2, 1, 3, 5, 4, 6, 5, 6, 7, 9, 11, 8, 8, 11, 10, 15, 13, 12, 15, 12, 14, 17, 19, 16,
      16, 19, 18, 23, 21, 20, 23, 20, 22,
    ],
  }
}

function input(
  mode: QuickLightweightingInput["mode"] = "preserve-exterior",
): QuickLightweightingInput {
  return {
    schemaVersion: 1,
    mesh: source(),
    mode,
    removalPercent: 50,
    cellSizeMm: 0.25,
    skinThicknessMm: mode === "preserve-exterior" ? 0.5 : 0,
  }
}

function volume(mesh: StructuralMesh) {
  let result = 0
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const points = mesh.indices
      .slice(face, face + 3)
      .map((index) => mesh.vertices.slice(index * 3, index * 3 + 3))
    const [a, b, c] = points
    if (!a || !b || !c) throw new Error("Missing triangle.")
    const [ax = 0, ay = 0, az = 0] = a
    const [bx = 0, by = 0, bz = 0] = b
    const [cx = 0, cy = 0, cz = 0] = c
    result += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return result
}

async function run(request: QuickLightweightingInput, inspectGrid?: (grid: unknown) => void) {
  runtime.globals.set("_quick_request_json", JSON.stringify(request))
  const raw: unknown = await runtime.runPythonAsync("prepare_quick_json(_quick_request_json)")
  if (typeof raw !== "string") throw new Error("Preparation must return JSON.")
  const prepared: { ok: boolean; grid?: unknown; error?: { code: string; message: string } } =
    JSON.parse(raw)
  if (!prepared.ok) return quickLightweightingResponseSchema.parse(prepared)
  inspectGrid?.(prepared.grid)
  return generateValidatedQuickLightweighting(request, prepared.grid, async (candidate) => {
    runtime.globals.set("_quick_candidate_json", JSON.stringify(candidate))
    const result: unknown = await runtime.runPythonAsync("finish_quick_json(_quick_candidate_json)")
    if (typeof result !== "string") throw new Error("Generation must return JSON.")
    return quickLightweightingResponseSchema.parse(JSON.parse(result))
  })
}

function expectCompletedBatches(progress: QuickLightweightingProgress[], maximumStep: number) {
  for (const phase of ["sampling", "validation"] as const) {
    const updates = progress.filter((update) => update.phase === phase)
    expect(updates.length).toBeGreaterThan(1)
    expect(updates[0]?.completed).toBe(0)
    const last = updates.at(-1)
    expect(last?.completed).toBe(last?.total)
    const steps = updates.map((update, index) =>
      update.completed === 0 ? 0 : update.completed - (updates[index - 1]?.completed ?? 0),
    )
    expect(Math.max(...steps)).toBeLessThanOrEqual(maximumStep)
  }
}

beforeAll(async () => {
  execFileSync("bun", ["run", "scripts/prepare-structural-runtime.ts"], {
    cwd: root,
    timeout,
    stdio: "pipe",
  })
  const directory = resolve(root, ".artifacts/structural-runtime")
  runtime = await loadPyodide({ indexURL: `${directory}/`, packages: ["numpy", "scipy"] })
  await runtime.loadPackage(resolve(directory, "trimesh-4.12.2-py3-none-any.whl"))
  await runtime.runPythonAsync(
    readFileSync(resolve(root, "packages/structural-optimization/src/quick-solver.py"), "utf8"),
  )
}, timeout)

afterAll(() => {
  writeFileSync(
    resolve(root, ".artifacts/quick-lightweighting-matrix.json"),
    JSON.stringify(matrixReceipts, null, 2),
  )
  writeFileSync(
    resolve(root, ".artifacts/quick-lightweighting-cell-matrix.json"),
    JSON.stringify(cellMatrixReceipts, null, 2),
  )
  writeFileSync(
    resolve(root, ".artifacts/quick-lightweighting-occt-matrix.json"),
    JSON.stringify(occtMatrixReceipts, null, 2),
  )
})

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
      const raw = await runtime.runPythonAsync(
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
      const raw = await runtime.runPythonAsync(
        "_fixture = trimesh.creation.icosphere(subdivisions=4, radius=5); json.dumps({'vertices': _fixture.vertices.ravel().tolist(), 'indices': _fixture.faces.ravel().tolist()})",
      )
      const request = quickLightweightingInputSchema.parse({
        ...input(),
        mesh: JSON.parse(String(raw)),
        cellSizeMm: 10 / 32,
        skinThicknessMm: (2.5 * 10) / 32,
      })
      const progress: QuickLightweightingProgress[] = []
      runtime.globals.set(
        "_QUICK_PROGRESS",
        (phase: QuickLightweightingProgress["phase"], completed: number, total: number) => {
          progress.push({ phase, completed, total })
        },
      )
      try {
        const response = await run(request)
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
        expect(response.result.removedPercent).toBeGreaterThan(20)
        expect(volume(response.result.mesh)).toBeCloseTo(response.result.resultVolumeMm3, 6)
        expect(() =>
          encodeQuickLightweightingStl(response.result.mesh, response.result.cellSizeMm),
        ).not.toThrow()
        // 5,120 triangles and both ray directions must fit the 262,144-pair
        // scratch budget independently of total samples or elapsed time.
        expectCompletedBatches(progress, 25)
      } finally {
        await runtime.runPythonAsync("_QUICK_PROGRESS = None")
      }
    },
    denseSourceTimeout,
  )

  it.each(
    (["toleranced-bounds", "mesh-span"] as const).flatMap((samplingSource) =>
      ([2, 2.5] as const).map((skinCells) => ({ samplingSource, skinCells })),
    ),
  )(
    "checks the OCCT duplicated-face cube with $samplingSource and $skinCells skin cells",
    async ({ samplingSource, skinCells }) => {
      const cellSizeMm = samplingSource === "mesh-span" ? 10 / 32 : 0.31250000625
      const request: QuickLightweightingInput = {
        ...input(),
        mesh: occtCube(),
        cellType: "gyroid",
        cellSizeMm,
        latticeCellSizeMm: samplingSource === "mesh-span" ? 1.875 : 1.8750000375,
        skinThicknessMm: skinCells * cellSizeMm,
      }
      const response = await run(request)
      const sourceComponents = await runtime.runPythonAsync(
        "_c = _QUICK_CONTEXT; json.dumps([ndimage.label((_c['distance'] > margin).reshape((_c['resolution'],) * 3))[1] for margin in (0, 1e-6)])",
      )
      occtMatrixReceipts.push({
        samplingSource,
        skinCells,
        cellSizeMm,
        sourceComponents: JSON.parse(String(sourceComponents)),
        ...(response.ok
          ? { actual: response.result.removedPercent }
          : { error: response.error.code }),
      })
      if (samplingSource === "toleranced-bounds") {
        expect(response).toMatchObject({ ok: false, error: { code: "disconnected-mesh" } })
        expect(response).not.toHaveProperty("result")
        return
      }
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      const result = response.result
      expect(result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
        request.mesh.vertices,
      )
      expect(result.mesh.indices.slice(0, request.mesh.indices.length)).toEqual(
        request.mesh.indices,
      )
      expect(result.sourceVolumeMm3).toBeCloseTo(1000, 8)
      expect(volume(result.mesh)).toBeCloseTo(result.resultVolumeMm3, 6)
      expect(result.removedPercent).toBeGreaterThanOrEqual(0.5)
      expect(() => encodeQuickLightweightingStl(result.mesh, result.cellSizeMm)).not.toThrow()
    },
    timeout,
  )

  it(
    "preserves every source triangle and measures inward-wound enclosed void volume",
    async () => {
      const request = input()
      const before = structuredClone(request)
      const response = await run(quickLightweightingInputSchema.parse(request))
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      const result = response.result
      writeFileSync(
        resolve(root, ".artifacts/quick-lightweighting-preserved.json"),
        JSON.stringify(result),
      )
      expect(request).toEqual(before)
      expect(result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
        request.mesh.vertices,
      )
      expect(result.mesh.indices.slice(0, request.mesh.indices.length)).toEqual(
        request.mesh.indices,
      )
      expect(result.mesh.indices.length).toBeGreaterThan(request.mesh.indices.length)
      expect(result.sourceVolumeMm3).toBeCloseTo(1000, 8)
      expect(volume(result.mesh)).toBeCloseTo(result.resultVolumeMm3, 6)
      expect(result.removedPercent).toBeGreaterThan(5)
      expect(result.removedPercent).toBeLessThan(result.requestedRemovalPercent)
      expect(result.warnings.some((warning) => warning.includes("Requested 50%"))).toBe(true)
      for (let index = request.mesh.vertices.length; index < result.mesh.vertices.length; index++) {
        expect(result.mesh.vertices[index]).toBeGreaterThanOrEqual(0.5 - 1e-5)
        expect(result.mesh.vertices[index]).toBeLessThanOrEqual(9.5 + 1e-5)
      }
      expect(() => encodeQuickLightweightingStl(result.mesh, result.cellSizeMm)).not.toThrow()
    },
    timeout,
  )

  it.each(
    (["gyroid", "schwarz-p", "schwarz-d"] as const).flatMap((cellType) =>
      (["preserve-exterior", "open-organic"] as const).flatMap((mode) =>
        ([6, 12] as const).map((samples) => ({ cellType, mode, samples })),
      ),
    ),
  )(
    "validates $cellType $mode geometry with $samples samples per cell",
    async ({ cellType, mode, samples }) => {
      const request = input(mode)
      request.cellSizeMm = 10 / 32
      request.skinThicknessMm = mode === "preserve-exterior" ? 2 * request.cellSizeMm : 0
      request.cellType = cellType
      const defaultSamples = cellType === "schwarz-d" ? 12 : 6
      if (samples !== defaultSamples) request.latticeCellSizeMm = samples * request.cellSizeMm
      const response = await run(request, (rawGrid) => {
        const grid = quickGridSchema.parse(rawGrid)
        for (const [x, y, z] of [
          [0, 0, 0],
          [1, 2, 3],
          [5, 3, 2],
        ] as const) {
          const [a, b, c] = [x, y, z].map(
            (coordinate, axis) =>
              (coordinate * 2 * Math.PI) / samples + ([0.37, 0.73, 1.11][axis] ?? 0),
          )
          if (a === undefined || b === undefined || c === undefined)
            throw new Error("Missing nodal coordinate.")
          const expected =
            cellType === "gyroid"
              ? Math.sin(a) * Math.cos(b) + Math.sin(b) * Math.cos(c) + Math.sin(c) * Math.cos(a)
              : cellType === "schwarz-p"
                ? Math.cos(a) + Math.cos(b) + Math.cos(c)
                : Math.SQRT2 *
                  (Math.sin(a + Math.PI / 4) *
                    Math.sin(b + Math.PI / 4) *
                    Math.sin(c + Math.PI / 4) -
                    Math.cos(a + Math.PI / 4) *
                      Math.cos(b + Math.PI / 4) *
                      Math.cos(c + Math.PI / 4))
          const index = x + 3 + (y + 3) * grid.resolution + (z + 3) * grid.resolution ** 2
          expect(grid.lattice[index]).toBeCloseTo(Math.abs(expected), 12)
        }
      })
      if (cellType === "schwarz-d" && mode === "preserve-exterior" && samples === 6) {
        expect(response).toMatchObject({ ok: false, error: { code: "disconnected-mesh" } })
        cellMatrixReceipts.push({ cellType, mode, samples, error: "disconnected-mesh" })
        return
      }
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      const result = response.result
      expect(result.cellType).toBe(cellType)
      expect(result.latticeCellSizeMm).toBe(samples * request.cellSizeMm)
      expect(volume(result.mesh)).toBeCloseTo(result.resultVolumeMm3, 6)
      expect(result.sourceVolumeMm3).toBeCloseTo(1000, 8)
      expect(result.removedPercent).toBeGreaterThanOrEqual(0.5)
      if (mode === "preserve-exterior") {
        expect(result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
          request.mesh.vertices,
        )
        expect(result.mesh.indices.slice(0, request.mesh.indices.length)).toEqual(
          request.mesh.indices,
        )
      }
      expect(() => encodeQuickLightweightingStl(result.mesh, result.cellSizeMm)).not.toThrow()
      cellMatrixReceipts.push({
        cellType,
        mode,
        samples,
        requested: 50,
        actual: result.removedPercent,
        vertices: result.mesh.vertices.length / 3,
        triangles: result.mesh.indices.length / 3,
      })
    },
    timeout,
  )

  it(
    "produces one closed organic solid inside a concave source with measured triangle volume",
    async () => {
      const request = input("open-organic")
      request.cellSizeMm = 0.3
      const polygon = [
        [0, 0],
        [10, 0],
        [10, 4],
        [4, 4],
        [4, 10],
        [0, 10],
      ]
      const triangles = [
        [0, 1, 3],
        [1, 2, 3],
        [0, 3, 5],
        [3, 4, 5],
      ]
      request.mesh.vertices = [0, 10].flatMap((z) =>
        polygon.flatMap(([x, y]) => [x ?? 0, y ?? 0, z]),
      )
      request.mesh.indices = triangles.flatMap(([a = 0, b = 0, c = 0]) => [
        c,
        b,
        a,
        a + 6,
        b + 6,
        c + 6,
      ])
      for (let a = 0; a < 6; a++) {
        const b = (a + 1) % 6
        request.mesh.indices.push(a, b, b + 6, a, b + 6, a + 6)
      }
      const response = await run(request)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      expect(response.result.sourceVolumeMm3).toBeCloseTo(640, 7)
      expect(volume(response.result.mesh)).toBeCloseTo(response.result.resultVolumeMm3, 6)
      expect(response.result.removedPercent).toBeCloseTo(50, 0)
      for (let index = 0; index < response.result.mesh.vertices.length; index += 3) {
        const x = response.result.mesh.vertices[index] ?? Number.NaN
        const y = response.result.mesh.vertices[index + 1] ?? Number.NaN
        expect(x > 4 && y > 4).toBe(false)
      }
      expect(() =>
        encodeQuickLightweightingStl(response.result.mesh, response.result.cellSizeMm),
      ).not.toThrow()
    },
    timeout,
  )

  it(
    "generates the default organic cube as a bounded closed snapshot",
    async () => {
      const request = input("open-organic")
      request.cellSizeMm = 10 / 32
      const response = await run(request)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      writeFileSync(
        resolve(root, ".artifacts/quick-lightweighting-open.json"),
        JSON.stringify(response.result),
      )
      expect(response.result.removedPercent).toBeCloseTo(50, 0)
      expect(response.result.mesh.vertices.length / 3).toBeLessThanOrEqual(80_000)
      expect(response.result.mesh.indices.length / 3).toBeLessThanOrEqual(140_000)
      expect(() =>
        encodeQuickLightweightingStl(response.result.mesh, response.result.cellSizeMm),
      ).not.toThrow()
    },
    timeout,
  )

  it.each([
    ["preserve-exterior", 5],
    ["preserve-exterior", 50],
    ["preserve-exterior", 80],
    ["open-organic", 5],
    ["open-organic", 50],
    ["open-organic", 80],
  ] as const)(
    "reports actual removal for the default 32-cell cube in %s at %i%%",
    async (mode, removalPercent) => {
      const request = input(mode)
      request.cellSizeMm = 10 / 32
      request.skinThicknessMm = mode === "preserve-exterior" ? 2 * request.cellSizeMm : 0
      request.removalPercent = removalPercent
      const response = await run(request)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      const result = response.result
      if (removalPercent === 50)
        writeFileSync(
          resolve(root, `.artifacts/quick-lightweighting-default-${mode}.json`),
          JSON.stringify(result),
        )
      expect(result.removedPercent).toBeGreaterThanOrEqual(0.5)
      expect(result.removedPercent).toBeLessThan(100)
      // This cube already supports a connected 50% candidate; a higher request
      // must retain that achievable reduction when its thin candidate fails.
      if (mode === "open-organic" && removalPercent === 80)
        expect(result.removedPercent).toBeGreaterThanOrEqual(50)
      expect(volume(result.mesh)).toBeCloseTo(result.resultVolumeMm3, 6)
      if (Math.abs(result.removedPercent - removalPercent) > 2)
        expect(
          result.warnings.some((warning) => warning.includes(`Requested ${removalPercent}%`)),
        ).toBe(true)
      expect(() => encodeQuickLightweightingStl(result.mesh, result.cellSizeMm)).not.toThrow()
      matrixReceipts.push({
        mode,
        requested: removalPercent,
        actual: result.removedPercent,
        vertices: result.mesh.vertices.length / 3,
        triangles: result.mesh.indices.length / 3,
        nodeRssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
      })
    },
    timeout,
  )

  it.each([
    [
      "open source",
      (request: QuickLightweightingInput) => {
        request.mesh.indices.splice(0, 3)
      },
      "invalid-mesh",
    ],
    [
      "overfine grid",
      (request: QuickLightweightingInput) => {
        request.cellSizeMm = 0.01
      },
      "resource-limit",
    ],
    [
      "empty internal space",
      (request: QuickLightweightingInput) => {
        request.skinThicknessMm = 5
      },
      "no-removable-material",
    ],
    [
      "disconnected solids",
      (request: QuickLightweightingInput) => {
        const second = request.mesh.vertices.map(
          (value, index) => value + (index % 3 === 0 ? 12 : 0),
        )
        request.mesh = {
          vertices: [...request.mesh.vertices, ...second],
          indices: [...request.mesh.indices, ...request.mesh.indices.map((index) => index + 8)],
        }
        request.cellSizeMm = 0.5
        request.skinThicknessMm = 1
      },
      "disconnected-mesh",
    ],
  ] as const)(
    "rejects %s without returning a result",
    async (_name, mutate, code) => {
      const request = input()
      mutate(request)
      const response = await run(request)
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Invalid geometry must not be returned.")
      expect(response.error.code).toBe(code)
      expect(response).not.toHaveProperty("result")
    },
    timeout,
  )
})
