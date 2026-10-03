import {
  type PrintPreparationMesh,
  printPreparationResultSchema,
  printPreparationSettingsSchema,
} from "@vibeshape/protocol"
import { EPS, meshPoints, type Point, rotate, sub } from "./mesh-geometry"

const meshSchema = printPreparationResultSchema.shape.meshes.element
const rotationSchema = printPreparationSettingsSchema
  .pick({ rotationX: true, rotationY: true, rotationZ: true })
  .extend({
    rotationX: printPreparationSettingsSchema.shape.rotationX.unwrap(),
    rotationY: printPreparationSettingsSchema.shape.rotationY.unwrap(),
    rotationZ: printPreparationSettingsSchema.shape.rotationZ.unwrap(),
  })

function signedDegrees(radians: number): number {
  const degrees = Math.max(-180, Math.min(180, (radians * 180) / Math.PI))
  return Math.abs(degrees) <= EPS ? 0 : degrees
}

/** Derive source-copy rotation from a disposable triangle in the currently prepared mesh. */
export function layPrintFacetOnBed(
  raw: PrintPreparationMesh,
  triangleIndex: number,
  currentRotation: { rotationX: number; rotationY: number; rotationZ: number },
): { rotationX: number; rotationY: number; rotationZ: 0 } {
  const mesh = meshSchema.parse(raw)
  const rotation = rotationSchema.parse(currentRotation)
  const index = meshSchema.shape.triangles.element
    .max(mesh.triangles.length / 3 - 1)
    .parse(triangleIndex)
  const points = meshPoints(mesh)
  const [a, b, c] = mesh.triangles.slice(index * 3, index * 3 + 3).map((i) => points[i])
  if (!a || !b || !c) throw new Error("print-analysis.missing-facet-vertex")
  const ab = sub(b, a)
  const ac = sub(c, a)
  const cross: Point = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
  const magnitude = Math.hypot(...cross)
  if (magnitude <= EPS) throw new Error("print-analysis.degenerate-facet")
  const normal: Point = [cross[0] / magnitude, cross[1] / magnitude, cross[2] / magnitude]
  // Undo Rz Ry Rx in reverse order; a seated translation does not affect the normal.
  const unyawed = rotate(normal, 0, 0, -rotation.rotationZ)
  const unpitched = rotate(unyawed, 0, -rotation.rotationY)
  const [x, y, z] = rotate(unpitched, -rotation.rotationX, 0)
  const s = Math.hypot(y, z)
  return {
    rotationX: signedDegrees(s > EPS ? Math.atan2(-y, -z) : 0),
    rotationY: signedDegrees(Math.atan2(x, s)),
    rotationZ: 0,
  }
}
