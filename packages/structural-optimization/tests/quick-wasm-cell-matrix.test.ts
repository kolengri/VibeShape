import { afterAll, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { quickGridSchema } from "../src/quick-isosurface"
import { encodeQuickLightweightingStl } from "../src/quick-mesh"
import { createQuickWasmHarness, input, root, timeout, volume } from "./quick-wasm-helpers"

const wasm = createQuickWasmHarness()
const { run } = wasm
const cellMatrixReceipts: unknown[] = []
afterAll(() => {
  writeFileSync(
    resolve(root, ".artifacts/quick-lightweighting-cell-matrix.json"),
    JSON.stringify(cellMatrixReceipts, null, 2),
  )
})

describe("load-free TPMS nodal geometry in the pinned WASM runtime", () => {
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
})
