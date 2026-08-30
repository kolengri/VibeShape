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
  const end = entity.type === "arc" ? requiredPoint(points, entity.endPointId) : null
  return entity.type === "circle"
    ? projectRoundCurveGeometry(sourceFrame, targetFrame, { type: "circle", center, radius })
    : projectRoundCurveGeometry(sourceFrame, targetFrame, {
        type: "arc",
        center,
        radius,
        start,
        end,
      })
}

type RoundCurveGeometry =
  | Readonly<{ type: "circle"; center: SketchPoint2; radius: number }>
  | Readonly<{
      type: "arc"
      center: SketchPoint2
      radius: number
      start: SketchPoint2 | null
      end: SketchPoint2 | null
    }>

function projectRoundCurveGeometry(
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  geometry: RoundCurveGeometry,
): ProjectedSketchCurve | null {
  const { center, radius } = geometry
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
  if (geometry.type === "circle") {
    return projectedCircle(projection, isRound)
  }
  return projectedArc(sourceFrame, targetFrame, projection, isRound, geometry.start, geometry.end)
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
  projection: EllipseProjection,
  isRound: boolean,
  start: SketchPoint2 | null,
  end: SketchPoint2 | null,
): ProjectedSketchCurve | null {
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

type Vector3 = readonly [number, number, number]
const MAX_CIRCULAR_EDGE_DISPLAY_SEGMENTS = 4_096
const MAX_ELLIPTICAL_EDGE_DISPLAY_SEGMENTS = 4_096

export type WorldCircularEdgeGeometry =
  | Readonly<{
      kind: "circle-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      radius: number
    }>
  | Readonly<{
      kind: "arc-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      radius: number
      start: Vector3
      middle: Vector3
      end: Vector3
    }>

function vectorDot3(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function localCircularPoint(frame: SupportFrame, point: Vector3): SketchPoint2 {
  const relative = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ] as const
  return { x: vectorDot3(relative, frame.xAxis), y: vectorDot3(relative, frame.yAxis) }
}

function positiveAngle(point: SketchPoint2) {
  const angle = Math.atan2(point.y, point.x)
  return angle < 0 ? angle + Math.PI * 2 : angle
}

function positiveSweepContains(start: SketchPoint2, middle: SketchPoint2, end: SketchPoint2) {
  const startAngle = positiveAngle(start)
  const middleDelta = (positiveAngle(middle) - startAngle + Math.PI * 2) % (Math.PI * 2)
  const endDelta = (positiveAngle(end) - startAngle + Math.PI * 2) % (Math.PI * 2)
  return middleDelta <= endDelta + PROJECTION_TOLERANCE
}

function circularEdgeFrame(geometry: WorldCircularEdgeGeometry): SupportFrame {
  const initial: SupportFrame = {
    origin: [...geometry.center],
    xAxis: [...geometry.xAxis],
    yAxis: [...geometry.yAxis],
    normal: [...geometry.normal],
  }
  if (geometry.kind === "circle-edge") return initial
  const start = localCircularPoint(initial, geometry.start)
  const middle = localCircularPoint(initial, geometry.middle)
  const end = localCircularPoint(initial, geometry.end)
  if (positiveSweepContains(start, middle, end)) return initial
  return {
    ...initial,
    yAxis: initial.yAxis.map((coordinate) => -coordinate) as [number, number, number],
    normal: initial.normal.map((coordinate) => -coordinate) as [number, number, number],
  }
}

/** Projects exact circular model-edge geometry into a sketch support frame. */
export function projectWorldCircularEdgeToSupport(
  geometry: WorldCircularEdgeGeometry,
  targetFrame: SupportFrame,
): ProjectedSketchCurve | null {
  const sourceFrame = circularEdgeFrame(geometry)
  if (geometry.kind === "circle-edge") {
    return projectRoundCurveGeometry(sourceFrame, targetFrame, {
      type: "circle",
      center: { x: 0, y: 0 },
      radius: geometry.radius,
    })
  }
  return projectRoundCurveGeometry(sourceFrame, targetFrame, {
    type: "arc",
    center: { x: 0, y: 0 },
    radius: geometry.radius,
    start: localCircularPoint(sourceFrame, geometry.start),
    end: localCircularPoint(sourceFrame, geometry.end),
  })
}

function worldCircularPoint(
  frame: SupportFrame,
  radius: number,
  angle: number,
): readonly [number, number, number] {
  const x = Math.cos(angle) * radius
  const y = Math.sin(angle) * radius
  return worldPointInFrame(frame, x, y)
}

function worldPointInFrame(frame: SupportFrame, x: number, y: number): Vector3 {
  return [
    frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y,
    frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y,
    frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y,
  ]
}

/** Samples transient display points without changing the analytical reference contract. */
export function sampleWorldCircularEdge(
  geometry: WorldCircularEdgeGeometry,
  segmentCount = geometry.kind === "circle-edge" ? 64 : 48,
): readonly Vector3[] {
  if (
    !Number.isSafeInteger(segmentCount) ||
    segmentCount < 1 ||
    segmentCount > MAX_CIRCULAR_EDGE_DISPLAY_SEGMENTS
  ) {
    throw new RangeError(
      `Circular edge display segment count must be between 1 and ${MAX_CIRCULAR_EDGE_DISPLAY_SEGMENTS}.`,
    )
  }
  const frame = circularEdgeFrame(geometry)
  const start =
    geometry.kind === "circle-edge" ? 0 : positiveAngle(localCircularPoint(frame, geometry.start))
  const sweep =
    geometry.kind === "circle-edge"
      ? Math.PI * 2
      : (positiveAngle(localCircularPoint(frame, geometry.end)) - start + Math.PI * 2) %
        (Math.PI * 2)
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    worldCircularPoint(frame, geometry.radius, start + (sweep * index) / segmentCount),
  )
}

