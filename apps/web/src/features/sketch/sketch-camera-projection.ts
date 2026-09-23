import type { ViewerSketchPlaneProjection } from "@vibeshape/viewer/three-viewport"

type Point = Readonly<{ x: number; y: number }>
type Size = Readonly<{ width: number; height: number }>

export type SketchScreenBounds = Readonly<{
  minX: number
  minY: number
  width: number
  height: number
  cameraProjection?: ViewerSketchPlaneProjection | null
}>

export function projectSketchPlanePoint(point: Point, projection: ViewerSketchPlaneProjection) {
  return {
    x: projection.a * point.x + projection.c * point.y + projection.e,
    y: projection.b * point.x + projection.d * point.y + projection.f,
  }
}

export function unprojectSketchPlanePoint(point: Point, projection: ViewerSketchPlaneProjection) {
  const determinant = projection.a * projection.d - projection.b * projection.c
  const x = point.x - projection.e
  const y = point.y - projection.f
  return {
    x: (projection.d * x - projection.c * y) / determinant,
    y: (projection.a * y - projection.b * x) / determinant,
  }
}

export function cameraAwareSketchBounds(
  bounds: SketchScreenBounds,
  projection: ViewerSketchPlaneProjection | null,
  size: Size,
): SketchScreenBounds {
  if (!projection || size.width <= 0 || size.height <= 0) {
    return { ...bounds, cameraProjection: null }
  }
  const pixelsPerUnit = Math.max(
    Math.hypot(projection.a * size.width, projection.b * size.height),
    Math.hypot(projection.c * size.width, projection.d * size.height),
  )
  const center = unprojectSketchPlanePoint({ x: 0.5, y: 0.5 }, projection)
  const width = size.width / pixelsPerUnit
  const height = size.height / pixelsPerUnit
  return {
    minX: center.x - width / 2,
    minY: center.y - height / 2,
    width,
    height,
    cameraProjection: projection,
  }
}

export function sketchPlaneSvgTransform(bounds: SketchScreenBounds, size: Size) {
  const projection = bounds.cameraProjection
  if (!projection || size.width <= 0 || size.height <= 0) return undefined
  const scale = Math.min(size.width / bounds.width, size.height / bounds.height)
  const offsetX = (size.width - bounds.width * scale) / 2
  const offsetY = (size.height - bounds.height * scale) / 2
  // SVG content already negates sketch Y. Compose camera projection with that convention
  // and the inverse root viewBox transform, leaving strokes in CSS pixels.
  return `matrix(${[
    (projection.a * size.width) / scale,
    (projection.b * size.height) / scale,
    (-projection.c * size.width) / scale,
    (-projection.d * size.height) / scale,
    (projection.e * size.width - offsetX) / scale + bounds.minX,
    (projection.f * size.height - offsetY) / scale - bounds.minY - bounds.height,
  ].join(" ")})`
}
