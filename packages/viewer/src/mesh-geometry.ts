import { BufferAttribute, BufferGeometry } from "three"
import type { ViewerMesh } from "./three-viewport"

/** Returns the stable identity key for one feature body output. */
export function viewerBodyKey(body: Readonly<{ featureId: string; outputRole?: string }>) {
  return body.outputRole === undefined
    ? body.featureId
    : `${body.featureId}\u0000${body.outputRole}`
}

export function createViewerGeometry(mesh: ViewerMesh) {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  geometry.userData = {
    featureId: mesh.featureId,
    ...(mesh.outputRole === undefined ? {} : { outputRole: mesh.outputRole }),
    triangleFaceIds: mesh.triangleFaceIds,
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
