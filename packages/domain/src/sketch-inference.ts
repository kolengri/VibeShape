import type { SketchEntityId } from "./identifiers"
import { type SketchPoint2, type SketchPointTarget, sketchLineIntersection } from "./sketch-edit"

export type SketchInferencePoint = SketchPoint2 &
  Readonly<{
    id: SketchEntityId
    /** False when the point is a read-only reference and must be related instead of reused. */
    reusable?: boolean
  }>

export type SketchInferenceLine = Readonly<{
  end: SketchPoint2
  endPointId: SketchEntityId
  id: SketchEntityId
  start: SketchPoint2
  startPointId: SketchEntityId
}>

export type SketchInferenceArc = Readonly<{
  center: SketchPoint2
  endPointId: SketchEntityId
  id: SketchEntityId
  startPointId: SketchEntityId
}>

export type SketchInferenceCurve =
  | Readonly<{
      center: SketchPoint2
      centerPointId: SketchEntityId
      id: SketchEntityId
      radius: number
      type: "circle"
    }>
  | Readonly<{
      center: SketchPoint2
      centerPointId: SketchEntityId
      end: SketchPoint2
      id: SketchEntityId
      start: SketchPoint2
      type: "arc"
    }>

export type SketchPointRelationInference =
  | Readonly<{ pointId: SketchEntityId; type: "coincident" }>
  | Readonly<{ pointId: SketchEntityId; type: "horizontal-points" }>
  | Readonly<{ pointId: SketchEntityId; type: "vertical-points" }>
  | Readonly<{ lineId: SketchEntityId; type: "midpoint" }>
  | Readonly<{ arcId: SketchEntityId; type: "arc-midpoint" }>
  | Readonly<{ lineId: SketchEntityId; type: "point-on-line" }>
  | Readonly<{ curveId: SketchEntityId; type: "point-on-curve" }>

export type SketchDirectionInference =
  | Readonly<{ type: "horizontal" | "vertical" }>
  | Readonly<{ lineId: SketchEntityId; type: "parallel" | "perpendicular" }>
  | Readonly<{ arcId: SketchEntityId; type: "tangent" }>

export type SketchPointInferenceKind =
  | "coincident"
  | "horizontal-alignment"
  | "intersection"
  | "midpoint"
  | "none"
  | "point-on-curve"
  | "point-on-line"
  | "quadrant"
  | "vertical-alignment"

export type SketchPointInference = Readonly<{
  alignmentGuide?: SketchPoint2
  direction: SketchDirectionInference | null
  kind: SketchPointInferenceKind
  point: SketchPoint2
  relations: readonly SketchPointRelationInference[]
  target: SketchPointTarget
}>

export type SketchInferenceCandidateQuery<
  Point extends SketchInferencePoint = SketchInferencePoint,
> = (
  point: SketchPoint2,
  tolerance: number,
) => Readonly<{
  lines: readonly SketchInferenceLine[]
  points: readonly Point[]
}>

const MAX_INDEXED_LINE_CELLS = 256
const MAX_SPATIAL_INDEX_LEVELS = 32

type PointCandidate = Readonly<{
  alignmentGuide?: SketchPoint2
  kind: Exclude<SketchPointInferenceKind, "coincident" | "none">
  point: SketchPoint2
  relations: readonly SketchPointRelationInference[]
  stableKey: string
}>

type DirectionCandidate = Readonly<{
  direction: SketchDirectionInference
  error: number
  point: SketchPoint2
  priority: number
  stableKey: string
}>

function squaredDistance(first: SketchPoint2, second: SketchPoint2) {
  const x = first.x - second.x
  const y = first.y - second.y
  return x * x + y * y
}

function requireInferenceTolerance(tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("Sketch inference tolerance must be a finite non-negative distance.")
  }
}

function spatialCell(value: number, cellSize: number) {
  return Math.floor(value / cellSize)
}

function spatialCellKey(x: number, y: number) {
  return `${x}:${y}`
}

function addSpatialCandidate<Candidate>(
  buckets: Map<string, Candidate[]>,
  key: string,
  candidate: Candidate,
) {
  const bucket = buckets.get(key)
  if (bucket) bucket.push(candidate)
  else buckets.set(key, [candidate])
}

type SpatialSegmentTraversal = {
  cellX: number
  cellY: number
  deltaTX: number
  deltaTY: number
  endCellX: number
  endCellY: number
  maximumTX: number
  maximumTY: number
  stepX: number
  stepY: number
}

