import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { writeThreeMfMeshes } from "@vibeshape/formats/three-mf-meshes"
import { type StructuralMesh, structuralMeshSchema } from "./contract"
import { StructuralOptimizationError } from "./errors"

/** Removes display seams without changing captured triangle positions, order, or winding. */
export function compactStructuralSourceMesh(input: StructuralMesh): StructuralMesh {
  if (!structuralMeshSchema.safeParse(input).success) return input
  const vertices: number[] = []
  const indices: number[] = []
  const compactedBySource = new Map<number, number>()
  const compactedByPosition = new Map<string, number>()
  for (const sourceIndex of input.indices) {
    let compactedIndex = compactedBySource.get(sourceIndex)
    if (compactedIndex === undefined) {
      const offset = sourceIndex * 3
      const point = input.vertices
        .slice(offset, offset + 3)
        .map((value) => (value === 0 ? 0 : value))
      const key = point.join(":")
      compactedIndex = compactedByPosition.get(key)
      if (compactedIndex === undefined) {
        compactedIndex = vertices.length / 3
        compactedByPosition.set(key, compactedIndex)
        vertices.push(...point)
      }
      compactedBySource.set(sourceIndex, compactedIndex)
    }
    indices.push(compactedIndex)
  }
  return { vertices, indices }
}

export function encodeStructuralStl(input: unknown, cellSizeMm: number): Uint8Array<ArrayBuffer> {
  const mesh = structuralMeshSchema.parse(input)
  const rounded = mesh.vertices.map(Math.fround)
  if (
    !Number.isFinite(cellSizeMm) ||
    cellSizeMm < 0.01 ||
    rounded.some(
      (value, index) => Math.abs(value - (mesh.vertices[index] ?? Number.NaN)) > cellSizeMm * 1e-6,
    )
  )
    throw new StructuralOptimizationError(
      "serialization-precision",
      "STL rounding exceeds one millionth of the analysis cell size. Move the source closer to the origin or use coarser cells.",
    )
  // Validate the float32 coordinates actually captured in STL, not only solver doubles.
  writeThreeMfMeshes({
    title: "Lightweighting result",
    meshes: [{ vertices: rounded, triangles: mesh.indices }],
  })
  return writeStlMeshes([{ vertices: rounded, triangles: mesh.indices }])
}
