import { ShapeUtils, Vector2, Vector3 } from "three"
import type { ViewerSection } from "./section-view"
import type { ViewerMesh } from "./three-viewport"

type Topology = Readonly<{
  vertices: readonly Vector3[]
  triangles: readonly number[][]
  tolerance: number
}>
const topologyCache = new WeakMap<ViewerMesh, Topology | null>()

function pointKey(point: Vector3, tolerance: number) {
  return point
    .toArray()
    .map((coordinate) => Math.round(coordinate / tolerance))
    .join(",")
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// Only closed two-manifold meshes can establish a solid interior from their display triangles.
function closedTopology(source: ViewerMesh): Topology | null {
  if (topologyCache.has(source)) return topologyCache.get(source) ?? null
  const result = prepareTopology(source)
  topologyCache.set(source, result)
  return result
}

function weldVertices(positions: Float32Array) {
  if (positions.length % 3) return null
  let scale = 1
  for (const value of positions) {
    if (!Number.isFinite(value)) return null
    scale = Math.max(scale, Math.abs(value))
  }
  const tolerance = Math.max(1e-6, scale * 1e-8)
  const vertices: Vector3[] = []
  const welded = new Map<string, number>()
  const vertexIds: number[] = []
  for (let index = 0; index < positions.length; index += 3) {
    const point = new Vector3().fromArray(positions, index)
    const key = pointKey(point, tolerance)
    let id = welded.get(key)
    if (id === undefined) {
      id = vertices.length
      vertices.push(point)
      welded.set(key, id)
    }
    vertexIds.push(id)
  }
  return { vertices, vertexIds, tolerance }
}

function weldedTriangle(
  indices: Uint32Array,
  vertexIds: readonly number[],
): [number, number, number] | null {
  const triangle = [...indices].map((sourceIndex) => vertexIds[sourceIndex])
  const [a, b, c] = triangle
  if (a === undefined || b === undefined || c === undefined || new Set(triangle).size !== 3)
    return null
  return [a, b, c]
}

function closedTriangles(indices: Uint32Array, vertexIds: readonly number[]) {
  if (indices.length % 3 || !indices.length) return null
  const edges = new Map<string, number>()
  const triangles: number[][] = []
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = weldedTriangle(indices.subarray(index, index + 3), vertexIds)
    if (!triangle) return null
    const [a, b, c] = triangle
    triangles.push(triangle)
    for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)])
      edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  return [...edges.values()].every((count) => count === 2) ? triangles : null
}

function prepareTopology(source: ViewerMesh): Topology | null {
  const welded = weldVertices(source.positions)
  if (!welded) return null
  const triangles = closedTriangles(source.indices, welded.vertexIds)
  return triangles ? { vertices: welded.vertices, triangles, tolerance: welded.tolerance } : null
}

function containsPoint(contour: readonly Vector2[], point: Vector2) {
  let inside = false
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const a = contour[index]
    const b = contour[previous]
    if (!a || !b) return false
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside
  }
  return inside
}

function segmentsCross(p: Vector2, q: Vector2, r: Vector2, s: Vector2, tolerance: number) {
  if (
    Math.max(p.x, q.x) + tolerance < Math.min(r.x, s.x) ||
    Math.max(r.x, s.x) + tolerance < Math.min(p.x, q.x) ||
    Math.max(p.y, q.y) + tolerance < Math.min(r.y, s.y) ||
    Math.max(r.y, s.y) + tolerance < Math.min(p.y, q.y)
  )
    return false
  const cross = (u: Vector2, v: Vector2, w: Vector2) =>
    (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x)
  return cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0
}

type ContourEdge = Readonly<{
  a: Vector2
  b: Vector2
  contour: number
  index: number
  length: number
  minX: number
  maxX: number
}>

function contourEdges(contours: readonly (readonly Vector2[])[]) {
  const edges: ContourEdge[] = []
  for (const [contourIndex, contour] of contours.entries()) {
    for (const [index, a] of contour.entries()) {
      const b = contour[(index + 1) % contour.length]
      if (!b) return null
      edges.push({
        a,
        b,
        contour: contourIndex,
        index,
        length: contour.length,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
      })
    }
  }
  return edges.sort((left, right) => left.minX - right.minX)
}

