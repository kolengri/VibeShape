import { expect, it } from "bun:test"
import { encodeStructuralStl } from "./mesh"

function box(offset = 0, scale = 1) {
  return {
    vertices: [
      -5, -1, -1, -5, -1, 1, -5, 1, -1, -5, 1, 1, 5, -1, -1, 5, -1, 1, 5, 1, -1, 5, 1, 1,
    ].map((value, index) => value * scale + (index % 3 === 0 ? offset : 0)),
    indices: [
      1, 3, 0, 4, 1, 0, 0, 3, 2, 2, 4, 0, 1, 7, 3, 5, 1, 4, 5, 7, 1, 3, 7, 2, 6, 4, 2, 2, 7, 6, 6,
      5, 4, 7, 5, 6,
    ],
  }
}
it("captures validated float32 coordinates with bounded cell-relative rounding", () => {
  const mesh = box(0, 0.1)
  const bytes = encodeStructuralStl(mesh, 0.1)
  const view = new DataView(bytes.buffer)
  for (let corner = 0; corner < 3; corner++) {
    const vertex = mesh.indices[corner]
    if (vertex === undefined) throw new Error("Missing fixture vertex.")
    for (let axis = 0; axis < 3; axis++)
      expect(view.getFloat32(84 + 12 + corner * 12 + axis * 4, true)).toBe(
        Math.fround(mesh.vertices[vertex * 3 + axis] ?? Number.NaN),
      )
  }
})
it("rejects otherwise manifold cells whose STL quantization materially changes the analyzed geometry", () => {
  expect(() => encodeStructuralStl(box(10000, 0.01), 0.01)).toThrow(
    expect.objectContaining({ code: "serialization-precision" }),
  )
})
it("rejects an unknown cell resolution instead of inventing a serialization tolerance", () => {
  expect(() => encodeStructuralStl(box(), Number.NaN)).toThrow(
    expect.objectContaining({ code: "serialization-precision" }),
  )
})
