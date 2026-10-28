import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { threeMfModelMeshSchema } from "@vibeshape/formats/three-mf"
import { signedMeshVolume } from "./mesh-volume"
import { quickLightweightingMeshSchema } from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"

type Mesh = { vertices: number[]; indices: number[] }

function snapshotTopology(mesh: Mesh, cellSizeMm: number) {
  const ids = new Map<string, number>()
  const vertices: [number, number, number][] = []
  const welded: number[] = []
  const origin = mesh.vertices.slice(0, 3)
  for (let offset = 0; offset < mesh.vertices.length; offset += 3) {
    const point = mesh.vertices.slice(offset, offset + 3)
    const key = point.join(":")
    let id = ids.get(key)
    if (id === undefined) {
      id = vertices.length
      ids.set(key, id)
      // Work in detail cells so the existing geometric epsilon is independent
      // of world origin and physical model scale. Welding itself remains exact.
      vertices.push(
        point.map((value, axis) => (value - (origin[axis] ?? 0)) / cellSizeMm) as [
          number,
          number,
          number,
        ],
      )
    }
    welded.push(id)
  }
  const triangles: [number, number, number][] = []
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    triangles.push(
      mesh.indices.slice(offset, offset + 3).map((index) => welded[index] as number) as [
        number,
        number,
        number,
      ],
    )
  }
  return { vertices, triangles }
}

/** Signed tetrahedral volume; translating to the first vertex avoids large-origin cancellation. */
export function signedQuickMeshVolume(mesh: Mesh): number {
  const volume = signedMeshVolume(mesh)
  if (!Number.isFinite(volume))
    throw new QuickLightweightingError("invalid-result", "The generated mesh volume is not finite.")
  return volume
}

/** Validate the actual STL geometry before either analysis delivery or snapshot encoding. */
export function validateQuickLightweightingSnapshot(input: unknown, cellSizeMm: number): Mesh {
  const mesh = quickLightweightingMeshSchema.parse(input)
  if (!Number.isFinite(cellSizeMm) || cellSizeMm <= 0)
    throw new QuickLightweightingError(
      "serialization-precision",
      "A finite positive detail cell size is required for STL export.",
    )
  const logical = threeMfModelMeshSchema.safeParse(snapshotTopology(mesh, cellSizeMm))
  if (!logical.success)
    throw new QuickLightweightingError(
      "invalid-result",
      `The generated material surface is invalid: ${logical.error.issues[0]?.message ?? "Invalid closed surface."}`,
    )
  const rounded = { vertices: mesh.vertices.map(Math.fround), indices: mesh.indices }
  const validated = threeMfModelMeshSchema.safeParse(snapshotTopology(rounded, cellSizeMm))
  if (!validated.success)
    throw new QuickLightweightingError(
      "serialization-precision",
      `STL rounding invalidated the material surface: ${validated.error.issues[0]?.message ?? "Invalid closed surface."}`,
    )
  return rounded
}

export function encodeQuickLightweightingStl(
  input: unknown,
  cellSizeMm: number,
): Uint8Array<ArrayBuffer> {
  const mesh = validateQuickLightweightingSnapshot(input, cellSizeMm)
  return writeStlMeshes([{ vertices: mesh.vertices, triangles: mesh.indices }])
}