function adjacentEdges(left: ContourEdge, right: ContourEdge) {
  if (left.contour !== right.contour) return false
  const separation = Math.abs(left.index - right.index)
  return separation === 1 || separation === left.length - 1
}

function edgesBacktrack(left: ContourEdge, right: ContourEdge, tolerance: number) {
  const common = left.b.equals(right.a) ? left.b : left.a
  const incoming = (left.a.equals(common) ? left.b : left.a).clone().sub(common)
  const outgoing = (right.a.equals(common) ? right.b : right.a).clone().sub(common)
  return (
    incoming.dot(outgoing) > tolerance ** 2 &&
    Math.abs(incoming.cross(outgoing)) <= tolerance * (incoming.length() + outgoing.length())
  )
}

function contourPairAmbiguous(left: ContourEdge, right: ContourEdge, tolerance: number) {
  return adjacentEdges(left, right)
    ? edgesBacktrack(left, right, tolerance)
    : segmentsCross(left.a, left.b, right.a, right.b, tolerance)
}

function contoursAmbiguous(contours: readonly (readonly Vector2[])[], tolerance: number) {
  const edges = contourEdges(contours)
  if (!edges) return true
  let comparisons = 0
  // Sorting prunes ordinary disjoint intervals. Pathological dense intervals fall back without fill.
  const comparisonBudget = 100_000
  for (const [index, left] of edges.entries()) {
    for (let next = index + 1; next < edges.length; next += 1) {
      const right = edges[next]
      if (!right || right.minX > left.maxX + tolerance) break
      if (++comparisons > comparisonBudget) return true
      if (contourPairAmbiguous(left, right, tolerance)) return true
    }
  }
  return false
}

function triangleIntersection(
  vertices: readonly Vector3[],
  coordinate: number,
  offset: number,
  tolerance: number,
) {
  const distances = vertices.map((point) => {
    const distance = point.getComponent(coordinate) - offset
    return Math.abs(distance) <= tolerance ? 0 : distance
  })
  const above = distances.some((distance) => distance > 0)
  const below = distances.some((distance) => distance < 0)
  if (!above && !below) return { above, below, points: [] }
  const intersections = triangleEdgePoints(vertices, distances, coordinate, offset)
  return intersections ? { above, below, points: intersections } : null
}

function triangleEdgePoints(
  vertices: readonly Vector3[],
  distances: readonly number[],
  coordinate: number,
  offset: number,
) {
  const points: Vector3[] = []
  for (let index = 0; index < 3; index += 1) {
    const a = vertices[index]
    const b = vertices[(index + 1) % 3]
    const da = distances[index]
    const db = distances[(index + 1) % 3]
    if (!a || !b || da === undefined || db === undefined) return null
    if (da === 0) points.push(a.clone().setComponent(coordinate, offset))
    if (da * db < 0)
      points.push(
        a
          .clone()
          .lerp(b, da / (da - db))
          .setComponent(coordinate, offset),
      )
  }
  return points
}

type SectionSegment = { a: number; b: number; sides: number; crossing: boolean }
function appendSectionSegment(
  segments: Map<string, SectionSegment>,
  a: number,
  b: number,
  sides: number,
) {
  const key = edgeKey(a, b)
  const previous = segments.get(key)
  if (previous) {
    previous.sides |= sides
    previous.crossing ||= sides === 3
  } else segments.set(key, { a, b, sides, crossing: sides === 3 })
}

function recordIntersectionSegment(
  intersection: NonNullable<ReturnType<typeof triangleIntersection>>,
  idForPoint: (point: Vector3) => number,
  segments: Map<string, SectionSegment>,
) {
  const hits = new Set(intersection.points.map(idForPoint))
  if (hits.size !== 2) return true
  const [a, b] = [...hits]
  if (a === undefined || b === undefined) return false
  appendSectionSegment(
    segments,
    a,
    b,
    Number(intersection.above) | (Number(intersection.below) << 1),
  )
  return true
}