export type WorldEllipticalEdgeGeometry =
  | Readonly<{
      kind: "ellipse-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      majorRadius: number
      minorRadius: number
    }>
  | Readonly<{
      kind: "elliptical-arc-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      majorRadius: number
      minorRadius: number
      start: Vector3
      middle: Vector3
      end: Vector3
    }>

function localEllipticalPoint(
  frame: SupportFrame,
  geometry: WorldEllipticalEdgeGeometry,
  point: Vector3,
) {
  const relative = [
    point[0] - geometry.center[0],
    point[1] - geometry.center[1],
    point[2] - geometry.center[2],
  ] as const
  return {
    x: vectorDot3(relative, frame.xAxis) / geometry.majorRadius,
    y: vectorDot3(relative, frame.yAxis) / geometry.minorRadius,
  }
}

function ellipticalEdgeFrame(geometry: WorldEllipticalEdgeGeometry): SupportFrame {
  const initial: SupportFrame = {
    origin: [...geometry.center],
    xAxis: [...geometry.xAxis],
    yAxis: [...geometry.yAxis],
    normal: [...geometry.normal],
  }
  if (geometry.kind === "ellipse-edge") return initial
  const start = localEllipticalPoint(initial, geometry, geometry.start)
  const middle = localEllipticalPoint(initial, geometry, geometry.middle)
  const end = localEllipticalPoint(initial, geometry, geometry.end)
  const positive = positiveSweepContains(
    { x: start.x, y: start.y },
    { x: middle.x, y: middle.y },
    { x: end.x, y: end.y },
  )
  if (positive) return initial
  return {
    ...initial,
    yAxis: initial.yAxis.map((coordinate) => -coordinate) as [number, number, number],
    normal: initial.normal.map((coordinate) => -coordinate) as [number, number, number],
  }
}

/** Projects exact elliptical model-edge geometry into a sketch support frame. */
export function projectWorldEllipticalEdgeToSupport(
  geometry: WorldEllipticalEdgeGeometry,
  targetFrame: SupportFrame,
): ProjectedSketchCurve | null {
  const sourceFrame = ellipticalEdgeFrame(geometry)
  const center = { x: 0, y: 0 }
  const projection = ellipseProjection(
    sourceFrame,
    targetFrame,
    center,
    { x: geometry.majorRadius, y: 0 },
    { x: 0, y: geometry.minorRadius },
  )
  if (!projection) return null
  if (geometry.kind === "ellipse-edge") return projectedCircle(projection, false)
  const matrix = frameLinearProjection(sourceFrame, targetFrame)
  const localStart = localEllipticalPoint(sourceFrame, geometry, geometry.start)
  const localEnd = localEllipticalPoint(sourceFrame, geometry, geometry.end)
  const start = transformVector(matrix, {
    x: localStart.x * geometry.majorRadius,
    y: localStart.y * geometry.minorRadius,
  })
  const end = transformVector(matrix, {
    x: localEnd.x * geometry.majorRadius,
    y: localEnd.y * geometry.minorRadius,
  })
  return {
    type: "elliptical-arc",
    points: [
      projection.center,
      projection.primary,
      projection.secondary,
      { x: projection.center.x + start.x, y: projection.center.y + start.y },
      { x: projection.center.x + end.x, y: projection.center.y + end.y },
    ],
  }
}

function worldEllipticalPoint(
  frame: SupportFrame,
  majorRadius: number,
  minorRadius: number,
  angle: number,
): Vector3 {
  const x = Math.cos(angle) * majorRadius
  const y = Math.sin(angle) * minorRadius
  return worldPointInFrame(frame, x, y)
}

/** Samples transient elliptical display points without changing analytical identity. */
export function sampleWorldEllipticalEdge(
  geometry: WorldEllipticalEdgeGeometry,
  segmentCount = geometry.kind === "ellipse-edge" ? 64 : 48,
): readonly Vector3[] {
  if (
    !Number.isSafeInteger(segmentCount) ||
    segmentCount < 1 ||
    segmentCount > MAX_ELLIPTICAL_EDGE_DISPLAY_SEGMENTS
  ) {
    throw new RangeError(
      `Elliptical edge display segment count must be between 1 and ${MAX_ELLIPTICAL_EDGE_DISPLAY_SEGMENTS}.`,
    )
  }
  const frame = ellipticalEdgeFrame(geometry)
  const start =
    geometry.kind === "ellipse-edge"
      ? 0
      : positiveAngle(localEllipticalPoint(frame, geometry, geometry.start))
  const sweep =
    geometry.kind === "ellipse-edge"
      ? Math.PI * 2
      : (positiveAngle(localEllipticalPoint(frame, geometry, geometry.end)) - start + Math.PI * 2) %
        (Math.PI * 2)
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    worldEllipticalPoint(
      frame,
      geometry.majorRadius,
      geometry.minorRadius,
      start + (sweep * index) / segmentCount,
    ),
  )
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