function spatialAxisTraversal(start: number, end: number, cell: number, cellSize: number) {
  const delta = end - start
  const step = Math.sign(delta)
  if (step === 0) {
    return { deltaT: Number.POSITIVE_INFINITY, maximumT: Number.POSITIVE_INFINITY, step }
  }
  const nextBoundary = (step > 0 ? cell + 1 : cell) * cellSize
  return {
    deltaT: cellSize / Math.abs(delta),
    maximumT: (nextBoundary - start) / delta,
    step,
  }
}

function createSpatialSegmentTraversal(line: SketchInferenceLine, cellSize: number) {
  const cellX = spatialCell(line.start.x, cellSize)
  const cellY = spatialCell(line.start.y, cellSize)
  const x = spatialAxisTraversal(line.start.x, line.end.x, cellX, cellSize)
  const y = spatialAxisTraversal(line.start.y, line.end.y, cellY, cellSize)
  return {
    cellX,
    cellY,
    deltaTX: x.deltaT,
    deltaTY: y.deltaT,
    endCellX: spatialCell(line.end.x, cellSize),
    endCellY: spatialCell(line.end.y, cellSize),
    maximumTX: x.maximumT,
    maximumTY: y.maximumT,
    stepX: x.step,
    stepY: y.step,
  }
}

function advanceSpatialSegment(traversal: SpatialSegmentTraversal) {
  const advanceX = traversal.maximumTX <= traversal.maximumTY
  const advanceY = traversal.maximumTY <= traversal.maximumTX
  if (advanceX) {
    traversal.cellX += traversal.stepX
    traversal.maximumTX += traversal.deltaTX
  }
  if (advanceY) {
    traversal.cellY += traversal.stepY
    traversal.maximumTY += traversal.deltaTY
  }
}

function segmentSpatialCells(line: SketchInferenceLine, cellSize: number) {
  const traversal = createSpatialSegmentTraversal(line, cellSize)
  const cells: string[] = []

  while (cells.length <= MAX_INDEXED_LINE_CELLS) {
    cells.push(spatialCellKey(traversal.cellX, traversal.cellY))
    if (traversal.cellX === traversal.endCellX && traversal.cellY === traversal.endCellY)
      return cells
    advanceSpatialSegment(traversal)
  }

  return null
}

function queriedSpatialCandidates<Candidate extends Readonly<{ id: SketchEntityId }>>(
  buckets: ReadonlyMap<string, readonly Candidate[]>,
  point: SketchPoint2,
  radius: number,
  cellSize: number,
) {
  const centerX = spatialCell(point.x, cellSize)
  const centerY = spatialCell(point.y, cellSize)
  const candidates = new Map<SketchEntityId, Candidate>()
  for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      const bucket = buckets.get(spatialCellKey(centerX + offsetX, centerY + offsetY))
      if (!bucket) continue
      for (const candidate of bucket) candidates.set(candidate.id, candidate)
    }
  }
  return [...candidates.values()]
}

function sortedAxisCandidates<Point extends SketchInferencePoint>(
  points: readonly Point[],
  axis: "x" | "y",
) {
  return [...points].sort(
    (left, right) => left[axis] - right[axis] || left.id.localeCompare(right.id),
  )
}

function lowerBoundByAxis<Point extends SketchInferencePoint>(
  points: readonly Point[],
  axis: "x" | "y",
  value: number,
) {
  let lower = 0
  let upper = points.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if ((points[middle]?.[axis] ?? Number.POSITIVE_INFINITY) < value) lower = middle + 1
    else upper = middle
  }
  return lower
}

