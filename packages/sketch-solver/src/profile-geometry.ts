import type { SketchEntityId } from "@vibeshape/domain/identifiers"

const TWO_PI = Math.PI * 2

export type ProfilePoint = Readonly<{ x: number; y: number }>

type CurveEnvelope = Readonly<{
  entityId: SketchEntityId
  bounds: ProfileBounds
}>

export type ProfileLineCurve = CurveEnvelope &
  Readonly<{
    type: "line"
    start: ProfilePoint
    end: ProfilePoint
  }>

type ProfileRoundFields = CurveEnvelope &
  Readonly<{
    center: ProfilePoint
    radius: number
    startAngle: number
    sweep: number
    start: ProfilePoint
    end: ProfilePoint
  }>

export type ProfileArcCurve = ProfileRoundFields & Readonly<{ type: "arc" }>
export type ProfileCircleCurve = ProfileRoundFields & Readonly<{ type: "circle" }>
export type ProfileRoundCurve = ProfileArcCurve | ProfileCircleCurve

type ProfileEllipseFields = CurveEnvelope &
  Readonly<{
    center: ProfilePoint
    primaryRadius: number
    secondarySign: -1 | 1
    secondaryRadius: number
    rotationRadians: number
    start: ProfilePoint
    end: ProfilePoint
  }>

export type ProfileEllipseCurve = ProfileEllipseFields &
  Readonly<{
    type: "ellipse"
  }>

export type ProfileEllipticalArcCurve = ProfileEllipseFields &
  Readonly<{
    startParameter: number
    sweep: number
    type: "elliptical-arc"
  }>

export type ProfileEllipseLikeCurve = ProfileEllipseCurve | ProfileEllipticalArcCurve

export type ProfileCurve = ProfileEllipseLikeCurve | ProfileLineCurve | ProfileRoundCurve

export type ProfileBounds = Readonly<{
  minX: number
  minY: number
  maxX: number
  maxY: number
}>

export function distance(left: ProfilePoint, right: ProfilePoint) {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function normalizeAngle(angle: number) {
  const normalized = angle % TWO_PI
  return normalized < 0 ? normalized + TWO_PI : normalized
}

export function positiveSweep(startAngle: number, endAngle: number) {
  const sweep = normalizeAngle(endAngle - startAngle)
  return sweep === 0 ? TWO_PI : sweep
}

export function pointBounds(points: readonly ProfilePoint[]): ProfileBounds {
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  }
}

export function roundBounds(center: ProfilePoint, radius: number): ProfileBounds {
  return {
    minX: center.x - radius,
    minY: center.y - radius,
    maxX: center.x + radius,
    maxY: center.y + radius,
  }
}

export function ellipseBounds(
  center: ProfilePoint,
  primaryRadius: number,
  secondaryRadius: number,
  rotationRadians: number,
): ProfileBounds {
  const cosine = Math.cos(rotationRadians)
  const sine = Math.sin(rotationRadians)
  const extentX = Math.hypot(primaryRadius * cosine, secondaryRadius * sine)
  const extentY = Math.hypot(primaryRadius * sine, secondaryRadius * cosine)
  return {
    minX: center.x - extentX,
    minY: center.y - extentY,
    maxX: center.x + extentX,
    maxY: center.y + extentY,
  }
}

function parameterOnEllipticalArc(
  curve: ProfileEllipticalArcCurve,
  parameter: number,
  tolerance: number,
) {
  const relative = normalizeAngle(parameter - curve.startParameter)
  const angularTolerance =
    tolerance / Math.max(curve.primaryRadius, curve.secondaryRadius, tolerance)
  return relative <= curve.sweep + angularTolerance
}

export function ellipticalArcBounds(curve: Omit<ProfileEllipticalArcCurve, "bounds">) {
  const xExtremum = Math.atan2(
    -curve.secondarySign * curve.secondaryRadius * Math.sin(curve.rotationRadians),
    curve.primaryRadius * Math.cos(curve.rotationRadians),
  )
  const yExtremum = Math.atan2(
    curve.secondarySign * curve.secondaryRadius * Math.cos(curve.rotationRadians),
    curve.primaryRadius * Math.sin(curve.rotationRadians),
  )
  const parameters = [
    curve.startParameter,
    curve.startParameter + curve.sweep,
    xExtremum,
    xExtremum + Math.PI,
    yExtremum,
    yExtremum + Math.PI,
  ].filter(
    (parameter, index) =>
      index < 2 || parameterOnEllipticalArc(curve as ProfileEllipticalArcCurve, parameter, 0),
  )
  return pointBounds(parameters.map((parameter) => pointOnEllipseAt(curve, parameter)))
}

