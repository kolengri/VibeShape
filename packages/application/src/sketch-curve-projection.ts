import type { SketchEntity, SketchPoint2 } from "@vibeshape/domain"
import { projectSketchPointBetweenFrames, type SupportFrame } from "./support-frame"

type SketchCurveEntity = Exclude<SketchEntity, { type: "line" | "point" }>
type SketchCurveType = SketchCurveEntity["type"]
type SketchPointLookup = Pick<ReadonlyMap<string, SketchPoint2>, "get">

export type ProjectedSketchCurve = Readonly<{
  points: readonly SketchPoint2[]
  radius?: number
  type: SketchCurveType
}>

const PROJECTION_TOLERANCE = 1e-9

type Vector2 = Readonly<{ x: number; y: number }>
type Matrix2 = Readonly<{
  xx: number
  xy: number
  yx: number
  yy: number
}>

function dot3(left: readonly number[], right: readonly number[]) {
  return (
    (left[0] ?? 0) * (right[0] ?? 0) +
    (left[1] ?? 0) * (right[1] ?? 0) +
    (left[2] ?? 0) * (right[2] ?? 0)
  )
}

function frameLinearProjection(source: SupportFrame, target: SupportFrame): Matrix2 {
  return {
    xx: dot3(target.xAxis, source.xAxis),
    xy: dot3(target.xAxis, source.yAxis),
    yx: dot3(target.yAxis, source.xAxis),
    yy: dot3(target.yAxis, source.yAxis),
  }
}

function transformVector(matrix: Matrix2, vector: Vector2): Vector2 {
  return {
    x: matrix.xx * vector.x + matrix.xy * vector.y,
    y: matrix.yx * vector.x + matrix.yy * vector.y,
  }
}

function vectorBetween(start: SketchPoint2, end: SketchPoint2): Vector2 {
  return { x: end.x - start.x, y: end.y - start.y }
}

function determinant(first: Vector2, second: Vector2) {
  return first.x * second.y - first.y * second.x
}

function axisDecomposition(first: Vector2, second: Vector2) {
  const xx = first.x * first.x + second.x * second.x
  const xy = first.x * first.y + second.x * second.y
  const yy = first.y * first.y + second.y * second.y
  const discriminant = Math.hypot(xx - yy, 2 * xy)
  const primarySquared = Math.max(0, (xx + yy + discriminant) / 2)
  const secondarySquared = Math.max(0, (xx + yy - discriminant) / 2)
  const primaryRadius = Math.sqrt(primarySquared)
  const secondaryRadius = Math.sqrt(secondarySquared)
  if (
    primaryRadius <= PROJECTION_TOLERANCE ||
    secondaryRadius <= PROJECTION_TOLERANCE * Math.max(1, primaryRadius)
  ) {
    return null
  }

  let primaryDirection: Vector2
  if (Math.abs(xy) > PROJECTION_TOLERANCE) {
    primaryDirection = { x: xy, y: primarySquared - xx }
  } else {
    primaryDirection = xx >= yy ? { x: 1, y: 0 } : { x: 0, y: 1 }
  }
  const magnitude = Math.hypot(primaryDirection.x, primaryDirection.y)
  primaryDirection = { x: primaryDirection.x / magnitude, y: primaryDirection.y / magnitude }
  if (primaryDirection.x * first.x + primaryDirection.y * first.y < 0) {
    primaryDirection = { x: -primaryDirection.x, y: -primaryDirection.y }
  }
  const orientation = determinant(first, second) < 0 ? -1 : 1
  const secondaryDirection = {
    x: -primaryDirection.y * orientation,
    y: primaryDirection.x * orientation,
  }
  return { primaryDirection, primaryRadius, secondaryDirection, secondaryRadius }
}

function projectedPoint(source: SupportFrame, target: SupportFrame, point: SketchPoint2) {
  return projectSketchPointBetweenFrames(source, target, point).local
}

function ellipseProjection(
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  center: SketchPoint2,
  firstAxis: Vector2,
  secondAxis: Vector2,
) {
  const matrix = frameLinearProjection(sourceFrame, targetFrame)
  const first = transformVector(matrix, firstAxis)
  const second = transformVector(matrix, secondAxis)
  const axes = axisDecomposition(first, second)
  if (!axes) return null
  const projectedCenter = projectedPoint(sourceFrame, targetFrame, center)
  return {
    center: projectedCenter,
    primary: {
      x: projectedCenter.x + axes.primaryDirection.x * axes.primaryRadius,
      y: projectedCenter.y + axes.primaryDirection.y * axes.primaryRadius,
    },
    secondary: {
      x: projectedCenter.x + axes.secondaryDirection.x * axes.secondaryRadius,
      y: projectedCenter.y + axes.secondaryDirection.y * axes.secondaryRadius,
    },
    primaryRadius: axes.primaryRadius,
    secondaryRadius: axes.secondaryRadius,
  }
}

