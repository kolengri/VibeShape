import { appearanceColorSchema } from "@vibeshape/domain/part-appearance"
import type { PrintReadinessResult } from "@vibeshape/print-analysis"
import type { PrintPreparationResult } from "@vibeshape/protocol"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"

export function printReadinessPreviewMeshes(
  result: PrintPreparationResult,
  readiness: PrintReadinessResult | null = null,
): ViewerMesh[] {
  return result.meshes.flatMap((mesh, index) => {
    const positions = new Float32Array(mesh.vertices)
    const indices = new Uint32Array(mesh.triangles)
    const sourceNormals = result.normals[index]
    if (!sourceNormals) throw new Error("Prepared print normals are missing.")
    const normals = new Float32Array(sourceNormals)
    const source: ViewerMesh = {
      featureId: `print-${index}`,
      appearance: index < result.report.bodyCount ? "model" : "preview",
      positions,
      normals,
      indices,
      triangleFaceIds: Uint32Array.from(
        { length: indices.length / 3 },
        (_, triangle) => triangle + 1,
      ),
    }
    const body = readiness?.bodies[index]
    if (!body) return [source]
    const thin = new Set(body.thinTriangles),
      overhang = new Set(body.overhangTriangles)
    const groups = [[], [], [], []] as number[][]
    for (let triangle = 0; triangle < indices.length / 3; triangle++) {
      const group = thin.has(triangle)
        ? overhang.has(triangle)
          ? 3
          : 1
        : overhang.has(triangle)
          ? 2
          : 0
      groups[group]?.push(triangle)
    }
    const colors = ["#8799a6", "#df3746", "#e79525", "#a84cb7"]
    return groups.flatMap((triangles, group) =>
      triangles.length
        ? [
            {
              ...source,
              appearance: "model" as const,
              color: appearanceColorSchema.parse(colors[group]),
              outputRole: `analysis-${group}`,
              indices: Uint32Array.from(
                triangles.flatMap((triangle) => [
                  indices[3 * triangle] as number,
                  indices[3 * triangle + 1] as number,
                  indices[3 * triangle + 2] as number,
                ]),
              ),
              triangleFaceIds: Uint32Array.from(triangles, (triangle) => triangle + 1),
            },
          ]
        : [],
    )
  })
}