export function boundsOverlap(left: ProfileBounds, right: ProfileBounds, tolerance: number) {
  return !(
    left.maxX < right.minX - tolerance ||
    right.maxX < left.minX - tolerance ||
    left.maxY < right.minY - tolerance ||
    right.maxY < left.minY - tolerance
  )
}

function cross(left: ProfilePoint, right: ProfilePoint) {
  return left.x * right.y - left.y * right.x
}

function subtract(left: ProfilePoint, right: ProfilePoint): ProfilePoint {
  return { x: left.x - right.x, y: left.y - right.y }
}

function addScaled(origin: ProfilePoint, direction: ProfilePoint, scale: number): ProfilePoint {
  return { x: origin.x + direction.x * scale, y: origin.y + direction.y * scale }
}

function uniquePoints(points: readonly ProfilePoint[], tolerance: number) {
  return points.filter(
    (point, index) =>
      points.findIndex((candidate) => distance(point, candidate) <= tolerance) === index,
  )
}

function collinearLineIntersections(
  left: ProfileLineCurve,
  right: ProfileLineCurve,
  leftDirection: ProfilePoint,
  scale: number,
  tolerance: number,
) {
  const betweenStarts = subtract(right.start, left.start)
  if (Math.abs(cross(betweenStarts, leftDirection)) > tolerance * scale) {
    return { coincident: false, points: [] } as const
  }
  const useX = Math.abs(leftDirection.x) >= Math.abs(leftDirection.y)
  const component = useX ? leftDirection.x : leftDirection.y
  if (Math.abs(component) <= tolerance) return { coincident: true, points: [] } as const
  const rightStart = useX ? right.start.x : right.start.y
  const rightEnd = useX ? right.end.x : right.end.y
  const leftStart = useX ? left.start.x : left.start.y
  const first = (rightStart - leftStart) / component
  const second = (rightEnd - leftStart) / component
  const overlapStart = Math.max(0, Math.min(first, second))
  const overlapEnd = Math.min(1, Math.max(first, second))
  if (overlapEnd - overlapStart > tolerance / Math.max(scale, tolerance)) {
    return { coincident: true, points: [] } as const
  }
  const points = [overlapStart, overlapEnd]
    .filter((parameter) => parameter >= -tolerance && parameter <= 1 + tolerance)
    .map((parameter) => addScaled(left.start, leftDirection, parameter))
  return { coincident: false, points: uniquePoints(points, tolerance) } as const
}

function lineLineIntersections(left: ProfileLineCurve, right: ProfileLineCurve, tolerance: number) {
  const leftDirection = subtract(left.end, left.start)
  const rightDirection = subtract(right.end, right.start)
  const denominator = cross(leftDirection, rightDirection)
  const scale = Math.max(distance(left.start, left.end), distance(right.start, right.end), 1)
  if (Math.abs(denominator) <= tolerance * scale) {
    return collinearLineIntersections(left, right, leftDirection, scale, tolerance)
  }
  const betweenStarts = subtract(right.start, left.start)
  const leftParameter = cross(betweenStarts, rightDirection) / denominator
  const rightParameter = cross(betweenStarts, leftDirection) / denominator
  if (
    leftParameter < -tolerance ||
    leftParameter > 1 + tolerance ||
    rightParameter < -tolerance ||
    rightParameter > 1 + tolerance
  ) {
    return { coincident: false, points: [] } as const
  }
  return {
    coincident: false,
    points: [addScaled(left.start, leftDirection, leftParameter)],
  } as const
}

function angleOnRound(curve: ProfileRoundCurve, point: ProfilePoint, tolerance: number) {
  if (curve.type === "circle") return true
  const angle = Math.atan2(point.y - curve.center.y, point.x - curve.center.x)
  const relative = normalizeAngle(angle - curve.startAngle)
  const angularTolerance = tolerance / Math.max(curve.radius, tolerance)
  return relative <= curve.sweep + angularTolerance
}

