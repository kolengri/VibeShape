import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { Vector3 } from "three"
import { quickLightweightingMeshSchema } from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"

type Mesh = { vertices: number[]; indices: number[] }

function validateRoundedManifold(mesh: Mesh) {
  const ids = new Map<string, number>()
  const welded: number[] = []
  for (let offset = 0; offset < mesh.vertices.length; offset += 3) {
    const key = mesh.vertices.slice(offset, offset + 3).join(":")
    const id = ids.get(key) ?? ids.size
    ids.set(key, id)
    welded.push(id)
  }
  const edges = new Map<string, { count: number; balance: number }>()
  const record = (from: number | undefined, to: number | undefined) => {
    if (from === undefined || to === undefined || from === to)
      throw new QuickLightweightingError(
        "serialization-precision",
        "STL rounding collapsed a mesh edge.",
      )
    const key = from < to ? `${from}:${to}` : `${to}:${from}`
    const edge = edges.get(key) ?? { count: 0, balance: 0 }
    edge.count++
    edge.balance += from < to ? 1 : -1
    edges.set(key, edge)
  }
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.slice(offset, offset + 3)
    const points = triangle.map((index) => new Vector3().fromArray(mesh.vertices, index * 3))
    const [a, b, c] = points
    if (!a || !b || !c || new Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq() === 0)
      throw new QuickLightweightingError(
        "serialization-precision",
        "STL rounding collapsed a mesh triangle.",
      )
    const [first, second, third] = triangle.map((index) => welded[index])
    record(first, second)
    record(second, third)
    record(third, first)
  }
  if ([...edges.values()].some(({ count, balance }) => count !== 2 || balance !== 0))
    throw new QuickLightweightingError(
      "invalid-result",
      "The serialized mesh is not a closed oriented manifold.",
    )
}

/** Signed tetrahedral volume; translating to the first vertex avoids large-origin cancellation. */
export function signedQuickMeshVolume(mesh: Mesh): number {
  const origin = mesh.vertices.slice(0, 3)
  const point = (vertex: number | undefined): [number, number, number] => {
    const offset = (vertex ?? Number.NaN) * 3
    const coordinate = (axis: number) =>
      (mesh.vertices[offset + axis] ?? Number.NaN) - (origin[axis] ?? Number.NaN)
    return [coordinate(0), coordinate(1), coordinate(2)]
  }
  let volume = 0
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [ax, ay, az] = point(mesh.indices[index])
    const [bx, by, bz] = point(mesh.indices[index + 1])
    const [cx, cy, cz] = point(mesh.indices[index + 2])
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  if (!Number.isFinite(volume))
    throw new QuickLightweightingError("invalid-result", "The generated mesh volume is not finite.")
  return volume
}

export function encodeQuickLightweightingStl(
  input: unknown,
  cellSizeMm: number,
): Uint8Array<ArrayBuffer> {
  const mesh = quickLightweightingMeshSchema.parse(input)
  if (!Number.isFinite(cellSizeMm) || cellSizeMm <= 0)
    throw new QuickLightweightingError(
      "serialization-precision",
      "A finite positive detail cell size is required for STL export.",
    )
  const vertices = mesh.vertices.map((coordinate) => {
    const rounded = Math.fround(coordinate)
    if (Math.abs(rounded - coordinate) > 1e-5 * cellSizeMm)
      throw new QuickLightweightingError(
        "serialization-precision",
        "STL rounding exceeds one hundred-thousandth of a detail cell. Move the source closer to the origin or increase the detail cell size.",
      )
    return rounded
  })
  validateRoundedManifold({ vertices, indices: mesh.indices })
  return writeStlMeshes([{ vertices, triangles: mesh.indices }])
}
