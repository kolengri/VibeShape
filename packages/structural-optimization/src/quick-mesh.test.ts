import { expect, it } from "bun:test"
import { encodeQuickLightweightingStl, signedQuickMeshVolume } from "./quick-mesh"

function tetrahedron(origin: number, scale = 1) {
  return {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1].map((value) => origin + value * scale),
    indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
  }
}

it("serializes representable translated geometry without an arbitrary detail-relative rounding cutoff", () => {
  const mesh = tetrahedron(140 + 2 ** -17)
  expect(
    Math.max(...mesh.vertices.map((value) => Math.abs(Math.fround(value) - value))),
  ).toBeGreaterThan(0.5e-5)
  const bytes = encodeQuickLightweightingStl(mesh, 0.5)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(80, true)).toBe(4)
  expect(view.getFloat32(96, true)).toBe(Math.fround(mesh.vertices[0] ?? 0))
})

it("still rejects STL rounding that collapses actual geometry", () => {
  expect(() => encodeQuickLightweightingStl(tetrahedron(99_999, 0.001), 0.0001)).toThrow(
    /STL rounding/,
  )
})

it("still rejects a serialized surface with unbalanced face connectivity", () => {
  const mesh = tetrahedron(140.1234567)
  mesh.indices.splice(9, 3, ...mesh.indices.slice(0, 3))
  expect(() => encodeQuickLightweightingStl(mesh, 0.5)).toThrow(/shared by exactly two triangles/)
})

it("rejects a noncollapsed closed shell whose signed volume reverses in float32", () => {
  const vertices = [
    25.891325250267982, 26.394007205963135, 26.086774595081806, 25.724759802222252,
    26.046637073159218, 25.807555451989174, 26.47634046524763, 25.84394610673189,
    25.625500351190567, 26.206970795989037, 26.29716120660305, 26.490000940859318,
  ].map((value) => 99_999 + value / 512)
  const mesh = { vertices, indices: tetrahedron(0).indices }
  expect(() => encodeQuickLightweightingStl(mesh, 1 / 512)).toThrow(/STL rounding/)
  const outer = tetrahedron(99_999)
  const nested = {
    vertices: [...outer.vertices, ...vertices],
    indices: [
      ...outer.indices,
      ...mesh.indices.map(
        (_, index) => (mesh.indices[Math.floor(index / 3) * 3 + 2 - (index % 3)] ?? 0) + 4,
      ),
    ],
  }
  expect(signedQuickMeshVolume(nested)).toBeGreaterThan(0)
  expect(
    signedQuickMeshVolume({ ...nested, vertices: nested.vertices.map(Math.fround) }),
  ).toBeGreaterThan(0)
  expect(() => encodeQuickLightweightingStl(nested, 1 / 512)).toThrow(/STL rounding/)
})
