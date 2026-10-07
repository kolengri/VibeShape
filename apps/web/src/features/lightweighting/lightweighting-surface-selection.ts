import {
  type ViewerAnalysisOverlay,
  type ViewerMesh,
  viewerFaceSurfaceGeometry,
} from "@vibeshape/viewer/three-viewport"
import type {
  LightweightingFields,
  LightweightingSource,
  SurfaceForceFields,
} from "./lightweighting-model"

/** Display face IDs are disposable identities scoped to this captured mesh. */
export function faceTriangleIndices(source: LightweightingSource, faceIds: readonly number[]) {
  const selected = new Set(faceIds)
  return Array.from(source.body.mesh.triangleFaceIds).flatMap((faceId, triangle) =>
    selected.has(faceId) ? [triangle] : [],
  )
}

function sourceMesh(source: LightweightingSource): ViewerMesh {
  return { ...source.body.mesh, featureId: source.featureId, outputRole: source.outputRole }
}
export function faceForce(
  source: LightweightingSource,
  faceIds: readonly number[],
  force: SurfaceForceFields,
): [number, number, number] {
  const direction =
    force.direction === "normal"
      ? (viewerFaceSurfaceGeometry(sourceMesh(source), faceIds)?.normal ?? [0, 0, 0])
      : ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const)[force.direction]
  const magnitude = force.magnitudeN.trim() === "" ? Number.NaN : Number(force.magnitudeN)
  return direction.map((value) => value * magnitude * (force.flipped ? -1 : 1)) as [
    number,
    number,
    number,
  ]
}

export function lightweightingOverlays(source: LightweightingSource, fields: LightweightingFields) {
  const surface = fields.surfaceSelection
  if (!surface) return []
  const mesh = sourceMesh(source)
  const overlays: ViewerAnalysisOverlay[] = [
    { kind: "face", mesh, faceIds: surface.supportFaces, role: "support" },
    { kind: "face", mesh, faceIds: surface.preserveFaces, role: "preserve" },
  ]
  const bounds = source.body.shape.bounds
  const length = Math.max(...bounds.max.map((value, axis) => value - (bounds.min[axis] ?? 0))) * 0.3
  for (const load of fields.loadCases) {
    const faces = surface.loadFaces[load.id] ?? []
    overlays.push({ kind: "face", mesh, faceIds: faces, role: "load" })
    if (!faces.length || !load.surfaceForce) continue
    const vector = faceForce(source, faces, load.surfaceForce)
    if (!vector.every(Number.isFinite) || Math.hypot(...vector) === 0) continue
    const geometry = viewerFaceSurfaceGeometry(mesh, faces)
    if (!geometry) continue
    overlays.push({
      kind: "force-arrow",
      origin: geometry.center,
      vector,
      length,
    })
  }
  return overlays
}