export function pointOnRoundCurve(
  curve: ProfileRoundCurve,
  point: ProfilePoint,
  tolerance: number,
) {
  return (
    Math.abs(distance(curve.center, point) - curve.radius) <= tolerance &&
    angleOnRound(curve, point, tolerance)
  )
}

export function pointOnRoundCurveAt(curve: ProfileRoundCurve, fraction: number) {
  const angle = curve.startAngle + curve.sweep * fraction
  return {
    x: curve.center.x + curve.radius * Math.cos(angle),
    y: curve.center.y + curve.radius * Math.sin(angle),
  }
}

function lineRoundIntersections(
  line: ProfileLineCurve,
  round: ProfileRoundCurve,
  tolerance: number,
) {
  const direction = subtract(line.end, line.start)
  const fromCenter = subtract(line.start, round.center)
  const a = direction.x ** 2 + direction.y ** 2
  const b = 2 * (fromCenter.x * direction.x + fromCenter.y * direction.y)
  const c = fromCenter.x ** 2 + fromCenter.y ** 2 - round.radius ** 2
  const discriminant = b ** 2 - 4 * a * c
  if (discriminant < -tolerance) return { coincident: false, points: [] } as const
  const root = Math.sqrt(Math.max(0, discriminant))
  const parameters = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
  const points = parameters
    .filter((parameter) => parameter >= -tolerance && parameter <= 1 + tolerance)
    .map((parameter) => addScaled(line.start, direction, parameter))
    .filter((point) => angleOnRound(round, point, tolerance))
  return { coincident: false, points: uniquePoints(points, tolerance) } as const
}

function pointOnEllipseAt(
  curve: Pick<
    ProfileEllipseLikeCurve,
    "center" | "primaryRadius" | "rotationRadians" | "secondaryRadius" | "secondarySign"
  >,
  angle: number,
) {
  const cosine = Math.cos(curve.rotationRadians)
  const sine = Math.sin(curve.rotationRadians)
  const primary = curve.primaryRadius * Math.cos(angle)
  const secondary = curve.secondarySign * curve.secondaryRadius * Math.sin(angle)
  return {
    x: curve.center.x + primary * cosine - secondary * sine,
    y: curve.center.y + primary * sine + secondary * cosine,
  }
}

function ellipseParameterAt(curve: ProfileEllipseLikeCurve, point: ProfilePoint) {
  const cosine = Math.cos(curve.rotationRadians)
  const sine = Math.sin(curve.rotationRadians)
  const x = point.x - curve.center.x
  const y = point.y - curve.center.y
  return Math.atan2(
    ((-x * sine + y * cosine) * curve.secondarySign) / curve.secondaryRadius,
    (x * cosine + y * sine) / curve.primaryRadius,
  )
}

function lineEllipseIntersections(
  line: ProfileLineCurve,
  ellipse: ProfileEllipseLikeCurve,
  tolerance: number,
) {
  const cosine = Math.cos(ellipse.rotationRadians)
  const sine = Math.sin(ellipse.rotationRadians)
  const local = (point: ProfilePoint) => {
    const x = point.x - ellipse.center.x
    const y = point.y - ellipse.center.y
    return {
      x: x * cosine + y * sine,
      y: (-x * sine + y * cosine) * ellipse.secondarySign,
    }
  }
  const start = local(line.start)
  const end = local(line.end)
  const direction = subtract(end, start)
  const primarySquared = ellipse.primaryRadius ** 2
  const secondarySquared = ellipse.secondaryRadius ** 2
  const a = direction.x ** 2 / primarySquared + direction.y ** 2 / secondarySquared
  const b =
    (2 * start.x * direction.x) / primarySquared + (2 * start.y * direction.y) / secondarySquared
  const c = start.x ** 2 / primarySquared + start.y ** 2 / secondarySquared - 1
  const discriminant = b ** 2 - 4 * a * c
  const normalizedTolerance =
    tolerance / Math.max(ellipse.primaryRadius, ellipse.secondaryRadius, 1)
  if (a <= Number.EPSILON || discriminant < -normalizedTolerance) {
    return { coincident: false, points: [] } as const
  }
  const root = Math.sqrt(Math.max(0, discriminant))
  const parameters = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
  const parameterTolerance = tolerance / Math.max(distance(line.start, line.end), 1)
  const points = parameters
    .filter((parameter) => parameter >= -parameterTolerance && parameter <= 1 + parameterTolerance)
    .map((parameter) => addScaled(line.start, subtract(line.end, line.start), parameter))
    .filter(
      (point) =>
        ellipse.type === "ellipse" ||
        parameterOnEllipticalArc(ellipse, ellipseParameterAt(ellipse, point), tolerance),
    )
  return { coincident: false, points: uniquePoints(points, tolerance) } as const
}