function requiredPoint(points: SketchPointLookup, id: string) {
  return points.get(id) ?? null
}

function projectRoundCurve(
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  entity: Extract<SketchCurveEntity, { type: "arc" | "circle" }>,
  points: SketchPointLookup,
  circleRadius?: number,
): ProjectedSketchCurve | null {
  const center = requiredPoint(points, entity.centerPointId)
  if (!center) return null
  const start = entity.type === "arc" ? requiredPoint(points, entity.startPointId) : null
  const radius =
    entity.type === "circle" ? (circleRadius ?? entity.radius) : pointDistance(center, start)
  if (!Number.isFinite(radius) || radius <= PROJECTION_TOLERANCE) return null
  const projection = ellipseProjection(
    sourceFrame,
    targetFrame,
    center,
    { x: radius, y: 0 },
    { x: 0, y: radius },
  )
  if (!projection) return null
  const isRound =
    Math.abs(projection.primaryRadius - projection.secondaryRadius) <=
    PROJECTION_TOLERANCE * Math.max(1, projection.primaryRadius)
  if (entity.type === "circle") {
    return projectedCircle(projection, isRound)
  }
  return projectedArc(sourceFrame, targetFrame, entity, points, projection, isRound, start)
}

type EllipseProjection = NonNullable<ReturnType<typeof ellipseProjection>>

function projectedCircle(projection: EllipseProjection, isRound: boolean): ProjectedSketchCurve {
  return isRound
    ? { type: "circle", points: [projection.center], radius: projection.primaryRadius }
    : { type: "ellipse", points: [projection.center, projection.primary, projection.secondary] }
}

function projectedArc(
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  entity: Extract<SketchCurveEntity, { type: "arc" }>,
  points: SketchPointLookup,
  projection: EllipseProjection,
  isRound: boolean,
  start: SketchPoint2 | null,
): ProjectedSketchCurve | null {
  const end = requiredPoint(points, entity.endPointId)
  if (!start || !end) return null
  const projectedStart = projectedPoint(sourceFrame, targetFrame, start)
  const projectedEnd = projectedPoint(sourceFrame, targetFrame, end)
  if (!isRound) {
    return {
      type: "elliptical-arc",
      points: [
        projection.center,
        projection.primary,
        projection.secondary,
        projectedStart,
        projectedEnd,
      ],
    }
  }
  const matrix = frameLinearProjection(sourceFrame, targetFrame)
  const reflected = matrix.xx * matrix.yy - matrix.xy * matrix.yx < 0
  return {
    type: "arc",
    points: [
      projection.center,
      reflected ? projectedEnd : projectedStart,
      reflected ? projectedStart : projectedEnd,
    ],
  }
}

function pointDistance(first: SketchPoint2, second: SketchPoint2 | null) {
  return second ? Math.hypot(second.x - first.x, second.y - first.y) : 0
}

function projectEllipseCurve(
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  entity: Extract<SketchCurveEntity, { type: "ellipse" | "elliptical-arc" }>,
  points: SketchPointLookup,
): ProjectedSketchCurve | null {
  const center = requiredPoint(points, entity.centerPointId)
  const primary = requiredPoint(points, entity.primaryAxisPointId)
  const secondary = requiredPoint(points, entity.secondaryAxisPointId)
  if (!center || !primary || !secondary) return null
  const projection = ellipseProjection(
    sourceFrame,
    targetFrame,
    center,
    vectorBetween(center, primary),
    vectorBetween(center, secondary),
  )
  if (!projection) return null
  if (entity.type === "ellipse") {
    return {
      type: "ellipse",
      points: [projection.center, projection.primary, projection.secondary],
    }
  }
  const start = requiredPoint(points, entity.startPointId)
  const end = requiredPoint(points, entity.endPointId)
  if (!start || !end) return null
  return {
    type: "elliptical-arc",
    points: [
      projection.center,
      projection.primary,
      projection.secondary,
      projectedPoint(sourceFrame, targetFrame, start),
      projectedPoint(sourceFrame, targetFrame, end),
    ],
  }
}

/** Projects an analytical sketch curve exactly; rank-degenerate projections fail closed. */
export function projectSketchCurveBetweenFrames(
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  entity: SketchCurveEntity,
  points: SketchPointLookup,
  circleRadius?: number,
): ProjectedSketchCurve | null {
  return entity.type === "circle" || entity.type === "arc"
    ? projectRoundCurve(sourceFrame, targetFrame, entity, points, circleRadius)
    : projectEllipseCurve(sourceFrame, targetFrame, entity, points)
}