function queriedAxisCandidates<Point extends SketchInferencePoint>(
  points: readonly Point[],
  axis: "x" | "y",
  value: number,
  tolerance: number,
) {
  const candidates: Point[] = []
  for (
    let index = lowerBoundByAxis(points, axis, value - tolerance);
    index < points.length &&
    (points[index]?.[axis] ?? Number.POSITIVE_INFINITY) <= value + tolerance;
    index += 1
  ) {
    const candidate = points[index]
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

function indexedLineCells(line: SketchInferenceLine, baseCellSize: number) {
  let cellSize = baseCellSize
  for (let level = 0; level < MAX_SPATIAL_INDEX_LEVELS; level += 1) {
    const cells = segmentSpatialCells(line, cellSize)
    if (cells) return { cells, cellSize }
    cellSize *= 4
    if (!Number.isFinite(cellSize)) break
  }
  return null
}

export function createSketchInferenceCandidateQuery<Point extends SketchInferencePoint>(input: {
  cellSize: number
  lines: readonly SketchInferenceLine[]
  points: readonly Point[]
}): SketchInferenceCandidateQuery<Point> {
  if (!Number.isFinite(input.cellSize) || input.cellSize <= 0) {
    return (_point, tolerance) => {
      requireInferenceTolerance(tolerance)
      return { lines: input.lines, points: input.points }
    }
  }
  const lineBucketsByCellSize = new Map<number, Map<string, SketchInferenceLine[]>>()
  const pointsByX = sortedAxisCandidates(input.points, "x")
  const pointsByY = sortedAxisCandidates(input.points, "y")
  const overflowLines: SketchInferenceLine[] = []
  for (const line of input.lines) {
    const indexed = indexedLineCells(line, input.cellSize)
    if (!indexed) {
      overflowLines.push(line)
      continue
    }
    let buckets = lineBucketsByCellSize.get(indexed.cellSize)
    if (!buckets) {
      buckets = new Map()
      lineBucketsByCellSize.set(indexed.cellSize, buckets)
    }
    for (const cell of indexed.cells) addSpatialCandidate(buckets, cell, line)
  }

  return (point, tolerance) => {
    requireInferenceTolerance(tolerance)
    const linesById = new Map<SketchEntityId, SketchInferenceLine>()
    for (const [cellSize, buckets] of lineBucketsByCellSize) {
      const radius = Math.max(0, Math.ceil(tolerance / cellSize))
      for (const line of queriedSpatialCandidates(buckets, point, radius, cellSize)) {
        linesById.set(line.id, line)
      }
    }
    for (const line of overflowLines) linesById.set(line.id, line)
    const pointsById = new Map<SketchEntityId, Point>()
    for (const candidate of queriedAxisCandidates(pointsByX, "x", point.x, tolerance)) {
      pointsById.set(candidate.id, candidate)
    }
    for (const candidate of queriedAxisCandidates(pointsByY, "y", point.y, tolerance)) {
      pointsById.set(candidate.id, candidate)
    }
    return {
      lines: [...linesById.values()],
      points: [...pointsById.values()],
    }
  }
}

function nearestPoint(
  point: SketchPoint2,
  points: readonly SketchInferencePoint[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  let nearest: SketchInferencePoint | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const candidate of points) {
    const distance = squaredDistance(point, candidate)
    if (distance > maximumDistance) continue
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && candidate.id.localeCompare(nearest?.id ?? "") < 0)
    ) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}

function lineProjection(point: SketchPoint2, line: SketchInferenceLine) {
  const lineX = line.end.x - line.start.x
  const lineY = line.end.y - line.start.y
  const lengthSquared = lineX * lineX + lineY * lineY
  if (lengthSquared === 0) return null
  const parameter =
    ((point.x - line.start.x) * lineX + (point.y - line.start.y) * lineY) / lengthSquared
  const clampedParameter = Math.min(1, Math.max(0, parameter))
  const projected = {
    x: line.start.x + lineX * clampedParameter,
    y: line.start.y + lineY * clampedParameter,
  }
  return {
    distanceSquared: squaredDistance(point, projected),
    parameter,
    point: projected,
  }
}

function nearbyLines(
  point: SketchPoint2,
  lines: readonly SketchInferenceLine[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  const nearby: Array<{
    line: SketchInferenceLine
    projection: NonNullable<ReturnType<typeof lineProjection>>
  }> = []
  const compare = (left: (typeof nearby)[number], right: (typeof nearby)[number]) =>
    left.projection.distanceSquared - right.projection.distanceSquared ||
    left.line.id.localeCompare(right.line.id)
  for (const line of lines) {
    const projection = lineProjection(point, line)
    if (
      !projection ||
      projection.parameter < 0 ||
      projection.parameter > 1 ||
      projection.distanceSquared > maximumDistance
    ) {
      continue
    }
    const candidate = { line, projection }
    const insertionIndex = nearby.findIndex((current) => compare(candidate, current) < 0)
    if (insertionIndex < 0) {
      if (nearby.length < 16) nearby.push(candidate)
      continue
    }
    nearby.splice(insertionIndex, 0, candidate)
    if (nearby.length > 16) nearby.pop()
  }
  return nearby
}

function segmentIntersection(first: SketchInferenceLine, second: SketchInferenceLine) {
  const intersection = sketchLineIntersection(first.start, first.end, second.start, second.end)
  if (
    !intersection ||
    intersection.firstParameter < 0 ||
    intersection.firstParameter > 1 ||
    intersection.secondParameter < 0 ||
    intersection.secondParameter > 1
  ) {
    return null
  }
  return intersection.point
}

function intersectionCandidate(
  first: SketchInferenceLine,
  second: SketchInferenceLine,
): PointCandidate | null {
  const point = segmentIntersection(first, second)
  if (!point) return null
  const [firstLineId, secondLineId] = [first.id, second.id].sort()
  return {
    kind: "intersection",
    point,
    relations: [
      { type: "point-on-line", lineId: firstLineId as SketchEntityId },
      { type: "point-on-line", lineId: secondLineId as SketchEntityId },
    ],
    stableKey: `${firstLineId}:${secondLineId}`,
  }
}

function shouldPreferCandidate(
  candidate: PointCandidate,
  distance: number,
  nearest: PointCandidate | undefined,
  nearestDistance: number,
  maximumDistance: number,
) {
  if (distance > maximumDistance || distance > nearestDistance) return false
  if (distance < nearestDistance) return true
  return candidate.stableKey.localeCompare(nearest?.stableKey ?? "") < 0
}

function nearestIntersectionCandidate(
  cursor: SketchPoint2,
  lines: ReturnType<typeof nearbyLines>,
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  let nearest: PointCandidate | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let firstIndex = 0; firstIndex < lines.length; firstIndex += 1) {
    const first = lines[firstIndex]?.line
    if (!first) continue
    for (let secondIndex = firstIndex + 1; secondIndex < lines.length; secondIndex += 1) {
      const second = lines[secondIndex]?.line
      if (!second) continue
      const candidate = intersectionCandidate(first, second)
      if (!candidate) continue
      const distance = squaredDistance(cursor, candidate.point)
      if (!shouldPreferCandidate(candidate, distance, nearest, nearestDistance, maximumDistance)) {
        continue
      }
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}

function nearestLineMidpointCandidate(
  point: SketchPoint2,
  lines: readonly SketchInferenceLine[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  let nearest: PointCandidate | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const midpoint = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }
    const distance = squaredDistance(point, midpoint)
    if (
      distance > maximumDistance ||
      distance > nearestDistance ||
      (distance === nearestDistance && line.id.localeCompare(nearest?.stableKey ?? "") >= 0)
    ) {
      continue
    }
    nearest = {
      kind: "midpoint",
      point: midpoint,
      relations: [{ type: "midpoint", lineId: line.id }],
      stableKey: line.id,
    }
    nearestDistance = distance
  }
  return nearest
}

function nearestArcMidpointCandidate(
  point: SketchPoint2,
  curves: readonly SketchInferenceCurve[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  const midpoint = { x: 0, y: 0 }
  let nearestCurve: SketchInferenceCurve | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  let nearestX = 0
  let nearestY = 0
  for (const curve of curves) {
    if (!writeArcMidpoint(curve, midpoint)) continue
    const distance = squaredDistance(point, midpoint)
    if (!preferArcMidpoint(curve, distance, maximumDistance, nearestCurve, nearestDistance))
      continue
    nearestCurve = curve
    nearestDistance = distance
    nearestX = midpoint.x
    nearestY = midpoint.y
  }
  return nearestCurve
    ? {
        kind: "midpoint" as const,
        point: { x: nearestX, y: nearestY },
        relations: [{ type: "arc-midpoint" as const, arcId: nearestCurve.id }],
        stableKey: nearestCurve.id,
      }
    : undefined
}

function writeArcMidpoint(curve: SketchInferenceCurve, midpoint: { x: number; y: number }) {
  if (curve.type !== "arc") return false
  const radius = Math.hypot(curve.start.x - curve.center.x, curve.start.y - curve.center.y)
  if (!Number.isFinite(radius) || radius <= 0) return false
  const startAngle = Math.atan2(curve.start.y - curve.center.y, curve.start.x - curve.center.x)
  const endAngle = Math.atan2(curve.end.y - curve.center.y, curve.end.x - curve.center.x)
  const midpointAngle = startAngle + positiveAngle(endAngle - startAngle) / 2
  midpoint.x = curve.center.x + Math.cos(midpointAngle) * radius
  midpoint.y = curve.center.y + Math.sin(midpointAngle) * radius
  return true
}

function preferArcMidpoint(
  curve: SketchInferenceCurve,
  distance: number,
  maximumDistance: number,
  nearestCurve: SketchInferenceCurve | null,
  nearestDistance: number,
) {
  if (distance > maximumDistance || distance > nearestDistance) return false
  if (distance < nearestDistance || !nearestCurve) return true
  return curve.id.localeCompare(nearestCurve.id) < 0
}

function nearestPointOnLineCandidate(lines: ReturnType<typeof nearbyLines>) {
  const nearest = lines[0]
  return nearest
    ? {
        kind: "point-on-line" as const,
        point: nearest.projection.point,
        relations: [{ type: "point-on-line" as const, lineId: nearest.line.id }],
        stableKey: nearest.line.id,
      }
    : undefined
}

const FULL_TURN = Math.PI * 2

function positiveAngle(angle: number) {
  const normalized = angle % FULL_TURN
  return normalized >= 0 ? normalized : normalized + FULL_TURN
}

function curveProjection(point: SketchPoint2, curve: SketchInferenceCurve) {
  const offsetX = point.x - curve.center.x
  const offsetY = point.y - curve.center.y
  const offsetLength = Math.hypot(offsetX, offsetY)
  const radius =
    curve.type === "circle"
      ? curve.radius
      : Math.hypot(curve.start.x - curve.center.x, curve.start.y - curve.center.y)
  if (!Number.isFinite(radius) || radius <= 0 || offsetLength <= 1e-12) return null
  const angle = Math.atan2(offsetY, offsetX)
  if (curve.type === "arc") {
    const startAngle = Math.atan2(curve.start.y - curve.center.y, curve.start.x - curve.center.x)
    const endAngle = Math.atan2(curve.end.y - curve.center.y, curve.end.x - curve.center.x)
    if (positiveAngle(angle - startAngle) > positiveAngle(endAngle - startAngle) + 1e-12) {
      return null
    }
  }
  const projected = {
    x: curve.center.x + (offsetX / offsetLength) * radius,
    y: curve.center.y + (offsetY / offsetLength) * radius,
  }
  return { distanceSquared: squaredDistance(point, projected), point: projected }
}

function nearestPointOnCurveCandidate(
  point: SketchPoint2,
  curves: readonly SketchInferenceCurve[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  let nearest:
    | Readonly<{
        curve: SketchInferenceCurve
        projection: NonNullable<ReturnType<typeof curveProjection>>
      }>
    | undefined
  for (const curve of curves) {
    const projection = curveProjection(point, curve)
    if (!projection || projection.distanceSquared > maximumDistance) continue
    if (
      !nearest ||
      projection.distanceSquared < nearest.projection.distanceSquared ||
      (projection.distanceSquared === nearest.projection.distanceSquared &&
        curve.id.localeCompare(nearest.curve.id) < 0)
    ) {
      nearest = { curve, projection }
    }
  }
  return nearest
    ? {
        kind: "point-on-curve" as const,
        point: nearest.projection.point,
        relations: [{ type: "point-on-curve" as const, curveId: nearest.curve.id }],
        stableKey: nearest.curve.id,
      }
    : undefined
}

const cardinalDirections = [
  { alignmentType: "horizontal-points", angle: 0, xScale: 1, yScale: 0 },
  { alignmentType: "vertical-points", angle: Math.PI / 2, xScale: 0, yScale: 1 },
  { alignmentType: "horizontal-points", angle: Math.PI, xScale: -1, yScale: 0 },
  { alignmentType: "vertical-points", angle: (Math.PI * 3) / 2, xScale: 0, yScale: -1 },
] as const

function curveRadius(curve: SketchInferenceCurve) {
  return curve.type === "circle"
    ? curve.radius
    : Math.hypot(curve.start.x - curve.center.x, curve.start.y - curve.center.y)
}

function curveContainsAngle(curve: SketchInferenceCurve, angle: number) {
  if (curve.type === "circle") return true
  const startAngle = Math.atan2(curve.start.y - curve.center.y, curve.start.x - curve.center.x)
  const endAngle = Math.atan2(curve.end.y - curve.center.y, curve.end.x - curve.center.x)
  return positiveAngle(angle - startAngle) <= positiveAngle(endAngle - startAngle) + 1e-12
}

function materializeCurveCardinalCandidate(
  curve: SketchInferenceCurve,
  direction: (typeof cardinalDirections)[number],
  index: number,
  point: SketchPoint2,
): PointCandidate {
  return {
    alignmentGuide: curve.center,
    kind: "quadrant",
    point,
    relations: [
      { type: "point-on-curve", curveId: curve.id },
      { type: direction.alignmentType, pointId: curve.centerPointId },
    ],
    stableKey: `${curve.id}:${index}`,
  }
}

function cardinalIdentityIsEarlier(
  curve: SketchInferenceCurve,
  index: number,
  nearestCurve: SketchInferenceCurve,
  nearestIndex: number,
) {
  const curveOrder = curve.id.localeCompare(nearestCurve.id)
  return curveOrder < 0 || (curveOrder === 0 && index < nearestIndex)
}

type NearestCurveCardinal = {
  curve: SketchInferenceCurve | null
  direction: (typeof cardinalDirections)[number] | null
  distance: number
  index: number
  x: number
  y: number
}

function shouldReplaceCurveCardinal(
  curve: SketchInferenceCurve,
  index: number,
  distance: number,
  maximumDistance: number,
  nearest: NearestCurveCardinal,
) {
  if (distance > maximumDistance || distance > nearest.distance) return false
  if (distance < nearest.distance) return true
  return !nearest.curve || cardinalIdentityIsEarlier(curve, index, nearest.curve, nearest.index)
}

function considerCurveCardinal(
  point: SketchPoint2,
  curve: SketchInferenceCurve,
  radius: number,
  direction: (typeof cardinalDirections)[number],
  index: number,
  maximumDistance: number,
  nearest: NearestCurveCardinal,
) {
  if (!curveContainsAngle(curve, direction.angle)) return
  const x = curve.center.x + direction.xScale * radius
  const y = curve.center.y + direction.yScale * radius
  const distance = (point.x - x) ** 2 + (point.y - y) ** 2
  if (!shouldReplaceCurveCardinal(curve, index, distance, maximumDistance, nearest)) return
  nearest.curve = curve
  nearest.direction = direction
  nearest.distance = distance
  nearest.index = index
  nearest.x = x
  nearest.y = y
}

function nearestCurveCardinalCandidate(
  point: SketchPoint2,
  curves: readonly SketchInferenceCurve[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  const nearest: NearestCurveCardinal = {
    curve: null,
    direction: null,
    distance: Number.POSITIVE_INFINITY,
    index: -1,
    x: 0,
    y: 0,
  }
  for (const curve of curves) {
    const radius = curveRadius(curve)
    if (!Number.isFinite(radius) || radius <= 0) continue
    for (let index = 0; index < cardinalDirections.length; index += 1) {
      const direction = cardinalDirections[index]
      if (direction) {
        considerCurveCardinal(point, curve, radius, direction, index, maximumDistance, nearest)
      }
    }
  }
  return nearest.curve && nearest.direction
    ? materializeCurveCardinalCandidate(nearest.curve, nearest.direction, nearest.index, {
        x: nearest.x,
        y: nearest.y,
      })
    : undefined
}

type PointAlignmentCandidate = Readonly<{
  error: number
  kind: "horizontal-alignment" | "vertical-alignment"
  point: SketchPoint2
  relation: "horizontal-points" | "vertical-points"
  span: number
  target: SketchInferencePoint
}>

function pointAlignmentCandidates(
  point: SketchPoint2,
  target: SketchInferencePoint,
): readonly PointAlignmentCandidate[] {
  return [
    {
      error: Math.abs(point.y - target.y),
      kind: "horizontal-alignment",
      point: { x: point.x, y: target.y },
      relation: "horizontal-points",
      span: Math.abs(point.x - target.x),
      target,
    },
    {
      error: Math.abs(point.x - target.x),
      kind: "vertical-alignment",
      point: { x: target.x, y: point.y },
      relation: "vertical-points",
      span: Math.abs(point.y - target.y),
      target,
    },
  ]
}

function comparePointAlignmentCandidates(
  left: PointAlignmentCandidate,
  right: PointAlignmentCandidate,
) {
  return (
    left.error - right.error ||
    left.span - right.span ||
    `${left.kind}:${left.target.id}`.localeCompare(`${right.kind}:${right.target.id}`)
  )
}

function preferredPointAlignmentCandidate(
  current: PointAlignmentCandidate | undefined,
  candidate: PointAlignmentCandidate | undefined,
) {
  if (!candidate) return current
  return !current || comparePointAlignmentCandidates(candidate, current) < 0 ? candidate : current
}

function pointAlignmentCandidateForTarget(
  point: SketchPoint2,
  target: SketchInferencePoint,
  tolerance: number,
) {
  return pointAlignmentCandidates(point, target)
    .filter((candidate) => candidate.error <= tolerance)
    .reduce<PointAlignmentCandidate | undefined>(preferredPointAlignmentCandidate, undefined)
}

function nearestPointAlignmentCandidate(
  point: SketchPoint2,
  points: readonly SketchInferencePoint[],
  tolerance: number,
  anchor?: SketchPoint2,
) {
  let nearest: PointAlignmentCandidate | undefined
  for (const target of points) {
    if (anchor && squaredDistance(anchor, target) <= 1e-24) continue
    nearest = preferredPointAlignmentCandidate(
      nearest,
      pointAlignmentCandidateForTarget(point, target, tolerance),
    )
  }
  return nearest
    ? {
        alignmentGuide: { x: nearest.target.x, y: nearest.target.y },
        kind: nearest.kind,
        point: nearest.point,
        relations: [{ type: nearest.relation, pointId: nearest.target.id }],
        stableKey: nearest.target.id,
      }
    : undefined
}

function pointCandidate(
  point: SketchPoint2,
  points: readonly SketchInferencePoint[],
  lines: readonly SketchInferenceLine[],
  curves: readonly SketchInferenceCurve[],
  tolerance: number,
  anchor?: SketchPoint2,
) {
  const nearby = nearbyLines(point, lines, tolerance)
  return (
    nearestIntersectionCandidate(point, nearby, tolerance) ??
    nearestLineMidpointCandidate(point, lines, tolerance) ??
    nearestPointOnLineCandidate(nearby) ??
    nearestArcMidpointCandidate(point, curves, tolerance) ??
    nearestCurveCardinalCandidate(point, curves, tolerance) ??
    nearestPointOnCurveCandidate(point, curves, tolerance) ??
    nearestPointAlignmentCandidate(point, points, tolerance, anchor)
  )
}

function directionCandidate(
  anchor: SketchPoint2,
  point: SketchPoint2,
  direction: SketchPoint2,
  inference: SketchDirectionInference,
  priority: number,
  stableKey: string,
): DirectionCandidate | null {
  const length = Math.hypot(direction.x, direction.y)
  if (length === 0) return null
  const unitX = direction.x / length
  const unitY = direction.y / length
  const offsetX = point.x - anchor.x
  const offsetY = point.y - anchor.y
  const projection = offsetX * unitX + offsetY * unitY
  return {
    direction: inference,
    error: Math.abs(offsetX * unitY - offsetY * unitX),
    point: { x: anchor.x + projection * unitX, y: anchor.y + projection * unitY },
    priority,
    stableKey,
  }
}

function axisAligned(line: SketchInferenceLine) {
  const x = Math.abs(line.end.x - line.start.x)
  const y = Math.abs(line.end.y - line.start.y)
  const length = Math.hypot(x, y)
  return length > 0 && Math.min(x, y) / length <= 1e-6
}

function eligibleDirectionLines(
  anchorPointId: SketchEntityId | undefined,
  point: SketchPoint2,
  lines: readonly SketchInferenceLine[],
  tolerance: number,
) {
  const nearbyIds = new Set(nearbyLines(point, lines, tolerance * 2).map(({ line }) => line.id))
  return lines.filter(
    (line) =>
      nearbyIds.has(line.id) ||
      line.startPointId === anchorPointId ||
      line.endPointId === anchorPointId,
  )
}

function lineDirectionCandidates(input: {
  anchor: SketchPoint2
  anchorPointId?: SketchEntityId
  arcs: readonly SketchInferenceArc[]
  lines: readonly SketchInferenceLine[]
  point: SketchPoint2
  tolerance: number
}) {
  const candidates = [
    directionCandidate(
      input.anchor,
      input.point,
      { x: 1, y: 0 },
      { type: "horizontal" },
      1,
      "horizontal",
    ),
    directionCandidate(
      input.anchor,
      input.point,
      { x: 0, y: 1 },
      { type: "vertical" },
      1,
      "vertical",
    ),
  ]
  for (const arc of input.arcs) {
    if (arc.startPointId !== input.anchorPointId && arc.endPointId !== input.anchorPointId) continue
    const radius = { x: input.anchor.x - arc.center.x, y: input.anchor.y - arc.center.y }
    candidates.push(
      directionCandidate(
        input.anchor,
        input.point,
        { x: -radius.y, y: radius.x },
        { type: "tangent", arcId: arc.id },
        0,
        `tangent:${arc.id}`,
      ),
    )
  }
  for (const line of eligibleDirectionLines(
    input.anchorPointId,
    input.point,
    input.lines,
    input.tolerance,
  )) {
    if (axisAligned(line)) continue
    const direction = { x: line.end.x - line.start.x, y: line.end.y - line.start.y }
    candidates.push(
      directionCandidate(
        input.anchor,
        input.point,
        direction,
        { type: "parallel", lineId: line.id },
        3,
        `parallel:${line.id}`,
      ),
      directionCandidate(
        input.anchor,
        input.point,
        { x: -direction.y, y: direction.x },
        { type: "perpendicular", lineId: line.id },
        2,
        `perpendicular:${line.id}`,
      ),
    )
  }
  return candidates.flatMap((candidate) => (candidate ? [candidate] : []))
}

function inferredDirection(input: {
  anchor: SketchPoint2
  anchorPointId?: SketchEntityId
  arcs: readonly SketchInferenceArc[]
  lines: readonly SketchInferenceLine[]
  point: SketchPoint2
  tolerance: number
}) {
  return lineDirectionCandidates(input)
    .filter((candidate) => candidate.error <= input.tolerance)
    .sort(
      (left, right) =>
        left.error - right.error ||
        left.priority - right.priority ||
        left.stableKey.localeCompare(right.stableKey),
    )[0]
}

function coincidentInference(snappedPoint: SketchInferencePoint): SketchPointInference {
  const point = { x: snappedPoint.x, y: snappedPoint.y }
  if (snappedPoint.reusable === false) {
    return {
      direction: null,
      kind: "coincident",
      point,
      relations: [{ type: "coincident", pointId: snappedPoint.id }],
      target: { kind: "new", point },
    }
  }
  return {
    direction: null,
    kind: "coincident",
    point,
    relations: [],
    target: { kind: "existing", pointId: snappedPoint.id },
  }
}

function candidateDirection(input: Parameters<typeof inferSketchPoint>[0], point: SketchPoint2) {
  if (!input.anchor) return null
  const directionInput = {
    anchor: input.anchor,
    arcs: input.arcs ?? [],
    lines: input.directionLines ?? input.lines ?? [],
    point,
    tolerance: input.tolerance,
  }
  return input.anchorPointId
    ? inferredDirection({ ...directionInput, anchorPointId: input.anchorPointId })
    : inferredDirection(directionInput)
}

function candidatePointInference(candidate: PointCandidate): SketchPointInference {
  return {
    ...(candidate.alignmentGuide ? { alignmentGuide: candidate.alignmentGuide } : {}),
    direction: null,
    kind: candidate.kind,
    point: candidate.point,
    relations: candidate.relations,
    target: { kind: "new", point: candidate.point },
  }
}

function directionPointInference(candidate: DirectionCandidate): SketchPointInference {
  return {
    direction: candidate.direction,
    kind: "none",
    point: candidate.point,
    relations: [],
    target: { kind: "new", point: candidate.point },
  }
}

function plainPointInference(point: SketchPoint2): SketchPointInference {
  return {
    direction: null,
    kind: "none",
    point,
    relations: [],
    target: { kind: "new", point },
  }
}

function newPointInference(input: Parameters<typeof inferSketchPoint>[0]): SketchPointInference {
  const candidate = pointCandidate(
    input.point,
    input.points,
    input.lines ?? [],
    input.curves ?? [],
    input.tolerance,
    input.anchor,
  )
  if (candidate) return candidatePointInference(candidate)
  const direction = candidateDirection(input, input.point)
  return direction ? directionPointInference(direction) : plainPointInference(input.point)
}

export function inferSketchPoint(input: {
  anchor?: SketchPoint2
  anchorPointId?: SketchEntityId
  arcs?: readonly SketchInferenceArc[]
  curves?: readonly SketchInferenceCurve[]
  directionLines?: readonly SketchInferenceLine[]
  lines?: readonly SketchInferenceLine[]
  point: SketchPoint2
  points: readonly SketchInferencePoint[]
  tolerance: number
}): SketchPointInference {
  requireInferenceTolerance(input.tolerance)
  const snappedPoint = nearestPoint(input.point, input.points, input.tolerance)
  return snappedPoint ? coincidentInference(snappedPoint) : newPointInference(input)
}
