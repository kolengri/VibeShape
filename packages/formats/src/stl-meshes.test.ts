import { describe, expect, it } from "bun:test"
import { parseGeometryImport } from "./import"
import { writeStlMeshes } from "./stl-meshes"

describe("world-space triangle-mesh STL export", () => {
  it("preserves selected mesh count, coordinates and winding in a binary file", async () => {
    const first = { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] }
    const second = { vertices: [10, 0, 0, 10, 1, 0, 11, 0, 0], triangles: [0, 1, 2] }
    const bytes = writeStlMeshes([first, second])
    expect(bytes.length).toBe(184)
    expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(2)
    const result = await parseGeometryImport({ format: "stl", bytes, units: "mm" })
    if (!result.ok || result.geometry.kind !== "triangle-mesh")
      throw new Error("Missing exported STL")
    expect(result.geometry.meshes[0]?.triangles).toHaveLength(2)
    expect(result.geometry.meshes[0]?.vertices).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [10, 0, 0],
      [10, 1, 0],
      [11, 0, 0],
    ])
  })
  it("serializes more than 250,000 triangles without truncating its UInt32 count", () => {
    const triangleCount = 250_001
    const bytes = writeStlMeshes([
      {
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        triangles: Array.from({ length: triangleCount * 3 }, (_, index) => index % 3),
      },
    ])
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(80, true)).toBe(triangleCount)
    expect(bytes.byteLength).toBe(84 + 50 * triangleCount)
    expect(view.getFloat32(84 + 50 * (triangleCount - 1) + 24, true)).toBe(1)
  })
  it("rejects incomplete, out-of-bounds and missing-vertex triangle data", () => {
    for (const mesh of [
      { vertices: [0, 0, 0], triangles: [0, 1, 2] },
      { vertices: [0, 0, 0, 100001, 0, 0, 0, 1, 0], triangles: [0, 1, 2] },
      { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 3] },
    ])
      expect(() => writeStlMeshes([mesh])).toThrow()
  })
})
