import type { SketchEntity, SketchEntityId, SketchPoint2 } from "@vibeshape/domain"
import type { SketchDimensionKind } from "./sketch-constraint-tools"

export type SketchDimensionGeometry = Readonly<{
  entities: readonly SketchEntity[]
  point: (id: SketchEntityId) => SketchPoint2 | null
  solvedCircleRadius: (id: SketchEntityId) => number | null
}>

function distance(first: SketchPoint2, second: SketchPoint2) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function linePoints(entity: SketchEntity | undefined, point: SketchDimensionGeometry["point"]) {
  if (entity?.type !== "line") return null
  const start = point(entity.startPointId)
  const end = point(entity.endPointId)
  return start && end ? ([start, end] as const) : null
}

function twoPoints(geometry: SketchDimensionGeometry) {
  const entities = geometry.entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
  )
  const first = entities[0] ? geometry.point(entities[0].id) : null
  const second = entities[1] ? geometry.point(entities[1].id) : null
  return first && second && entities.length === 2 ? ([first, second] as const) : null
}

function lineAngle(geometry: SketchDimensionGeometry) {
  const lines = geometry.entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line",
  )
  const first = linePoints(lines[0], geometry.point)
  const second = linePoints(lines[1], geometry.point)
  if (!first || !second || lines.length !== 2) return null
  const firstAngle = Math.atan2(first[1].y - first[0].y, first[1].x - first[0].x)
  const secondAngle = Math.atan2(second[1].y - second[0].y, second[1].x - second[0].x)
  const difference = Math.abs(firstAngle - secondAngle) % (Math.PI * 2)
  return difference > Math.PI ? Math.PI * 2 - difference : difference
}

function roundRadius(geometry: SketchDimensionGeometry) {
  const curve = geometry.entities[0]
  if (!curve || (curve.type !== "circle" && curve.type !== "arc")) return null
  const solvedRadius = geometry.solvedCircleRadius(curve.id)
  if (solvedRadius !== null) return solvedRadius
  if (curve.type === "circle") return curve.radius
  const center = geometry.point(curve.centerPointId)
  const start = geometry.point(curve.startPointId)
  return center && start ? distance(center, start) : null
}

function ellipseAxisDiameter(geometry: SketchDimensionGeometry, axis: "primary" | "secondary") {
  const curve = geometry.entities[0]
  if (!curve || (curve.type !== "ellipse" && curve.type !== "elliptical-arc")) return null
  const center = geometry.point(curve.centerPointId)
  const axisPoint = geometry.point(
    axis === "primary" ? curve.primaryAxisPointId : curve.secondaryAxisPointId,
  )
  return center && axisPoint ? distance(center, axisPoint) * 2 : null
}

export function sketchDimensionCanonicalValue(
  kind: SketchDimensionKind,
  geometry: SketchDimensionGeometry,
) {
  return dimensionValueReaders[kind](geometry)
}

function linearDimensionValue(
  geometry: SketchDimensionGeometry,
  axis: "direct" | "horizontal" | "vertical",
) {
  const points = twoPoints(geometry) ?? linePoints(geometry.entities[0], geometry.point)
  if (!points) return null
  if (axis === "horizontal") return Math.abs(points[1].x - points[0].x)
  if (axis === "vertical") return Math.abs(points[1].y - points[0].y)
  return distance(points[0], points[1])
}

function scaledRoundRadius(geometry: SketchDimensionGeometry, scale: 1 | 2) {
  const radius = roundRadius(geometry)
  return radius === null ? null : radius * scale
}

const dimensionValueReaders = {
  angle: lineAngle,
  diameter: (geometry) => scaledRoundRadius(geometry, 2),
  distance: (geometry) => linearDimensionValue(geometry, "direct"),
  "horizontal-distance": (geometry) => linearDimensionValue(geometry, "horizontal"),
  offset: (geometry) => linearDimensionValue(geometry, "direct"),
  "primary-axis-diameter": (geometry) => ellipseAxisDiameter(geometry, "primary"),
  radius: (geometry) => scaledRoundRadius(geometry, 1),
  "secondary-axis-diameter": (geometry) => ellipseAxisDiameter(geometry, "secondary"),
  "vertical-distance": (geometry) => linearDimensionValue(geometry, "vertical"),
} satisfies Record<SketchDimensionKind, (geometry: SketchDimensionGeometry) => number | null>

function inferEllipseAxisKind(
  geometry: SketchDimensionGeometry,
  pointer: SketchPoint2,
  fallback: SketchDimensionKind | null,
) {
  const curve = geometry.entities[0]
  if (!curve || (curve.type !== "ellipse" && curve.type !== "elliptical-arc")) return fallback
  const primary = geometry.point(curve.primaryAxisPointId)
  const secondary = geometry.point(curve.secondaryAxisPointId)
  if (!primary || !secondary) return fallback
  return distance(pointer, primary) <= distance(pointer, secondary)
    ? "primary-axis-diameter"
    : "secondary-axis-diameter"
}

function inferPointDistanceKind(
  available: readonly SketchDimensionKind[],
  geometry: SketchDimensionGeometry,
  pointer: SketchPoint2,
  fallback: SketchDimensionKind | null,
) {
  const points = twoPoints(geometry)
  const projected =
    available.includes("horizontal-distance") && available.includes("vertical-distance")
  if (!points || !projected) return fallback
  const midpoint = {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  }
  const horizontalOffset = Math.abs(pointer.x - midpoint.x)
  const verticalOffset = Math.abs(pointer.y - midpoint.y)
  if (verticalOffset > horizontalOffset * 1.35) return "horizontal-distance"
  if (horizontalOffset > verticalOffset * 1.35) return "vertical-distance"
  return available.includes("distance") ? "distance" : fallback
}

export function inferSketchDimensionKind(
  available: readonly SketchDimensionKind[],
  geometry: SketchDimensionGeometry,
  pointer: SketchPoint2,
) {
  const fallback = available[0] ?? null
  if (available.includes("radius") && available.includes("diameter")) return "diameter"
  const ellipseAxes =
    available.includes("primary-axis-diameter") && available.includes("secondary-axis-diameter")
  return ellipseAxes
    ? inferEllipseAxisKind(geometry, pointer, fallback)
    : inferPointDistanceKind(available, geometry, pointer, fallback)
}

export function sketchDimensionWitnessPoints(
  kind: SketchDimensionKind,
  geometry: SketchDimensionGeometry,
) {
  const points = twoPoints(geometry) ?? linePoints(geometry.entities[0], geometry.point)
  if (points) return points
  const curve = geometry.entities[0]
  if (!curve) return []
  if (curve.type === "circle" || curve.type === "arc") {
    const center = geometry.point(curve.centerPointId)
    return center ? [center] : []
  }
  if (curve.type === "ellipse" || curve.type === "elliptical-arc") {
    const center = geometry.point(curve.centerPointId)
    const axis = geometry.point(
      kind === "secondary-axis-diameter" ? curve.secondaryAxisPointId : curve.primaryAxisPointId,
    )
    return [center, axis].filter((point): point is SketchPoint2 => point !== null)
  }
  return []
}
