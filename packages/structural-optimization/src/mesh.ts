import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { writeThreeMfMeshes } from "@vibeshape/formats/three-mf-meshes"
import { structuralMeshSchema } from "./contract"
import { StructuralOptimizationError } from "./errors"

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
