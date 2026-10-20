import { BufferAttribute, BufferGeometry, type Intersection, type Plane } from "three"
import { viewerBodyKey } from "./mesh-geometry"
import { sectionPointVisible } from "./section-view"
import type { ViewerMesh, ViewerSelection } from "./three-viewport"

// Display snapshots are immutable; replacing face metadata gets a new, independently collectible index.
const faceOrdinals = new WeakMap<Uint32Array, ReadonlyMap<number, number>>()

export function viewerFaceOrdinal(mesh: ViewerMesh, faceId: number) {
  let ordinals = faceOrdinals.get(mesh.triangleFaceIds)
  if (!ordinals) {
    const index = new Map<number, number>()
    for (const candidate of mesh.triangleFaceIds) {
      if (!index.has(candidate)) index.set(candidate, index.size + 1)
    }
    ordinals = index
    faceOrdinals.set(mesh.triangleFaceIds, ordinals)
  }
  return ordinals.get(faceId) ?? null
}

export function viewerSelectionFromSource(
  source: ViewerMesh,
  faceIndex: number | null | undefined,
): ViewerSelection | null {
  if (faceIndex === null || faceIndex === undefined) return null
  const faceId = source.triangleFaceIds[faceIndex]
  if (faceId === undefined) return null
  const faceOrdinal = viewerFaceOrdinal(source, faceId)
  if (faceOrdinal === null) return null
  return {
    featureId: source.featureId,
    ...(source.outputRole === undefined ? {} : { outputRole: source.outputRole }),
    faceId,
    faceOrdinal,
  }
}

export function sameViewerSelection(left: ViewerSelection | null, right: ViewerSelection | null) {
  if (left === null || right === null) return left === right
  return viewerBodyKey(left) === viewerBodyKey(right) && left.faceId === right.faceId
}

/** Ordinary body picking ignores tool-specific support eligibility; hits are nearest-first. */
export function firstViewerSelectionHit(
  hits: readonly Pick<Intersection, "object" | "faceIndex" | "point" | "distance">[],
  sources: ReadonlyMap<string, ViewerMesh>,
  sectionPlanes: readonly Plane[] | null,
) {
  for (const hit of hits) {
    if (!sectionPointVisible(sectionPlanes, hit.point)) continue
    const source = sources.get(hit.object.name)
    const selection = source ? viewerSelectionFromSource(source, hit.faceIndex) : null
    if (selection) return { selection, distance: hit.distance }
  }
  return undefined
}

export function createFaceHighlightGeometry(mesh: ViewerMesh, faceId: number) {
  const triangleCount = mesh.triangleFaceIds.reduce(
    (count, candidate) => count + Number(candidate === faceId),
    0,
  )
  if (triangleCount === 0) return null
  const positions = new Float32Array(triangleCount * 9)
  const normals = new Float32Array(triangleCount * 9)
  let targetOffset = 0
  for (let triangle = 0; triangle < mesh.triangleFaceIds.length; triangle += 1) {
    if (mesh.triangleFaceIds[triangle] !== faceId) continue
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = mesh.indices[triangle * 3 + corner]
      if (vertexIndex === undefined) return null
      const sourceOffset = vertexIndex * 3
      const x = mesh.positions[sourceOffset]
      const y = mesh.positions[sourceOffset + 1]
      const z = mesh.positions[sourceOffset + 2]
      const normalX = mesh.normals[sourceOffset]
      const normalY = mesh.normals[sourceOffset + 1]
      const normalZ = mesh.normals[sourceOffset + 2]
      if (
        x === undefined ||
        y === undefined ||
        z === undefined ||
        normalX === undefined ||
        normalY === undefined ||
        normalZ === undefined
      ) {
        return null
      }
      positions[targetOffset] = x
      positions[targetOffset + 1] = y
      positions[targetOffset + 2] = z
      normals[targetOffset] = normalX
      normals[targetOffset + 1] = normalY
      normals[targetOffset + 2] = normalZ
      targetOffset += 3
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.setAttribute("normal", new BufferAttribute(normals, 3))
  return geometry
}
