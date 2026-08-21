import type { SketchEntityId } from "./identifiers"
import { type SketchPoint2, type SketchPointTarget, sketchLineIntersection } from "./sketch-edit"

export type SketchInferencePoint = SketchPoint2 & Readonly<{ id: SketchEntityId }>

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

export type SketchPointRelationInference =
  | Readonly<{ lineId: SketchEntityId; type: "midpoint" }>
  | Readonly<{ lineId: SketchEntityId; type: "point-on-line" }>

export type SketchDirectionInference =
  | Readonly<{ type: "horizontal" | "vertical" }>
  | Readonly<{ lineId: SketchEntityId; type: "parallel" | "perpendicular" }>
  | Readonly<{ arcId: SketchEntityId; type: "tangent" }>

export type SketchPointInferenceKind =
  | "coincident"
  | "intersection"
  | "midpoint"
  | "none"
  | "point-on-line"

export type SketchPointInference = Readonly<{
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
  const pointBuckets = new Map<string, Point[]>()
  const overflowLines: SketchInferenceLine[] = []
  for (const point of input.points) {
    addSpatialCandidate(
      pointBuckets,
      spatialCellKey(spatialCell(point.x, input.cellSize), spatialCell(point.y, input.cellSize)),
      point,
    )
  }
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
    const pointRadius = Math.max(0, Math.ceil(tolerance / input.cellSize))
    return {
      lines: [...linesById.values()],
      points: queriedSpatialCandidates(pointBuckets, point, pointRadius, input.cellSize),
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

function nearestMidpointCandidate(
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

function pointCandidate(
  point: SketchPoint2,
  lines: readonly SketchInferenceLine[],
  tolerance: number,
) {
  const nearby = nearbyLines(point, lines, tolerance)
  return (
    nearestIntersectionCandidate(point, nearby, tolerance) ??
    nearestMidpointCandidate(point, lines, tolerance) ??
    nearestPointOnLineCandidate(nearby)
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
  return {
    direction: null,
    kind: "coincident",
    point: { x: snappedPoint.x, y: snappedPoint.y },
    relations: [],
    target: { kind: "existing", pointId: snappedPoint.id },
  }
}

function candidateDirection(input: Parameters<typeof inferSketchPoint>[0], point: SketchPoint2) {
  if (!input.anchor) return null
  const directionInput = {
    anchor: input.anchor,
    arcs: input.arcs ?? [],
    lines: input.lines ?? [],
    point,
    tolerance: input.tolerance,
  }
  return input.anchorPointId
    ? inferredDirection({ ...directionInput, anchorPointId: input.anchorPointId })
    : inferredDirection(directionInput)
}

function candidatePointInference(candidate: PointCandidate): SketchPointInference {
  return {
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
  const candidate = pointCandidate(input.point, input.lines ?? [], input.tolerance)
  if (candidate) return candidatePointInference(candidate)
  const direction = candidateDirection(input, input.point)
  return direction ? directionPointInference(direction) : plainPointInference(input.point)
}

export function inferSketchPoint(input: {
  anchor?: SketchPoint2
  anchorPointId?: SketchEntityId
  arcs?: readonly SketchInferenceArc[]
  lines?: readonly SketchInferenceLine[]
  point: SketchPoint2
  points: readonly SketchInferencePoint[]
  tolerance: number
}): SketchPointInference {
  requireInferenceTolerance(input.tolerance)
  const snappedPoint = nearestPoint(input.point, input.points, input.tolerance)
  return snappedPoint ? coincidentInference(snappedPoint) : newPointInference(input)
}
