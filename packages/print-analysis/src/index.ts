import {
  type PrintPreparationInput,
  type PrintPreparationMesh,
  type PrintPreparationResult,
  printPreparationInputSchema,
  printPreparationResultSchema,
} from "@vibeshape/protocol"
import { generateFins } from "./fin-supports"
import { bounds, meshNormals, meshPoints, type Point, rotate, sub } from "./mesh-geometry"

/** Derive a bounded print copy. Never changes design coordinates or semantic history. */
export function preparePrintMeshes(raw: PrintPreparationInput): PrintPreparationResult {
  const input = printPreparationInputSchema.parse(raw)
  const rotated = input.meshes.map((mesh) => ({
    mesh,
    points: meshPoints(mesh).map((p) =>
      rotate(p, input.settings.rotationX, input.settings.rotationY),
    ),
  }))
  const box = bounds(rotated.flatMap(({ points }) => points))
  const offset: Point = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]]
  const bodies: PrintPreparationMesh[] = rotated.map(({ mesh, points }) => ({
    ...mesh,
    vertices: points.flatMap((p) => sub(p, offset)),
    triangles: [...mesh.triangles],
  }))
  const fins = generateFins(bodies, input.settings)
  const meshes = [...bodies, ...fins.meshes]
  const preparedBounds = bounds(meshes.flatMap(meshPoints))
  return printPreparationResultSchema.parse({
    meshes,
    normals: meshes.map(meshNormals),
    report: {
      bodyCount: bodies.length,
      finCount: fins.meshes.length,
      contactCount: fins.contacts,
      bounds: sub(preparedBounds.max, preparedBounds.min),
      warnings: fins.warnings,
    },
  })
}
