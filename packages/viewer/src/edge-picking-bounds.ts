import type { Matrix4, OrthographicCamera, Plane, Vector2 } from "three"
import type { ViewerVector3 } from "./three-viewport"

export type EdgePickBounds = Readonly<{
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  magnitude: number
}>

type Projection = Readonly<{ elements: Readonly<Matrix4["elements"]>; roundoff: number }>

// Leave ample exponent headroom for clipping, both matrix transforms, and squared CSS distances.
const safeMagnitude = 1e20

/** Installed samples are world coordinates; this cache is independent of the body surface matrix. */
export function edgePickBounds(points: readonly ViewerVector3[]): EdgePickBounds | null {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const [x, y, z] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  const magnitude = Math.max(1, -minX, -minY, -minZ, maxX, maxY, maxZ)
  if (!Number.isFinite(magnitude) || magnitude > safeMagnitude) return null
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
    dx: (maxX - minX) / 2,
    dy: (maxY - minY) / 2,
    dz: (maxZ - minZ) / 2,
    magnitude,
  }
}

function affineMagnitude(matrix: Matrix4) {
  const e = matrix.elements
  if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) return Infinity
  return Math.max(1, ...e.map(Math.abs))
}

/** Unsupported or numerically unsafe inputs keep the original unpruned path. */
export function edgePickProjection(
  camera: OrthographicCamera,
  viewProjection: Matrix4,
  planes: readonly Plane[],
  pointer: Vector2,
  width: number,
  height: number,
): Projection | null {
  const viewMagnitude = affineMagnitude(camera.matrixWorldInverse)
  const projectionMagnitude = affineMagnitude(camera.projectionMatrix)
  const inputMagnitude = Math.max(
    viewMagnitude,
    projectionMagnitude,
    Math.abs(pointer.x),
    Math.abs(pointer.y),
    width,
    height,
  )
  if (!Number.isFinite(inputMagnitude) || inputMagnitude > safeMagnitude || planes.length > 1024)
    return null
  for (const { normal, constant } of planes) {
    const magnitude = Math.max(
      Math.abs(normal.x),
      Math.abs(normal.y),
      Math.abs(normal.z),
      Math.abs(constant),
    )
    if (!Number.isFinite(magnitude) || magnitude > safeMagnitude) return null
  }
  return {
    elements: viewProjection.elements,
    // Each finite clipping lerp stays in the original box up to rounding. Cover accumulated
    // lerps, box construction, matrix composition versus sequential projection, and pixel math.
    roundoff: 128 * Number.EPSILON * (planes.length + 1) * viewMagnitude * projectionMagnitude,
  }
}

/** A screen rectangle encloses every clipped segment; depth and occlusion remain narrow phase. */
export function edgeMayHit(
  bounds: EdgePickBounds | null,
  projection: Projection | null,
  pointer: Vector2,
  width: number,
  height: number,
) {
  if (!bounds || !projection) return true
  const { x, y, z, dx, dy, dz, magnitude } = bounds
  const { elements: e, roundoff } = projection
  const padding = roundoff * magnitude
  const centerX = e[0] * x + e[4] * y + e[8] * z + e[12]
  const radiusX = Math.abs(e[0]) * dx + Math.abs(e[4]) * dy + Math.abs(e[8]) * dz + padding
  if ((Math.abs(pointer.x - centerX) * width) / 2 > 6 + (radiusX * width) / 2) return false
  const centerY = e[1] * x + e[5] * y + e[9] * z + e[13]
  const radiusY = Math.abs(e[1]) * dx + Math.abs(e[5]) * dy + Math.abs(e[9]) * dz + padding
  return !((Math.abs(pointer.y - centerY) * height) / 2 > 6 + (radiusY * height) / 2)
}
