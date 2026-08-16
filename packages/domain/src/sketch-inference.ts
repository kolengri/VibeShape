import type { SketchEntityId } from "./identifiers"
import type { SketchPoint2, SketchPointTarget } from "./sketch-edit"

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
  const firstX = first.end.x - first.start.x
  const firstY = first.end.y - first.start.y
  const secondX = second.end.x - second.start.x
  const secondY = second.end.y - second.start.y
  const denominator = firstX * secondY - firstY * secondX
  if (Math.abs(denominator) <= Number.EPSILON) return null
  const offsetX = second.start.x - first.start.x
  const offsetY = second.start.y - first.start.y
  const firstParameter = (offsetX * secondY - offsetY * secondX) / denominator
  const secondParameter = (offsetX * firstY - offsetY * firstX) / denominator
  if (firstParameter < 0 || firstParameter > 1 || secondParameter < 0 || secondParameter > 1) {
    return null
  }
  return {
    x: first.start.x + firstX * firstParameter,
    y: first.start.y + firstY * firstParameter,
  }
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
  if (!Number.isFinite(input.tolerance) || input.tolerance < 0) {
    throw new RangeError("Sketch inference tolerance must be a finite non-negative distance.")
  }
  const snappedPoint = nearestPoint(input.point, input.points, input.tolerance)
  return snappedPoint ? coincidentInference(snappedPoint) : newPointInference(input)
}
