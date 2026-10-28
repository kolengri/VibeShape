import { expect, it } from "bun:test"
import { parseGeometryImport } from "@vibeshape/formats/import"
import { denseBoxMesh } from "../tests/dense-box-fixture"
import { type StructuralOptimizationInput, structuralOptimizationInputSchema } from "./contract"
import { compactStructuralSourceMesh, encodeStructuralSnapshot, encodeStructuralStl } from "./mesh"

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

it("accepts and compacts a dense face-local source without changing surface IDs or triangle density", () => {
  const mesh = denseBoxMesh({ faceLocal: true })
  const original = structuredClone(mesh)
  const request = sourceInput(mesh)
  expect(mesh.vertices.length / 3).toBe(63_504)
  expect(structuralOptimizationInputSchema.safeParse(request).success).toBe(true)
  const compacted = compactStructuralSourceMesh(mesh)
  const parsed = structuralOptimizationInputSchema.parse({ ...request, mesh: compacted })
  expect(compacted.vertices.length / 3).toBe(10_586)
  expect(compacted.indices.length / 3).toBe(21_168)
  expect(
    compacted.indices.flatMap((index) => compacted.vertices.slice(index * 3, index * 3 + 3)),
  ).toEqual(original.vertices)
  expect(parsed.supports).toEqual(request.supports)
  expect(parsed.loadCases).toEqual(request.loadCases)
  expect(parsed.preserveRegions).toEqual(request.preserveRegions)
  expect(mesh).toEqual(original)
})

it("accepts a valid closed source with more than ten thousand distinct vertices", () => {
  const mesh = denseBoxMesh()
  const compacted = compactStructuralSourceMesh(mesh)
  expect(compacted.vertices.length / 3).toBe(10_586)
  expect(structuralOptimizationInputSchema.safeParse(sourceInput(compacted)).success).toBe(true)
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

it.each(["index", "coordinate", "vertex-triple", "triangle-triple"])(
  "preserves invalid %s input for strict rejection before compaction",
  (kind) => {
    const mesh = box()
    if (kind === "index") mesh.indices[0] = 8
    if (kind === "coordinate") mesh.vertices[0] = Number.POSITIVE_INFINITY
    if (kind === "vertex-triple") mesh.vertices.pop()
    if (kind === "triangle-triple") mesh.indices.pop()
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

it("retains STL when its existing coordinate and volume checks pass", () => {
  const snapshot = encodeStructuralSnapshot(box(), 1)
  expect(snapshot.format).toBe("stl")
  expect(snapshot.mediaType).toBe("model/stl")
  expect(snapshot.bytes).toEqual(encodeStructuralStl(box(), 1))
})

it.each([
  [132.8, 0.8],
  [10_000, 0.01],
])(
  "preserves exact analyzed coordinates through 3MF at offset %s and cell size %s",
  async (offset, cellSize) => {
    const mesh = box(offset, cellSize)
    const before = structuredClone(mesh)
    expect(() => encodeStructuralStl(mesh, cellSize)).toThrow(
      expect.objectContaining({ code: "serialization-precision" }),
    )
    const snapshot = encodeStructuralSnapshot(mesh, cellSize)
    expect(snapshot.format).toBe("3mf")
    expect(snapshot.mediaType).toBe("model/3mf")
    const imported = await parseGeometryImport({ format: "3mf", bytes: snapshot.bytes })
    if (!imported.ok) throw new Error(imported.diagnostic.message)
    if (imported.geometry.kind !== "triangle-mesh") throw new Error("Expected triangle geometry.")
    expect(imported.geometry.meshes[0]?.vertices.flat()).toEqual(mesh.vertices)
    expect(imported.geometry.meshes[0]?.triangles.flat()).toEqual(mesh.indices)
    expect(mesh).toEqual(before)
  },
)

it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
  "does not hide an invalid resolution %s behind the 3MF fallback",
  (cellSize) => {
    expect(() => encodeStructuralSnapshot(box(10_000, 0.01), cellSize)).toThrow(
      expect.objectContaining({ code: "serialization-precision" }),
    )
  },
)

it("validates the exact fallback mesh instead of publishing malformed geometry", () => {
  const mesh = box(10_000, 0.01)
  mesh.indices.splice(0, 3)
  expect(() => encodeStructuralSnapshot(mesh, 0.01)).toThrow()
})
