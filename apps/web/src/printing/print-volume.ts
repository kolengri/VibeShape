import { checkPrintVolume } from "@vibeshape/print-analysis"
import type { PrinterProfile } from "@vibeshape/protocol"
import { type ViewerMesh, viewerBodyKey } from "@vibeshape/viewer/three-viewport"

export function inspectViewportPrintVolume(meshes: readonly ViewerMesh[], profile: PrinterProfile) {
  const bodies = meshes.filter((mesh) => mesh.appearance !== "datum")
  if (bodies.length === 0) return null
  try {
    return checkPrintVolume(
      bodies.map((mesh) => ({
        name: viewerBodyKey(mesh),
        vertices: Array.from(mesh.positions),
        triangles: Array.from(mesh.indices),
      })),
      profile,
    )
  } catch {
    return null
  }
}
