/** Signed tetrahedral volume with a local origin to avoid world-coordinate cancellation. */
export function signedMeshVolume(mesh: {
  vertices: readonly number[]
  indices: readonly number[]
}): number {
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
  return volume
}