function ellipseQuadratic(curve: ProfileEllipseLikeCurve) {
  const cosine = Math.cos(curve.rotationRadians)
  const sine = Math.sin(curve.rotationRadians)
  const primary = 1 / curve.primaryRadius ** 2
  const secondary = 1 / curve.secondaryRadius ** 2
  return {
    xx: cosine * cosine * primary + sine * sine * secondary,
    xy: cosine * sine * (primary - secondary),
    yy: sine * sine * primary + cosine * cosine * secondary,
  }
}

function ellipsesCoincident(
  left: ProfileEllipseLikeCurve,
  right: ProfileEllipseLikeCurve,
  tolerance: number,
) {
  if (distance(left.center, right.center) > tolerance) return false
  const first = ellipseQuadratic(left)
  const second = ellipseQuadratic(right)
  const coefficientScale = Math.max(first.xx, first.yy, second.xx, second.yy)
  const radiusScale = Math.max(
    left.primaryRadius,
    left.secondaryRadius,
    right.primaryRadius,
    right.secondaryRadius,
    1,
  )
  const coefficientTolerance = (tolerance / radiusScale) * coefficientScale
  return (
    Math.abs(first.xx - second.xx) <= coefficientTolerance &&
    Math.abs(first.xy - second.xy) <= coefficientTolerance &&
    Math.abs(first.yy - second.yy) <= coefficientTolerance
  )
}

function sampledCurvePoints(curve: ProfileEllipseLikeCurve | ProfileRoundCurve) {
  const count = 256
  if (curve.type === "ellipse") {
    return Array.from({ length: count + 1 }, (_, index) =>
      pointOnEllipseAt(curve, (TWO_PI * index) / count),
    )
  }
  if (curve.type === "elliptical-arc") {
    return Array.from({ length: count + 1 }, (_, index) =>
      pointOnEllipseAt(curve, curve.startParameter + curve.sweep * (index / count)),
    )
  }
  return Array.from({ length: count + 1 }, (_, index) => pointOnRoundCurveAt(curve, index / count))
}

function sampledCurveSegments(curve: ProfileEllipseLikeCurve | ProfileRoundCurve) {
  const points = sampledCurvePoints(curve)
  const segments: ProfileLineCurve[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    if (!start || !end) continue
    segments.push({
      entityId: curve.entityId,
      type: "line",
      start,
      end,
      bounds: pointBounds([start, end]),
    })
  }
  return segments
}

function sampledSegmentIntersectionPoints(
  left: ProfileLineCurve,
  right: ProfileLineCurve,
  tolerance: number,
) {
  if (!boundsOverlap(left.bounds, right.bounds, tolerance)) return []
  const intersection = lineLineIntersections(left, right, tolerance)
  return intersection.coincident ? [] : intersection.points
}

function sampledSegmentIntersections(
  left: readonly ProfileLineCurve[],
  right: readonly ProfileLineCurve[],
  tolerance: number,
) {
  const points: ProfilePoint[] = []
  for (const leftSegment of left) {
    for (const rightSegment of right) {
      points.push(...sampledSegmentIntersectionPoints(leftSegment, rightSegment, tolerance))
    }
  }
  return uniquePoints(points, tolerance * 4)
}

