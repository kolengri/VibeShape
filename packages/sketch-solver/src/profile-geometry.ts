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

export type ProfileEllipseCurve = CurveEnvelope &
  Readonly<{
    center: ProfilePoint
    primaryRadius: number
    secondaryRadius: number
    rotationRadians: number
    start: ProfilePoint
    end: ProfilePoint
    type: "ellipse"
  }>

export type ProfileCurve = ProfileEllipseCurve | ProfileLineCurve | ProfileRoundCurve

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

function pointOnEllipseAt(curve: ProfileEllipseCurve, angle: number) {
  const cosine = Math.cos(curve.rotationRadians)
  const sine = Math.sin(curve.rotationRadians)
  const primary = curve.primaryRadius * Math.cos(angle)
  const secondary = curve.secondaryRadius * Math.sin(angle)
  return {
    x: curve.center.x + primary * cosine - secondary * sine,
    y: curve.center.y + primary * sine + secondary * cosine,
  }
}

function lineEllipseIntersections(
  line: ProfileLineCurve,
  ellipse: ProfileEllipseCurve,
  tolerance: number,
) {
  const cosine = Math.cos(ellipse.rotationRadians)
  const sine = Math.sin(ellipse.rotationRadians)
  const local = (point: ProfilePoint) => {
    const x = point.x - ellipse.center.x
    const y = point.y - ellipse.center.y
    return { x: x * cosine + y * sine, y: -x * sine + y * cosine }
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
  return { coincident: false, points: uniquePoints(points, tolerance) } as const
}

function ellipseQuadratic(curve: ProfileEllipseCurve) {
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
  left: ProfileEllipseCurve,
  right: ProfileEllipseCurve,
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

function sampledCurvePoints(curve: ProfileEllipseCurve | ProfileRoundCurve) {
  const count = 256
  if (curve.type === "ellipse") {
    return Array.from({ length: count + 1 }, (_, index) =>
      pointOnEllipseAt(curve, (TWO_PI * index) / count),
    )
  }
  return Array.from({ length: count + 1 }, (_, index) => pointOnRoundCurveAt(curve, index / count))
}

function sampledCurveSegments(curve: ProfileEllipseCurve | ProfileRoundCurve) {
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
  left: ProfileEllipseCurve | ProfileRoundCurve,
  right: ProfileEllipseCurve | ProfileRoundCurve,
  tolerance: number,
) {
  if (
    left.type === "ellipse" &&
    right.type === "ellipse" &&
    ellipsesCoincident(left, right, tolerance)
  ) {
    return { coincident: true, points: [] } as const
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
  if (curve.type === "ellipse") return lineEllipseIntersections(line, curve, tolerance)
  return lineRoundIntersections(line, curve, tolerance)
}

function ellipseCurveIntersections(
  ellipse: ProfileEllipseCurve,
  curve: Exclude<ProfileCurve, { type: "line" }>,
  tolerance: number,
) {
  return sampledCurveIntersections(ellipse, curve, tolerance)
}

export function curveIntersections(left: ProfileCurve, right: ProfileCurve, tolerance: number) {
  if (left.type === "line") return lineCurveIntersections(left, right, tolerance)
  if (right.type === "line") return lineCurveIntersections(right, left, tolerance)
  if (left.type === "ellipse") return ellipseCurveIntersections(left, right, tolerance)
  if (right.type === "ellipse") return ellipseCurveIntersections(right, left, tolerance)
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
  if (curve.type !== "ellipse") return curve.radius * curve.sweep
  const segments = 256
  const step = TWO_PI / segments
  let total = 0
  for (let index = 0; index < segments; index += 1) {
    const angle = (index + 0.5) * step
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
