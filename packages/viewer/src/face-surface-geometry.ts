import { Vector3 } from "three"
import type { ViewerMesh, ViewerVector3 } from "./three-viewport"

type SurfaceGeometry = Readonly<{ center: ViewerVector3; normal: ViewerVector3 | null }>

function vertex(mesh: ViewerMesh, index: number) {
  const offset = index * 3
  if (index < 0 || offset + 2 >= mesh.positions.length) return null
  const value = new Vector3().fromArray(mesh.positions, offset)
  return value.toArray().every(Number.isFinite) ? value : null
}
function triangleGeometry(mesh: ViewerMesh, triangle: number) {
  const a = vertex(mesh, mesh.indices[triangle * 3] ?? -1)
  const b = vertex(mesh, mesh.indices[triangle * 3 + 1] ?? -1)
  const c = vertex(mesh, mesh.indices[triangle * 3 + 2] ?? -1)
  if (!a || !b || !c) return null
  const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
  const area = normal.length()
  if (!Number.isFinite(area) || area === 0) return null
  return {
    normal,
    area,
    center: a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3),
  }
}

/** Area-weighted presentation geometry over disposable IDs in one captured display mesh. */
export function viewerFaceSurfaceGeometry(
  mesh: ViewerMesh,
  faceIds: readonly number[],
): SurfaceGeometry | null {
  if (
    mesh.indices.length % 3 !== 0 ||
    mesh.positions.length % 3 !== 0 ||
    mesh.triangleFaceIds.length !== mesh.indices.length / 3
  )
    return null
  const selected = new Set(faceIds)
  const center = new Vector3()
  const normal = new Vector3()
  let area = 0
  for (let triangle = 0; triangle < mesh.triangleFaceIds.length; triangle += 1) {
    if (!selected.has(mesh.triangleFaceIds[triangle] ?? -1)) continue
    const geometry = triangleGeometry(mesh, triangle)
    if (!geometry) return null
    center.addScaledVector(geometry.center, geometry.area)
    normal.add(geometry.normal)
    area += geometry.area
  }
  if (!Number.isFinite(area) || area === 0) return null
  const normalLength = normal.length()
  return {
    center: center.multiplyScalar(1 / area).toArray(),
    normal:
      normalLength <= area * Number.EPSILON * 32
        ? null
        : normal.multiplyScalar(1 / normalLength).toArray(),
  }
}