function sampledCurveIntersections(
  left: ProfileEllipseLikeCurve | ProfileRoundCurve,
  right: ProfileEllipseLikeCurve | ProfileRoundCurve,
  tolerance: number,
) {
  if (
    (left.type === "ellipse" || left.type === "elliptical-arc") &&
    (right.type === "ellipse" || right.type === "elliptical-arc") &&
    ellipsesCoincident(left, right, tolerance)
  ) {
    if (left.type === "ellipse" || right.type === "ellipse") {
      return { coincident: true, points: [] } as const
    }
    const angularTolerance =
      tolerance /
      Math.max(
        left.primaryRadius,
        left.secondaryRadius,
        right.primaryRadius,
        right.secondaryRadius,
        tolerance,
      )
    const leftStart = normalizeAngle(left.startParameter)
    const rightStart = normalizeAngle(right.startParameter)
    const overlaps = [-TWO_PI, 0, TWO_PI].some((shift) => {
      const start = Math.max(leftStart, rightStart + shift)
      const end = Math.min(leftStart + left.sweep, rightStart + shift + right.sweep)
      return end - start > angularTolerance
    })
    if (overlaps) return { coincident: true, points: [] } as const
    const endpoints = [left.start, left.end, right.start, right.end].filter((point, index) =>
      index < 2
        ? parameterOnEllipticalArc(right, ellipseParameterAt(right, point), tolerance)
        : parameterOnEllipticalArc(left, ellipseParameterAt(left, point), tolerance),
    )
    return { coincident: false, points: uniquePoints(endpoints, tolerance) } as const
  }
  return {
    coincident: false,
    points: sampledSegmentIntersections(
      sampledCurveSegments(left),
      sampledCurveSegments(right),
      tolerance,
    ),
  } as const
}

function roundRoundIntersections(
  left: ProfileRoundCurve,
  right: ProfileRoundCurve,
  tolerance: number,
) {
  const centerDistance = distance(left.center, right.center)
  if (centerDistance <= tolerance && Math.abs(left.radius - right.radius) <= tolerance) {
    return { coincident: true, points: [] } as const
  }
  if (
    centerDistance > left.radius + right.radius + tolerance ||
    centerDistance < Math.abs(left.radius - right.radius) - tolerance ||
    centerDistance <= tolerance
  ) {
    return { coincident: false, points: [] } as const
  }
  const along = (left.radius ** 2 - right.radius ** 2 + centerDistance ** 2) / (2 * centerDistance)
  const height = Math.sqrt(Math.max(0, left.radius ** 2 - along ** 2))
  const direction = {
    x: (right.center.x - left.center.x) / centerDistance,
    y: (right.center.y - left.center.y) / centerDistance,
  }
  const base = addScaled(left.center, direction, along)
  const perpendicular = { x: -direction.y, y: direction.x }
  const points = [
    addScaled(base, perpendicular, height),
    addScaled(base, perpendicular, -height),
  ].filter((point) => angleOnRound(left, point, tolerance) && angleOnRound(right, point, tolerance))
  return { coincident: false, points: uniquePoints(points, tolerance) } as const
}

function lineCurveIntersections(line: ProfileLineCurve, curve: ProfileCurve, tolerance: number) {
  if (curve.type === "line") return lineLineIntersections(line, curve, tolerance)
  if (curve.type === "ellipse" || curve.type === "elliptical-arc") {
    return lineEllipseIntersections(line, curve, tolerance)
  }
  return lineRoundIntersections(line, curve, tolerance)
}

function ellipseCurveIntersections(
  ellipse: ProfileEllipseLikeCurve,
  curve: Exclude<ProfileCurve, { type: "line" }>,
  tolerance: number,
) {
  return sampledCurveIntersections(ellipse, curve, tolerance)
}

export function curveIntersections(left: ProfileCurve, right: ProfileCurve, tolerance: number) {
  if (left.type === "line") return lineCurveIntersections(left, right, tolerance)
  if (right.type === "line") return lineCurveIntersections(right, left, tolerance)
  if (left.type === "ellipse" || left.type === "elliptical-arc") {
    return ellipseCurveIntersections(left, right, tolerance)
  }
  if (right.type === "ellipse" || right.type === "elliptical-arc") {
    return ellipseCurveIntersections(right, left, tolerance)
  }
  return roundRoundIntersections(left, right, tolerance)
}

export function isCurveEndpoint(curve: ProfileCurve, point: ProfilePoint, tolerance: number) {
  return (
    curve.type !== "circle" &&
    curve.type !== "ellipse" &&
    (distance(curve.start, point) <= tolerance || distance(curve.end, point) <= tolerance)
  )
}

