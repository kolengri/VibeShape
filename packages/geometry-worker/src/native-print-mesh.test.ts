import { describe, expect, it } from "bun:test"
import type { ShapeMesh } from "replicad"
import { removeCollapsedNativePrintTriangles } from "./native-print-mesh"

function mesh(vertices: number[], triangles = [0, 1, 2]): ShapeMesh {
  return {
    vertices,
    triangles,
    normals: vertices.map(() => 0),
    faceGroups: [{ start: 0, count: triangles.length, faceId: 17 }],
  }
}

describe("native print pole/seam preparation", () => {
  it("removes only finite coincident-endpoint triangles, retaining winding, coordinates, normals, and face identity", () => {
    const source = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0], [0, 1, 2, 0, 1, 3, 2, 1, 0, 3, 3, 0])
    source.faceGroups = [
      { start: 0, count: 6, faceId: 17 },
      { start: 6, count: 3, faceId: 42 },
      { start: 9, count: 3, faceId: 91 },
    ]
    const before = structuredClone(source)
    const prepared = removeCollapsedNativePrintTriangles(source)
    expect(prepared.triangles).toEqual([0, 1, 2, 2, 1, 0])
    expect(prepared.faceGroups).toEqual([
      { start: 0, count: 3, faceId: 17 },
      { start: 3, count: 3, faceId: 42 },
      { start: 6, count: 0, faceId: 91 },
    ])
    expect(prepared.vertices).toBe(source.vertices)
    expect(prepared.normals).toBe(source.normals)
    expect(source).toEqual(before)
    expect(removeCollapsedNativePrintTriangles(prepared)).toBe(prepared)
  })

  it.each(
    [
      [0, 0, 0, 1e-30, 0, 0, 0, 1e-30, 0],
      [0, 0, 0, 4e-8, 0, 0, 0, 4e-8, 0],
      [0, 0, 0, 1, 0, 0, 2, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    ].map((vertices) => ({ vertices })),
  )("retains distinct coordinates without an area or welding epsilon %#", ({ vertices }) => {
    const source = mesh(vertices)
    expect(removeCollapsedNativePrintTriangles(source)).toBe(source)
  })

  it("does not sanitize non-finite coordinates or missing vertices into apparently valid input", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const source = mesh([value, 0, 0, value, 0, 0, 0, 1, 0])
      expect(removeCollapsedNativePrintTriangles(source)).toBe(source)
    }
    const missing = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [99, 99, 99])
    expect(removeCollapsedNativePrintTriangles(missing)).toBe(missing)
  })

  it("handles empty and entirely collapsed native faces without mutating the source", () => {
    const empty = mesh([], [])
    expect(removeCollapsedNativePrintTriangles(empty)).toBe(empty)
    const collapsed = mesh([0, -0, 0, -0, 0, 0, 1, 0, 0])
    const result = removeCollapsedNativePrintTriangles(collapsed)
    expect(result.triangles).toEqual([])
    expect(result.faceGroups).toEqual([{ start: 0, count: 0, faceId: 17 }])
    expect(collapsed.triangles).toEqual([0, 1, 2])
  })
})
