import type { ViewerMesh } from "./three-viewport"

const THUMBNAIL_WIDTH = 240
const THUMBNAIL_HEIGHT = 160
const THUMBNAIL_PADDING = 12
const MAX_THUMBNAIL_TRIANGLES = 768

type ProjectedPoint = Readonly<{
  x: number
  y: number
  depth: number
}>

type ProjectedTriangle = Readonly<{
  points: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint]
  shade: number
}>

export type ProjectThumbnail = Readonly<{
  mediaType: "image/svg+xml"
  bytes: Uint8Array
}>

function finiteCoordinate(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? value : null
}

function projectPoint(x: number, y: number, z: number): ProjectedPoint {
  return {
    x: x + y,
    y: z - (x - y) * 0.45,
    depth: x - y + z * 0.8,
  }
}

function meshPoint(mesh: ViewerMesh, vertexIndex: number) {
  const offset = vertexIndex * 3
  const x = finiteCoordinate(mesh.positions[offset])
  const y = finiteCoordinate(mesh.positions[offset + 1])
  const z = finiteCoordinate(mesh.positions[offset + 2])
  return x === null || y === null || z === null ? null : { x, y, z }
}

function triangleShade(
  first: Readonly<{ x: number; y: number; z: number }>,
  second: Readonly<{ x: number; y: number; z: number }>,
  third: Readonly<{ x: number; y: number; z: number }>,
) {
  const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z }
  const ac = { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z }
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  }
  const length = Math.hypot(normal.x, normal.y, normal.z)
  if (length <= Number.EPSILON) return 0.35
  const light = Math.abs((normal.x * 0.4 + normal.y * -0.5 + normal.z * 0.76) / length)
  return Math.min(Math.max(0.28 + light * 0.72, 0.28), 1)
}

function totalTriangleCount(meshes: readonly ViewerMesh[]) {
  return meshes.reduce((count, mesh) => count + Math.floor(mesh.indices.length / 3), 0)
}

function triangleIndices(mesh: ViewerMesh, triangleIndex: number) {
  const first = mesh.indices[triangleIndex * 3]
  const second = mesh.indices[triangleIndex * 3 + 1]
  const third = mesh.indices[triangleIndex * 3 + 2]
  return first === undefined || second === undefined || third === undefined
    ? null
    : ([first, second, third] as const)
}

function projectedTriangle(mesh: ViewerMesh, triangleIndex: number) {
  const indices = triangleIndices(mesh, triangleIndex)
  if (!indices) return null
  const first = meshPoint(mesh, indices[0])
  const second = meshPoint(mesh, indices[1])
  const third = meshPoint(mesh, indices[2])
  if (!first || !second || !third) return null
  return {
    points: [
      projectPoint(first.x, first.y, first.z),
      projectPoint(second.x, second.y, second.z),
      projectPoint(third.x, third.y, third.z),
    ],
    shade: triangleShade(first, second, third),
  } satisfies ProjectedTriangle
}

function sampledTriangles(meshes: readonly ViewerMesh[]) {
  const stride = Math.max(1, Math.ceil(totalTriangleCount(meshes) / MAX_THUMBNAIL_TRIANGLES))
  const triangles: ProjectedTriangle[] = []
  let sourceTriangleIndex = 0

  for (const mesh of meshes) {
    const triangleCount = Math.floor(mesh.indices.length / 3)
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const include = sourceTriangleIndex % stride === 0
      sourceTriangleIndex += 1
      if (!include) continue
      const triangle = projectedTriangle(mesh, triangleIndex)
      if (triangle) triangles.push(triangle)
    }
  }

  return triangles.sort(
    (left, right) =>
      left.points.reduce((sum, point) => sum + point.depth, 0) -
      right.points.reduce((sum, point) => sum + point.depth, 0),
  )
}

function projectedBounds(triangles: readonly ProjectedTriangle[]) {
  const points = triangles.flatMap(({ points }) => points)
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    maxX: Math.max(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxY: Math.max(...points.map(({ y }) => y)),
  }
}

function scaledPoint(
  point: ProjectedPoint,
  bounds: ReturnType<typeof projectedBounds>,
  scale: number,
) {
  const contentWidth = (bounds.maxX - bounds.minX) * scale
  const contentHeight = (bounds.maxY - bounds.minY) * scale
  const offsetX = (THUMBNAIL_WIDTH - contentWidth) / 2
  const offsetY = (THUMBNAIL_HEIGHT - contentHeight) / 2
  return {
    x: offsetX + (point.x - bounds.minX) * scale,
    y: THUMBNAIL_HEIGHT - (offsetY + (point.y - bounds.minY) * scale),
  }
}

function triangleElement(
  triangle: ProjectedTriangle,
  bounds: ReturnType<typeof projectedBounds>,
  scale: number,
) {
  const points = triangle.points
    .map((point) => scaledPoint(point, bounds, scale))
    .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ")
  const red = Math.round(92 + triangle.shade * 70)
  const green = Math.round(116 + triangle.shade * 65)
  const blue = Math.round(139 + triangle.shade * 60)
  return `<polygon points="${points}" fill="rgb(${red} ${green} ${blue})"/>`
}

export function renderProjectThumbnail(meshes: readonly ViewerMesh[]): ProjectThumbnail | null {
  const triangles = sampledTriangles(meshes)
  if (triangles.length === 0) return null
  const bounds = projectedBounds(triangles)
  const projectedWidth = Math.max(bounds.maxX - bounds.minX, 0.001)
  const projectedHeight = Math.max(bounds.maxY - bounds.minY, 0.001)
  const scale = Math.min(
    (THUMBNAIL_WIDTH - THUMBNAIL_PADDING * 2) / projectedWidth,
    (THUMBNAIL_HEIGHT - THUMBNAIL_PADDING * 2) / projectedHeight,
  )
  const polygons = triangles.map((triangle) => triangleElement(triangle, bounds, scale)).join("")
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}" role="img">` +
    `<g stroke="#263746" stroke-width="0.75" stroke-linejoin="round">${polygons}</g></svg>`
  return { mediaType: "image/svg+xml", bytes: new TextEncoder().encode(svg) }
}