export function curveStartAngle(
  curve: Exclude<ProfileCurve, { type: "circle" | "ellipse" }>,
  reversed: boolean,
) {
  if (curve.type === "line") {
    const start = reversed ? curve.end : curve.start
    const end = reversed ? curve.start : curve.end
    return Math.atan2(end.y - start.y, end.x - start.x)
  }
  if (curve.type === "elliptical-arc") {
    const parameter = reversed ? curve.startParameter + curve.sweep : curve.startParameter
    const cosine = Math.cos(curve.rotationRadians)
    const sine = Math.sin(curve.rotationRadians)
    const localX = -curve.primaryRadius * Math.sin(parameter)
    const localY = curve.secondarySign * curve.secondaryRadius * Math.cos(parameter)
    const direction = reversed ? -1 : 1
    return Math.atan2(
      direction * (localX * sine + localY * cosine),
      direction * (localX * cosine - localY * sine),
    )
  }
  const angle = reversed ? curve.startAngle + curve.sweep : curve.startAngle
  return angle + (reversed ? -Math.PI / 2 : Math.PI / 2)
}

export function curveAreaContribution(curve: ProfileCurve, reversed: boolean) {
  if (curve.type === "line") {
    const start = reversed ? curve.end : curve.start
    const end = reversed ? curve.start : curve.end
    return cross(start, end) / 2
  }
  if (curve.type === "ellipse") {
    return Math.PI * curve.primaryRadius * curve.secondaryRadius * (reversed ? -1 : 1)
  }
  if (curve.type === "elliptical-arc") {
    const start = reversed ? curve.startParameter + curve.sweep : curve.startParameter
    const delta = reversed ? -curve.sweep : curve.sweep
    const end = start + delta
    const cosine = Math.cos(curve.rotationRadians)
    const sine = Math.sin(curve.rotationRadians)
    const primaryDirection = { x: cosine, y: sine }
    const secondaryDirection = {
      x: -curve.secondarySign * sine,
      y: curve.secondarySign * cosine,
    }
    const integral =
      curve.primaryRadius *
        cross(curve.center, primaryDirection) *
        (Math.cos(end) - Math.cos(start)) +
      curve.secondaryRadius *
        cross(curve.center, secondaryDirection) *
        (Math.sin(end) - Math.sin(start)) +
      curve.primaryRadius * curve.secondaryRadius * curve.secondarySign * delta
    return integral / 2
  }
  const start = reversed ? curve.startAngle + curve.sweep : curve.startAngle
  const delta = reversed ? -curve.sweep : curve.sweep
  const end = start + delta
  const integral =
    curve.radius * curve.center.x * (Math.sin(end) - Math.sin(start)) -
    curve.radius * curve.center.y * (Math.cos(end) - Math.cos(start)) +
    curve.radius ** 2 * delta
  return integral / 2
}

export function curveLength(curve: ProfileCurve) {
  if (curve.type === "line") return distance(curve.start, curve.end)
  if (curve.type !== "ellipse" && curve.type !== "elliptical-arc") {
    return curve.radius * curve.sweep
  }
  const segments = 256
  const sweep = curve.type === "ellipse" ? TWO_PI : curve.sweep
  const start = curve.type === "ellipse" ? 0 : curve.startParameter
  const step = sweep / segments
  let total = 0
  for (let index = 0; index < segments; index += 1) {
    const angle = start + (index + 0.5) * step
    total += Math.hypot(
      curve.primaryRadius * Math.sin(angle),
      curve.secondaryRadius * Math.cos(angle),
    )
  }
  return total * step
}

export function sampleCurve(curve: ProfileCurve, reversed: boolean) {
  if (curve.type === "line") return [reversed ? curve.end : curve.start]
  if (curve.type === "ellipse") {
    const segmentCount = 96
    return Array.from({ length: segmentCount }, (_, index) =>
      pointOnEllipseAt(curve, ((reversed ? -1 : 1) * TWO_PI * index) / segmentCount),
    )
  }
  if (curve.type === "elliptical-arc") {
    const segmentCount = Math.max(4, Math.ceil((curve.sweep / TWO_PI) * 96))
    const start = reversed ? curve.startParameter + curve.sweep : curve.startParameter
    const delta = (reversed ? -curve.sweep : curve.sweep) / segmentCount
    return Array.from({ length: segmentCount }, (_, index) =>
      pointOnEllipseAt(curve, start + delta * index),
    )
  }
  const segmentCount = Math.max(4, Math.ceil((curve.sweep / TWO_PI) * 64))
  const start = reversed ? curve.startAngle + curve.sweep : curve.startAngle
  const delta = (reversed ? -curve.sweep : curve.sweep) / segmentCount
  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = start + delta * index
    return {
      x: curve.center.x + curve.radius * Math.cos(angle),
      y: curve.center.y + curve.radius * Math.sin(angle),
    }
  })
}
