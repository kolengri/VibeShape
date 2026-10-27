import { afterAll, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { StructuralMesh } from "../src/contract"
import {
  type QuickLightweightingInput,
  quickLightweightingInputSchema,
} from "../src/quick-contract"
import { encodeQuickLightweightingStl } from "../src/quick-mesh"
import { denseBoxMesh } from "./dense-box-fixture"
import { createQuickWasmHarness, input, root, timeout, volume } from "./quick-wasm-helpers"

const wasm = createQuickWasmHarness()
const { run } = wasm

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

const matrixReceipts: unknown[] = []
const occtMatrixReceipts: unknown[] = []
afterAll(() => {
  writeFileSync(
    resolve(root, ".artifacts/quick-lightweighting-matrix.json"),
    JSON.stringify(matrixReceipts, null, 2),
  )
  writeFileSync(
    resolve(root, ".artifacts/quick-lightweighting-occt-matrix.json"),
    JSON.stringify(occtMatrixReceipts, null, 2),
  )
})

describe("load-free TPMS nodal geometry in the pinned WASM runtime", () => {
  it.each(["preserve-exterior", "open-organic"] as const)(
    "accepts dense captured surfaces in %s without changing sampling resolution",
    async (mode) => {
      const request = quickLightweightingInputSchema.parse({
        ...input(mode),
        mesh: denseBoxMesh({
          subdivisions: 50,
          min: [0, 0, 0],
          max: [10, 10, 10],
          faceLocal: true,
        }),
        removalPercent: 20,
        cellSizeMm: 1,
        skinThicknessMm: mode === "preserve-exterior" ? 2 : 0,
      })
      expect(request.mesh.vertices.length / 3).toBe(90_000)
      expect(request.mesh.indices.length / 3).toBe(30_000)
      const response = await run(request)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      expect(response.result.sourceVolumeMm3).toBeCloseTo(1000, 8)
      expect(response.result.cellSizeMm).toBe(1)
      expect(response.result.removedPercent).toBeGreaterThanOrEqual(0.5)
      expect(volume(response.result.mesh)).toBeCloseTo(response.result.resultVolumeMm3, 6)
      if (mode === "preserve-exterior") {
        expect(response.result.mesh.vertices.length / 3).toBeGreaterThan(80_000)
        expect(response.result.mesh.vertices.slice(0, request.mesh.vertices.length)).toEqual(
          request.mesh.vertices,
        )
        expect(response.result.mesh.indices.slice(0, request.mesh.indices.length)).toEqual(
          request.mesh.indices,
        )
      }
    },
    timeout,
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
      const sourceComponents = await wasm.runtime.runPythonAsync(
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
