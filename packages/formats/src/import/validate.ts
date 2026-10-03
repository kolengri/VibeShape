import { transformPoint, validateTransform, validateWorldCurve, validateWorldPoint } from "./affine"
import {
  type ImportedMesh,
  type ImportLimits,
  type ParsedGeometryImport,
  requireImport,
} from "./contracts"
import { transformDeterminant } from "./matrix"

function degenerateTriangle(mesh: ImportedMesh, triangle: readonly number[]) {
  const a = mesh.vertices[triangle[0] ?? -1]
  const b = mesh.vertices[triangle[1] ?? -1]
  const c = mesh.vertices[triangle[2] ?? -1]
  requireImport(
    Boolean(a && b && c),
    "invalid-geometry",
    "A triangle references a missing vertex.",
    mesh.id,
  )
  if (!a || !b || !c) return true
  const [abx, aby, abz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const [acx, acy, acz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const area = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx)
  return area === 0
}
function validateMeshImport(
  geometry: Extract<ParsedGeometryImport, { kind: "triangle-mesh" }>,
  limits: ImportLimits,
) {
  requireImport(
    geometry.meshes.length <= limits.bodies && geometry.nodes.length <= limits.bodies,
    "resource-limit",
    "The mesh import exceeds its object budget.",
  )
  const meshes = new Map(geometry.meshes.map((mesh) => [mesh.id, mesh]))
  requireImport(
    meshes.size === geometry.meshes.length,
    "invalid-geometry",
    "Imported mesh inspection IDs must be unique.",
  )
  let sourceVertices = 0
  let sourceTriangles = 0
  let degenerate = 0
  for (const mesh of geometry.meshes) {
    sourceVertices += mesh.vertices.length
    sourceTriangles += mesh.triangles.length
    const invalid = mesh.triangles.filter((triangle) => degenerateTriangle(mesh, triangle)).length
    requireImport(
      invalid < mesh.triangles.length,
      "invalid-geometry",
      "A mesh contains no positive-area triangles.",
      mesh.id,
    )
    degenerate += invalid
  }
  requireImport(
    sourceVertices <= limits.vertices && sourceTriangles <= limits.triangles,
    "resource-limit",
    "Mesh resources exceed their vertex or triangle budget.",
  )
  let vertices = 0
  let triangles = 0
  const nodeIds = new Set<string>()
  for (const node of geometry.nodes) {
    requireImport(
      !nodeIds.has(node.id),
      "invalid-geometry",
      "Imported node inspection IDs must be unique.",
    )
    nodeIds.add(node.id)
    const mesh = meshes.get(node.meshId)
    requireImport(
      Boolean(mesh),
      "invalid-geometry",
      "A build node references an unknown mesh.",
      node.id,
    )
    if (!mesh) continue
    vertices += mesh.vertices.length
    triangles += mesh.triangles.length
    requireImport(
      vertices <= limits.vertices && triangles <= limits.triangles,
      "resource-limit",
      "Expanded build items exceed their mesh budget.",
    )
    validateTransform(node.transform)
    requireImport(
      node.reversesWinding === transformDeterminant(node.transform) < 0,
      "invalid-geometry",
      "A mirrored node must declare reversed winding.",
    )
    for (const point of mesh.vertices) validateWorldPoint(transformPoint(node.transform, point))
  }
  geometry.warnings = degenerate ? [{ code: "degenerate-triangles", count: degenerate }] : []
}
export function validateParsedImport(geometry: ParsedGeometryImport, limits: ImportLimits) {
  if (geometry.kind === "triangle-mesh") return validateMeshImport(geometry, limits)
  let segments = 0
  const ids = new Set<string>()
  for (const path of geometry.paths) {
    requireImport(
      !ids.has(path.id),
      "invalid-geometry",
      "Imported path inspection IDs must be unique.",
    )
    ids.add(path.id)
    segments += path.segments.length
    requireImport(
      segments <= limits.pathSegments,
      "resource-limit",
      "The import exceeds its analytical curve budget.",
    )
    validateTransform(path.transform)
    for (const curve of path.segments) validateWorldCurve(curve, path.transform)
  }
}
