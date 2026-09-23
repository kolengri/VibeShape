import type { PrintPreparationMesh } from "@vibeshape/protocol"
export type Point = [number, number, number]
export type Point2 = [number, number]
export const EPS = 1e-7
function at<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index]
  if (value === undefined) throw new Error(`print-analysis.${label}`)
  return value
}
export const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Point) => Math.hypot(...a)
export const cross2 = (a: Point2, b: Point2, c: Point2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
export const meshPoints = (mesh: PrintPreparationMesh): Point[] =>
  Array.from({ length: mesh.vertices.length / 3 }, (_, i) => [
    at(mesh.vertices, i * 3, "missing-coordinate"),
    at(mesh.vertices, i * 3 + 1, "missing-coordinate"),
    at(mesh.vertices, i * 3 + 2, "missing-coordinate"),
  ])
export function bounds(points: Point[]) {
  const min: Point = [Infinity, Infinity, Infinity]
  const max: Point = [-Infinity, -Infinity, -Infinity]
  for (const p of points)
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], p[axis])
      max[axis] = Math.max(max[axis], p[axis])
    }
  return { min, max }
}
export function rotate(p: Point, xDeg: number, yDeg: number): Point {
  const x = (xDeg * Math.PI) / 180,
    y = (yDeg * Math.PI) / 180
  const py = p[1] * Math.cos(x) - p[2] * Math.sin(x)
  const pz = p[1] * Math.sin(x) + p[2] * Math.cos(x)
  return [p[0] * Math.cos(y) + pz * Math.sin(y), py, -p[0] * Math.sin(y) + pz * Math.cos(y)]
}
export type Facet = { points: [Point, Point, Point]; normal: Point; plane: number; area: number }
type EdgeState = { count: number; orientation: number }
function makeFacet(points: Point[], indices: readonly [number, number, number]): Facet | "invalid" {
  const triangle: [Point, Point, Point] = [
    at(points, indices[0], "invalid-index"),
    at(points, indices[1], "invalid-index"),
    at(points, indices[2], "invalid-index"),
  ]
  const raw = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]))
  const magnitude = norm(raw)
  if (magnitude <= EPS) return "invalid"
  const normal: Point = [raw[0] / magnitude, raw[1] / magnitude, raw[2] / magnitude]
  const plane = dot(normal, triangle[0])
  if (points.some((p) => dot(normal, p) - plane > EPS * 10)) return "invalid"
  return { points: triangle, normal, plane, area: magnitude / 2 }
}
function addFacetEdges(
  edges: Map<string, EdgeState>,
  ids: number[],
  indices: readonly [number, number, number],
): boolean {
  for (let edge = 0; edge < 3; edge++) {
    const a = at(ids, at(indices, edge, "missing-index"), "identity-index")
    const b = at(ids, at(indices, (edge + 1) % 3, "missing-index"), "identity-index")
    if (a === b) return false
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const prior = edges.get(key) ?? { count: 0, orientation: 0 }
    edges.set(key, { count: prior.count + 1, orientation: prior.orientation + (a < b ? 1 : -1) })
  }
  return true
}
export function meshNormals(mesh: PrintPreparationMesh) {
  const points = meshPoints(mesh)
  const normals: Point[] = points.map(() => [0, 0, 0])
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    const indices = [
      at(mesh.triangles, offset, "missing-index"),
      at(mesh.triangles, offset + 1, "missing-index"),
      at(mesh.triangles, offset + 2, "missing-index"),
    ]
    const a = at(points, at(indices, 0, "missing-index"), "invalid-index"),
      b = at(points, at(indices, 1, "missing-index"), "invalid-index"),
      c = at(points, at(indices, 2, "missing-index"), "invalid-index")
    const normal = cross(sub(b, a), sub(c, a))
    for (const i of indices)
      for (const axis of [0, 1, 2] as const) at(normals, i, "normal-index")[axis] += normal[axis]
  }
  return normals.flatMap((normal) => {
    const length = norm(normal)
    return length > EPS ? normal.map((value) => value / length) : normal
  })
}
// OCCT export meshes contain face-local duplicate vertices. Identity here is disposable.
export function convexFacets(
  mesh: PrintPreparationMesh,
): Facet[] | "complexity-limit" | "nonconvex-or-open" {
  const points = meshPoints(mesh)
  if ((points.length * mesh.triangles.length) / 3 > 2_000_000) return "complexity-limit"
  const unique = new Map<string, number>()
  const ids = points.map((p) => {
    const key = p.map((n) => Math.round(n / EPS)).join(":")
    let id = unique.get(key)
    if (id === undefined) {
      id = unique.size
      unique.set(key, id)
    }
    return id
  })
  const edges = new Map<string, EdgeState>()
  const facets: Facet[] = []
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const indices = [
      at(mesh.triangles, i, "missing-index"),
      at(mesh.triangles, i + 1, "missing-index"),
      at(mesh.triangles, i + 2, "missing-index"),
    ] as const
    const facet = makeFacet(points, indices)
    if (facet === "invalid" || !addFacetEdges(edges, ids, indices)) return "nonconvex-or-open"
    facets.push(facet)
  }
  if ([...edges.values()].some((edge) => edge.count !== 2 || edge.orientation !== 0))
    return "nonconvex-or-open"
  return facets
}
