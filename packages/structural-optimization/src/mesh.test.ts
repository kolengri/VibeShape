import { expect, it } from "bun:test"
import { type StructuralOptimizationInput, structuralOptimizationInputSchema } from "./contract"
import { compactStructuralSourceMesh, encodeStructuralStl } from "./mesh"

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

function sourceInput(mesh: ReturnType<typeof box>): StructuralOptimizationInput {
  return {
    schemaVersion: 1,
    mesh,
    material: { youngModulusMpa: 1000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1000 },
    safetyFactor: 2,
    maxDisplacementMm: 1,
    cellSizeMm: 1,
    supports: [{ kind: "surface", triangleIndices: [0], depthMm: 1 }],
    loadCases: [
      {
        name: "axial",
        region: { kind: "surface", triangleIndices: [1], depthMm: 1 },
        forceN: [10, 0, 0],
      },
    ],
    preserveRegions: [{ kind: "surface", triangleIndices: [2], depthMm: 1 }],
    maxIterations: 0,
  }
}

function faceLocalBox() {
  const source = box()
  const vertices: number[] = []
  const subdivisions = 17
  for (let triangle = 0; triangle < source.indices.length; triangle += 3) {
    const [a, b, c] = source.indices
      .slice(triangle, triangle + 3)
      .map((index) => source.vertices.slice(index * 3, index * 3 + 3))
    if (!a || !b || !c) throw new Error("Expected a complete source triangle.")
    const point = (i: number, j: number) =>
      a.map(
        (value, axis) =>
          value + (((b[axis] ?? 0) - value) * i + ((c[axis] ?? 0) - value) * j) / subdivisions,
      )
    for (let i = 0; i < subdivisions; i++)
      for (let j = 0; i + j < subdivisions; j++) {
        vertices.push(...point(i, j), ...point(i + 1, j), ...point(i, j + 1))
        if (i + j < subdivisions - 1)
          vertices.push(...point(i + 1, j), ...point(i + 1, j + 1), ...point(i, j + 1))
      }
  }
  return { vertices, indices: Array.from({ length: vertices.length / 3 }, (_, index) => index) }
}

it("fits an unchanged face-local source within the analysis budget without changing surface IDs", () => {
  const mesh = faceLocalBox()
  const original = structuredClone(mesh)
  const request = sourceInput(mesh)
  expect(mesh.vertices.length / 3).toBe(10_404)
  expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(false)
  const compacted = compactStructuralSourceMesh(mesh)
  const parsed = structuralOptimizationInputSchema.parse({ ...request, mesh: compacted })
  expect(compacted.vertices.length / 3).toBeLessThan(10_000)
  expect(compacted.indices.length).toBe(10_404)
  expect(
    compacted.indices.flatMap((index) => compacted.vertices.slice(index * 3, index * 3 + 3)),
  ).toEqual(original.vertices)
  expect(parsed.supports).toEqual(request.supports)
  expect(parsed.loadCases).toEqual(request.loadCases)
  expect(parsed.preserveRegions).toEqual(request.preserveRegions)
  expect(mesh).toEqual(original)
})

it("keeps truly distinct source vertices subject to the analysis budget", () => {
  const mesh = {
    vertices: Array.from({ length: 30_003 }, (_, index) => index / 3),
    indices: Array.from({ length: 10_002 }, (_, index) => index % 10_001),
  }
  const compacted = compactStructuralSourceMesh(mesh)
  expect(compacted.vertices.length / 3).toBe(10_001)
  expect(structuralOptimizationInputSchema.safeParse(sourceInput(compacted)).success).toBe(false)
})

it("removes unreferenced vertices and normalizes only exactly equal zero coordinates", () => {
  const mesh = box()
  mesh.vertices.push(-0, 0, 0, 0, 0, 0, 1e-12, 0, 0, 99, 99, 99)
  mesh.indices.push(8, 9, 10)
  const compacted = compactStructuralSourceMesh(mesh)
  const last = compacted.indices.slice(-3)
  expect(last[0]).toBe(last[1])
  expect(last[2]).not.toBe(last[0])
  expect(compacted.vertices.length / 3).toBe(10)
  expect(compacted.vertices.some((coordinate) => Object.is(coordinate, -0))).toBe(false)
})

it.each(["index", "coordinate", "raw-vertices", "triangles"])(
  "preserves invalid %s input for strict rejection before compaction",
  (kind) => {
    const mesh = box()
    if (kind === "index") mesh.indices[0] = 8
    if (kind === "coordinate") mesh.vertices[0] = Number.POSITIVE_INFINITY
    if (kind === "raw-vertices") mesh.vertices = Array(60_003).fill(0)
    if (kind === "triangles") mesh.indices = Array(60_003).fill(0)
    const compacted = compactStructuralSourceMesh(mesh)
    expect(compacted).toBe(mesh)
    expect(structuralOptimizationInputSchema.safeParse(sourceInput(compacted)).success).toBe(false)
  },
)

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