function sectionSegments(topology: Topology, coordinate: number, offset: number) {
  const points: Vector3[] = []
  const pointIds = new Map<string, number>()
  const segments = new Map<string, SectionSegment>()
  const idForPoint = (point: Vector3) => {
    const key = pointKey(point, topology.tolerance)
    let id = pointIds.get(key)
    if (id === undefined) {
      id = points.length
      points.push(point)
      pointIds.set(key, id)
    }
    return id
  }
  let hasAbove = false
  let hasBelow = false
  for (const triangle of topology.triangles) {
    const vertices = triangle
      .map((index) => topology.vertices[index])
      .filter((point) => point !== undefined)
    const intersection = triangleIntersection(vertices, coordinate, offset, topology.tolerance)
    if (!intersection) return null
    const { above, below } = intersection
    hasAbove ||= above
    hasBelow ||= below
    if (!recordIntersectionSegment(intersection, idForPoint, segments)) return null
  }
  return hasAbove && hasBelow ? { points, segments: [...segments.values()] } : null
}

function sectionNeighbors(segments: readonly SectionSegment[]) {
  const neighbors = new Map<number, number[]>()
  const append = (a: number, b: number) => {
    const list = neighbors.get(a) ?? []
    list.push(b)
    neighbors.set(a, list)
  }
  for (const segment of segments) {
    if (!segment.crossing && segment.sides !== 3) continue
    append(segment.a, segment.b)
    append(segment.b, segment.a)
  }
  return neighbors.size && [...neighbors.values()].every((list) => list.length === 2)
    ? neighbors
    : null
}

function traceContour(
  start: number,
  neighbors: ReadonlyMap<number, readonly number[]>,
  points: readonly Vector3[],
  visited: Set<number>,
  u: number,
  v: number,
) {
  const contour: Vector2[] = []
  let current = start
  let previous = -1
  do {
    if (visited.has(current)) return null
    visited.add(current)
    const point = points[current]
    const next = neighbors.get(current)?.find((id) => id !== previous)
    if (!point || next === undefined) return null
    contour.push(new Vector2(point.getComponent(u), point.getComponent(v)))
    previous = current
    current = next
  } while (current !== start)
  return contour
}

function sectionContours(
  slice: NonNullable<ReturnType<typeof sectionSegments>>,
  u: number,
  v: number,
  tolerance: number,
) {
  const neighbors = sectionNeighbors(slice.segments)
  if (!neighbors) return null
  const visited = new Set<number>()
  const contours: Vector2[][] = []
  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue
    const contour = traceContour(start, neighbors, slice.points, visited, u, v)
    if (!contour || contour.length < 3 || Math.abs(ShapeUtils.area(contour)) <= tolerance ** 2)
      return null
    contours.push(contour)
  }
  return contoursAmbiguous(contours, tolerance) ? null : contours
}

function triangulateContours(
  contours: Vector2[][],
  coordinate: number,
  u: number,
  v: number,
  offset: number,
) {
  const depths = contours.map(
    (contour) =>
      contours.filter(
        (other) => other !== contour && contour[0] && containsPoint(other, contour[0]),
      ).length,
  )
  const positions: number[] = []
  for (let index = 0; index < contours.length; index += 1) {
    const contour = contours[index]
    const depth = depths[index]
    if (!contour || depth === undefined || depth % 2) continue
    const holes = contours.filter(
      (other, holeIndex) =>
        depths[holeIndex] === depth + 1 && other[0] && containsPoint(contour, other[0]),
    )
    const flat = [contour, ...holes].flat()
    for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
      for (const vertex of triangle) {
        const point = flat[vertex]
        if (!point) return null
        positions.push(
          ...new Vector3()
            .setComponent(coordinate, offset)
            .setComponent(u, point.x)
            .setComponent(v, point.y)
            .toArray(),
        )
      }
    }
  }
  return positions.length ? new Float32Array(positions) : null
}

/** Returns disposable cap triangles, or no fill when a closed, unambiguous interior cannot be proven. */
export function sectionCapPositions(
  source: ViewerMesh,
  section: ViewerSection,
): Float32Array | null {
  const topology = closedTopology(source)
  if (!topology || !Number.isFinite(section.offset)) return null
  const coordinate = { x: 0, y: 1, z: 2 }[section.axis]
  const [u, v] = [0, 1, 2].filter((value) => value !== coordinate)
  if (u === undefined || v === undefined) return null
  const slice = sectionSegments(topology, coordinate, section.offset)
  if (!slice) return null
  const contours = sectionContours(slice, u, v, topology.tolerance)
  return contours ? triangulateContours(contours, coordinate, u, v, section.offset) : null
}
