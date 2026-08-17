import type { SketchEntityId } from "@vibeshape/domain/identifiers"
import type { SketchEntity, SketchRecord } from "@vibeshape/domain/sketch"
import {
  boundsOverlap,
  curveAreaContribution,
  curveIntersections,
  curveLength,
  curveStartAngle,
  distance,
  ellipseBounds,
  ellipticalArcBounds,
  isCurveEndpoint,
  type ProfileBounds,
  type ProfileCurve,
  type ProfilePoint,
  pointBounds,
  pointOnRoundCurve,
  pointOnRoundCurveAt,
  positiveSweep,
  roundBounds,
  sampleCurve,
} from "./profile-geometry"

export const DEFAULT_PROFILE_TOLERANCE_MM = 1e-7
export const MAX_PROFILE_CURVES = 2_000
export const MAX_PROFILE_DIAGNOSTICS = 2_000
export const MAX_PROFILE_DIAGNOSTIC_ENTITY_IDS = 64

export type SketchProfileDiagnosticCode =
  | "invalid-solution"
  | "profile-budget-exceeded"
  | "degenerate-entity"
  | "duplicate-entity"
  | "intersecting-entities"
  | "open-chain"

export type SketchProfileDiagnostic = Readonly<{
  code: SketchProfileDiagnosticCode
  message: string
  entityIds: readonly SketchEntityId[]
}>

export type SketchProfileLoopSegment = Readonly<{
  entityId: SketchEntityId
  type: "line" | "arc" | "circle" | "ellipse" | "elliptical-arc"
  reversed: boolean
}>

export type SketchProfileLoop = Readonly<{
  loopIndex: number
  parentLoopIndex: number | null
  depth: number
  signedArea: number
  perimeter: number
  bounds: ProfileBounds
  sourceEntityIds: readonly SketchEntityId[]
  segments: readonly SketchProfileLoopSegment[]
}>

export type SketchProfile = Readonly<{
  profileIndex: number
  outerLoopIndex: number
  holeLoopIndices: readonly number[]
  area: number
  perimeter: number
  bounds: ProfileBounds
}>

export type SketchProfileResult = Readonly<{
  schemaVersion: 0
  profiles: readonly SketchProfile[]
  loops: readonly SketchProfileLoop[]
  diagnostics: readonly SketchProfileDiagnostic[]
}>

export type SketchProfileSolution = Readonly<{
  points: readonly Readonly<{ entityId: SketchEntityId; x: number; y: number }>[]
  circles: readonly Readonly<{ entityId: SketchEntityId; radius: number }>[]
}>

type RawLoop = Readonly<{
  signedArea: number
  perimeter: number
  bounds: ProfileBounds
  sourceEntityIds: readonly SketchEntityId[]
  segments: readonly SketchProfileLoopSegment[]
  samples: readonly ProfilePoint[]
}>

type GraphEdge = Readonly<{
  curve: Exclude<ProfileCurve, { type: "circle" | "ellipse" }>
  startVertex: number
  endVertex: number
}>

type HalfEdge = Readonly<{
  id: number
  edgeIndex: number
  fromVertex: number
  toVertex: number
  reversed: boolean
  angle: number
}>

function profileDiagnostic(
  code: SketchProfileDiagnosticCode,
  message: string,
  entityIds: readonly SketchEntityId[],
): SketchProfileDiagnostic {
  return {
    code,
    message,
    entityIds: [...new Set(entityIds)].sort().slice(0, MAX_PROFILE_DIAGNOSTIC_ENTITY_IDS),
  }
}

function pointFor(points: ReadonlyMap<SketchEntityId, ProfilePoint>, entityId: SketchEntityId) {
  return points.get(entityId) ?? null
}

function lineCurve(
  entity: Extract<SketchEntity, { type: "line" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
) {
  const start = pointFor(points, entity.startPointId)
  const end = pointFor(points, entity.endPointId)
  if (!start || !end) return null
  return {
    entityId: entity.id,
    type: "line",
    start,
    end,
    bounds: pointBounds([start, end]),
  } satisfies ProfileCurve
}

function circleCurve(
  entity: Extract<SketchEntity, { type: "circle" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
  radii: ReadonlyMap<SketchEntityId, number>,
) {
  const center = pointFor(points, entity.centerPointId)
  const radius = radii.get(entity.id)
  if (!center || !radius) return null
  const start = { x: center.x + radius, y: center.y }
  return {
    entityId: entity.id,
    type: "circle",
    center,
    radius,
    startAngle: 0,
    sweep: Math.PI * 2,
    start,
    end: start,
    bounds: roundBounds(center, radius),
  } satisfies ProfileCurve
}

function arcCurve(
  entity: Extract<SketchEntity, { type: "arc" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
  tolerance: number,
) {
  const center = pointFor(points, entity.centerPointId)
  const start = pointFor(points, entity.startPointId)
  const end = pointFor(points, entity.endPointId)
  if (!center || !start || !end) return null
  const startRadius = distance(center, start)
  const endRadius = distance(center, end)
  if (
    startRadius <= tolerance ||
    endRadius <= tolerance ||
    Math.abs(startRadius - endRadius) > tolerance
  ) {
    return null
  }
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  const radius = (startRadius + endRadius) / 2
  return {
    entityId: entity.id,
    type: "arc",
    center,
    radius,
    startAngle,
    sweep: positiveSweep(startAngle, endAngle),
    start,
    end,
    bounds: roundBounds(center, radius),
  } satisfies ProfileCurve
}

function ellipseCurve(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
  tolerance: number,
) {
  const center = pointFor(points, entity.centerPointId)
  const primaryAxisPoint = pointFor(points, entity.primaryAxisPointId)
  const secondaryAxisPoint = pointFor(points, entity.secondaryAxisPointId)
  if (!center || !primaryAxisPoint || !secondaryAxisPoint) return null
  const primaryRadius = distance(center, primaryAxisPoint)
  const secondaryRadius = distance(center, secondaryAxisPoint)
  if (primaryRadius <= tolerance || secondaryRadius <= tolerance) return null
  const primaryX = primaryAxisPoint.x - center.x
  const primaryY = primaryAxisPoint.y - center.y
  const secondaryX = secondaryAxisPoint.x - center.x
  const secondaryY = secondaryAxisPoint.y - center.y
  if (
    Math.abs((primaryX * secondaryX + primaryY * secondaryY) / (primaryRadius * secondaryRadius)) >
    tolerance
  ) {
    return null
  }
  const rotationRadians = Math.atan2(primaryY, primaryX)
  return {
    entityId: entity.id,
    type: "ellipse",
    center,
    primaryRadius,
    secondarySign: 1,
    secondaryRadius,
    rotationRadians,
    start: primaryAxisPoint,
    end: primaryAxisPoint,
    bounds: ellipseBounds(center, primaryRadius, secondaryRadius, rotationRadians),
  } satisfies ProfileCurve
}

type EllipticalArcProfilePoints = Readonly<{
  center: ProfilePoint
  end: ProfilePoint
  primaryAxisPoint: ProfilePoint
  secondaryAxisPoint: ProfilePoint
  start: ProfilePoint
}>

function ellipticalArcProfilePoints(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
): EllipticalArcProfilePoints | null {
  const center = pointFor(points, entity.centerPointId)
  const primaryAxisPoint = pointFor(points, entity.primaryAxisPointId)
  const secondaryAxisPoint = pointFor(points, entity.secondaryAxisPointId)
  const start = pointFor(points, entity.startPointId)
  const end = pointFor(points, entity.endPointId)
  return center && primaryAxisPoint && secondaryAxisPoint && start && end
    ? { center, end, primaryAxisPoint, secondaryAxisPoint, start }
    : null
}

function ellipticalArcProfileFrame(points: EllipticalArcProfilePoints, tolerance: number) {
  const primaryRadius = distance(points.center, points.primaryAxisPoint)
  const secondaryRadius = distance(points.center, points.secondaryAxisPoint)
  if (Math.min(primaryRadius, secondaryRadius) <= tolerance) return null
  const primary = {
    x: (points.primaryAxisPoint.x - points.center.x) / primaryRadius,
    y: (points.primaryAxisPoint.y - points.center.y) / primaryRadius,
  }
  const secondary = {
    x: (points.secondaryAxisPoint.x - points.center.x) / secondaryRadius,
    y: (points.secondaryAxisPoint.y - points.center.y) / secondaryRadius,
  }
  if (Math.abs(primary.x * secondary.x + primary.y * secondary.y) > tolerance) return null
  return {
    primary,
    primaryRadius,
    rotationRadians: Math.atan2(primary.y, primary.x),
    secondary,
    secondaryRadius,
    secondarySign: (primary.x * secondary.y - primary.y * secondary.x < 0 ? -1 : 1) as -1 | 1,
  }
}

function ellipticalArcProfileParameter(
  center: ProfilePoint,
  frame: NonNullable<ReturnType<typeof ellipticalArcProfileFrame>>,
  point: ProfilePoint,
) {
  const offset = { x: point.x - center.x, y: point.y - center.y }
  return Math.atan2(
    (offset.x * frame.secondary.x + offset.y * frame.secondary.y) / frame.secondaryRadius,
    (offset.x * frame.primary.x + offset.y * frame.primary.y) / frame.primaryRadius,
  )
}

function ellipticalArcProfilePointAt(
  center: ProfilePoint,
  frame: NonNullable<ReturnType<typeof ellipticalArcProfileFrame>>,
  parameter: number,
) {
  return {
    x:
      center.x +
      frame.primaryRadius * Math.cos(parameter) * frame.primary.x +
      frame.secondaryRadius * Math.sin(parameter) * frame.secondary.x,
    y:
      center.y +
      frame.primaryRadius * Math.cos(parameter) * frame.primary.y +
      frame.secondaryRadius * Math.sin(parameter) * frame.secondary.y,
  }
}

function ellipticalArcCurve(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
  tolerance: number,
) {
  const resolved = ellipticalArcProfilePoints(entity, points)
  if (!resolved || distance(resolved.start, resolved.end) <= tolerance) return null
  const frame = ellipticalArcProfileFrame(resolved, tolerance)
  if (!frame) return null
  const startParameter = ellipticalArcProfileParameter(resolved.center, frame, resolved.start)
  const endParameter = ellipticalArcProfileParameter(resolved.center, frame, resolved.end)
  const endpointResidual = Math.max(
    distance(resolved.start, ellipticalArcProfilePointAt(resolved.center, frame, startParameter)),
    distance(resolved.end, ellipticalArcProfilePointAt(resolved.center, frame, endParameter)),
  )
  if (endpointResidual > tolerance) return null
  const curveWithoutBounds = {
    entityId: entity.id,
    type: "elliptical-arc",
    center: resolved.center,
    primaryRadius: frame.primaryRadius,
    secondaryRadius: frame.secondaryRadius,
    secondarySign: frame.secondarySign,
    rotationRadians: frame.rotationRadians,
    startParameter,
    sweep: positiveSweep(startParameter, endParameter),
    start: resolved.start,
    end: resolved.end,
  } as const
  return {
    ...curveWithoutBounds,
    bounds: ellipticalArcBounds(curveWithoutBounds),
  } satisfies ProfileCurve
}

function entityCurve(
  entity: Exclude<SketchEntity, { type: "point" }>,
  points: ReadonlyMap<SketchEntityId, ProfilePoint>,
  radii: ReadonlyMap<SketchEntityId, number>,
  tolerance: number,
) {
  if (entity.type === "line") return lineCurve(entity, points)
  if (entity.type === "circle") return circleCurve(entity, points, radii)
  if (entity.type === "arc") return arcCurve(entity, points, tolerance)
  if (entity.type === "ellipse") return ellipseCurve(entity, points, tolerance)
  return ellipticalArcCurve(entity, points, tolerance)
}

function collectCurves(sketch: SketchRecord, solution: SketchProfileSolution, tolerance: number) {
  const diagnostics: SketchProfileDiagnostic[] = []
  const points = new Map(solution.points.map(({ entityId, x, y }) => [entityId, { x, y }] as const))
  const radii = new Map(solution.circles.map(({ entityId, radius }) => [entityId, radius] as const))
  const curves: ProfileCurve[] = []
  for (const entity of sketch.entities) {
    if (entity.type === "point" || entity.construction) continue
    const curve = entityCurve(entity, points, radii, tolerance)
    if (!curve || curveLength(curve) <= tolerance) {
      diagnostics.push(
        profileDiagnostic(
          "degenerate-entity",
          "A profile entity is missing solved values or has degenerate geometry.",
          [entity.id],
        ),
      )
      continue
    }
    curves.push(curve)
  }
  curves.sort((left, right) => left.entityId.localeCompare(right.entityId))
  return { curves, diagnostics }
}

function hasUniqueEntityIds(values: readonly Readonly<{ entityId: SketchEntityId }>[]) {
  return new Set(values.map(({ entityId }) => entityId)).size === values.length
}

function profileSolutionIsValid(solution: SketchProfileSolution) {
  return (
    hasUniqueEntityIds(solution.points) &&
    hasUniqueEntityIds(solution.circles) &&
    solution.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) &&
    solution.circles.every(({ radius }) => Number.isFinite(radius) && radius > 0)
  )
}

function coincidentCurvesOverlap(
  left: Exclude<ProfileCurve, { type: "line" }>,
  right: Exclude<ProfileCurve, { type: "line" }>,
  tolerance: number,
) {
  if (
    left.type === "ellipse" ||
    left.type === "elliptical-arc" ||
    right.type === "ellipse" ||
    right.type === "elliptical-arc"
  ) {
    return true
  }
  if (left.type === "circle" || right.type === "circle") return true
  const leftMiddle = pointOnRoundCurveAt(left, 0.5)
  const rightMiddle = pointOnRoundCurveAt(right, 0.5)
  return (
    pointOnRoundCurve(right, leftMiddle, tolerance) ||
    pointOnRoundCurve(left, rightMiddle, tolerance)
  )
}

function intersectionIsOnlySharedEndpoints(
  left: ProfileCurve,
  right: ProfileCurve,
  points: readonly ProfilePoint[],
  tolerance: number,
) {
  return (
    points.length > 0 &&
    points.every(
      (point) =>
        isCurveEndpoint(left, point, tolerance) && isCurveEndpoint(right, point, tolerance),
    )
  )
}

function curvesHaveAmbiguousCoincidence(
  left: ProfileCurve,
  right: ProfileCurve,
  coincident: boolean,
  tolerance: number,
) {
  if (!coincident) return false
  if (left.type === "line" || right.type === "line") return true
  if (
    left.type === "ellipse" ||
    left.type === "elliptical-arc" ||
    right.type === "ellipse" ||
    right.type === "elliptical-arc"
  ) {
    return true
  }
  return coincidentCurvesOverlap(left, right, tolerance)
}

type CurvePairClassification = Extract<
  SketchProfileDiagnosticCode,
  "duplicate-entity" | "intersecting-entities"
>

function classifyCurvePair(
  left: ProfileCurve,
  right: ProfileCurve,
  tolerance: number,
): CurvePairClassification | null {
  if (!boundsOverlap(left.bounds, right.bounds, tolerance)) return null
  const intersection = curveIntersections(left, right, tolerance)
  if (curvesHaveAmbiguousCoincidence(left, right, intersection.coincident, tolerance)) {
    return "duplicate-entity"
  }
  if (
    intersection.points.length > 0 &&
    !intersectionIsOnlySharedEndpoints(left, right, intersection.points, tolerance)
  ) {
    return "intersecting-entities"
  }
  return null
}

function curvePairDiagnostic(
  classification: CurvePairClassification,
  left: ProfileCurve,
  right: ProfileCurve,
) {
  return profileDiagnostic(
    classification,
    classification === "duplicate-entity"
      ? "Coincident or overlapping profile entities are ambiguous."
      : "Profile entities intersect away from shared endpoints and require splitting.",
    [left.entityId, right.entityId],
  )
}

function classifyCurvePairs(curves: readonly ProfileCurve[], tolerance: number) {
  const blocked = new Set<number>()
  const diagnostics: SketchProfileDiagnostic[] = []
  for (let leftIndex = 0; leftIndex < curves.length; leftIndex += 1) {
    const left = curves[leftIndex]
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < curves.length; rightIndex += 1) {
      const right = curves[rightIndex]
      const classification = right ? classifyCurvePair(left, right, tolerance) : null
      if (!right || !classification) continue
      blocked.add(leftIndex)
      blocked.add(rightIndex)
      if (diagnostics.length < MAX_PROFILE_DIAGNOSTICS) {
        diagnostics.push(curvePairDiagnostic(classification, left, right))
      }
    }
  }
  return { blocked, diagnostics }
}

function assignVertices(
  curves: readonly Exclude<ProfileCurve, { type: "circle" | "ellipse" }>[],
  tolerance: number,
) {
  const endpointVertices = new Map<string, number>()
  const vertices: ProfilePoint[] = []
  const grid = new Map<string, number[]>()
  const endpoints = curves
    .flatMap((curve) => [
      { key: `${curve.entityId}:start`, point: curve.start },
      { key: `${curve.entityId}:end`, point: curve.end },
    ])
    .sort(
      (left, right) =>
        left.point.x - right.point.x ||
        left.point.y - right.point.y ||
        left.key.localeCompare(right.key),
    )
  for (const endpoint of endpoints) {
    const gridX = Math.floor(endpoint.point.x / tolerance)
    const gridY = Math.floor(endpoint.point.y / tolerance)
    const candidates = [-1, 0, 1].flatMap((offsetX) =>
      [-1, 0, 1].flatMap((offsetY) => grid.get(`${gridX + offsetX}:${gridY + offsetY}`) ?? []),
    )
    const existing = candidates
      .filter((index) => {
        const vertex = vertices[index]
        return vertex !== undefined && distance(vertex, endpoint.point) <= tolerance
      })
      .sort((left, right) => left - right)[0]
    if (existing !== undefined) {
      endpointVertices.set(endpoint.key, existing)
      continue
    }
    const vertexIndex = vertices.length
    vertices.push(endpoint.point)
    endpointVertices.set(endpoint.key, vertexIndex)
    const gridKey = `${gridX}:${gridY}`
    grid.set(gridKey, [...(grid.get(gridKey) ?? []), vertexIndex])
  }
  return { endpointVertices, vertices }
}

function buildGraphEdges(
  curves: readonly Exclude<ProfileCurve, { type: "circle" | "ellipse" }>[],
  tolerance: number,
) {
  const { endpointVertices } = assignVertices(curves, tolerance)
  const diagnostics: SketchProfileDiagnostic[] = []
  const edges: GraphEdge[] = []
  for (const curve of curves) {
    const startVertex = endpointVertices.get(`${curve.entityId}:start`)
    const endVertex = endpointVertices.get(`${curve.entityId}:end`)
    if (startVertex === undefined || endVertex === undefined || startVertex === endVertex) {
      diagnostics.push(
        profileDiagnostic(
          "degenerate-entity",
          "A profile entity collapses to one tolerance vertex.",
          [curve.entityId],
        ),
      )
      continue
    }
    edges.push({ curve, startVertex, endVertex })
  }
  return { edges, diagnostics }
}

function createHalfEdges(edges: readonly GraphEdge[]) {
  const halfEdges: HalfEdge[] = []
  const outgoing = new Map<number, HalfEdge[]>()
  for (const [edgeIndex, edge] of edges.entries()) {
    for (const reversed of [false, true]) {
      const halfEdge = {
        id: edgeIndex * 2 + Number(reversed),
        edgeIndex,
        fromVertex: reversed ? edge.endVertex : edge.startVertex,
        toVertex: reversed ? edge.startVertex : edge.endVertex,
        reversed,
        angle: curveStartAngle(edge.curve, reversed),
      }
      halfEdges.push(halfEdge)
      outgoing.set(halfEdge.fromVertex, [...(outgoing.get(halfEdge.fromVertex) ?? []), halfEdge])
    }
  }
  for (const [vertex, values] of outgoing) {
    outgoing.set(
      vertex,
      values.sort(
        (left, right) =>
          left.angle - right.angle ||
          edges[left.edgeIndex]?.curve.entityId.localeCompare(
            edges[right.edgeIndex]?.curve.entityId ?? "",
          ) ||
          Number(left.reversed) - Number(right.reversed),
      ),
    )
  }
  return { halfEdges, outgoing }
}

function nextHalfEdge(halfEdge: HalfEdge, outgoing: ReadonlyMap<number, readonly HalfEdge[]>) {
  const candidates = outgoing.get(halfEdge.toVertex) ?? []
  const twinId = halfEdge.edgeIndex * 2 + Number(!halfEdge.reversed)
  const twinIndex = candidates.findIndex(({ id }) => id === twinId)
  if (twinIndex < 0 || candidates.length === 0) return null
  return candidates[(twinIndex - 1 + candidates.length) % candidates.length] ?? null
}

function rawLoopFromHalfEdges(cycle: readonly HalfEdge[], edges: readonly GraphEdge[]) {
  const segments = cycle.flatMap((halfEdge) => {
    const curve = edges[halfEdge.edgeIndex]?.curve
    return curve
      ? [{ entityId: curve.entityId, type: curve.type, reversed: halfEdge.reversed } as const]
      : []
  })
  const curves = cycle.flatMap((halfEdge) => {
    const curve = edges[halfEdge.edgeIndex]?.curve
    return curve ? [{ curve, reversed: halfEdge.reversed }] : []
  })
  const samples = curves.flatMap(({ curve, reversed }) => sampleCurve(curve, reversed))
  return {
    signedArea: curves.reduce(
      (total, { curve, reversed }) => total + curveAreaContribution(curve, reversed),
      0,
    ),
    perimeter: curves.reduce((total, { curve }) => total + curveLength(curve), 0),
    bounds: pointBounds(samples),
    sourceEntityIds: [...new Set(segments.map(({ entityId }) => entityId))],
    segments,
    samples,
  } satisfies RawLoop
}

function traceHalfEdgeCycle(
  start: HalfEdge,
  visited: Set<number>,
  outgoing: ReadonlyMap<number, readonly HalfEdge[]>,
) {
  const cycle: HalfEdge[] = []
  let current: HalfEdge | null = start
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    cycle.push(current)
    current = nextHalfEdge(current, outgoing)
  }
  return current?.id === start.id ? cycle : []
}

function extractGraphLoops(edges: readonly GraphEdge[], tolerance: number) {
  const { halfEdges, outgoing } = createHalfEdges(edges)
  const visited = new Set<number>()
  const usedEdges = new Set<number>()
  const loops: RawLoop[] = []
  for (const start of halfEdges) {
    if (visited.has(start.id)) continue
    const cycle = traceHalfEdgeCycle(start, visited, outgoing)
    if (cycle.length === 0) continue
    const loop = rawLoopFromHalfEdges(cycle, edges)
    if (loop.signedArea <= tolerance ** 2) continue
    loops.push(loop)
    for (const halfEdge of cycle) usedEdges.add(halfEdge.edgeIndex)
  }
  const openEntityIds = edges.flatMap((edge, index) =>
    usedEdges.has(index) ? [] : [edge.curve.entityId],
  )
  return { loops, openEntityIds }
}

function closedCurveLoop(curve: Extract<ProfileCurve, { type: "circle" | "ellipse" }>): RawLoop {
  const samples = sampleCurve(curve, false)
  return {
    signedArea: curveAreaContribution(curve, false),
    perimeter: curveLength(curve),
    bounds: curve.bounds,
    sourceEntityIds: [curve.entityId],
    segments: [{ entityId: curve.entityId, type: curve.type, reversed: false }],
    samples,
  }
}

function pointInPolygon(point: ProfilePoint, polygon: readonly ProfilePoint[]) {
  let inside = false
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    if (!currentPoint || !previousPoint) continue
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    if (crosses) inside = !inside
  }
  return inside
}

function closedCurveInteriorPoint(loop: RawLoop) {
  const type = loop.segments[0]?.type
  if (loop.segments.length !== 1 || (type !== "circle" && type !== "ellipse")) return null
  const first = loop.samples[0]
  const opposite = loop.samples[Math.floor(loop.samples.length / 2)]
  return first && opposite ? { x: (first.x + opposite.x) / 2, y: (first.y + opposite.y) / 2 } : null
}

function edgeInteriorPoint(
  loop: RawLoop,
  start: ProfilePoint,
  end: ProfilePoint,
  tolerance: number,
) {
  const length = distance(start, end)
  if (length <= tolerance) return null
  const scale = Math.max(
    loop.bounds.maxX - loop.bounds.minX,
    loop.bounds.maxY - loop.bounds.minY,
    1,
  )
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  for (const factor of [1e-6, 1e-8, 1e-10]) {
    const offset = Math.max(tolerance * 2, scale * factor)
    const candidate = {
      x: midpoint.x - ((end.y - start.y) / length) * offset,
      y: midpoint.y + ((end.x - start.x) / length) * offset,
    }
    if (pointInPolygon(candidate, loop.samples)) return candidate
  }
  return null
}

function loopInteriorPoint(loop: RawLoop, tolerance: number) {
  const closedCurvePoint = closedCurveInteriorPoint(loop)
  if (closedCurvePoint) return closedCurvePoint
  for (let index = 0; index < loop.samples.length; index += 1) {
    const start = loop.samples[index]
    const end = loop.samples[(index + 1) % loop.samples.length]
    if (!start || !end) continue
    const candidate = edgeInteriorPoint(loop, start, end, tolerance)
    if (candidate) return candidate
  }
  return loop.samples[0] ?? { x: 0, y: 0 }
}

function compareRawLoops(left: RawLoop, right: RawLoop) {
  return (
    Math.abs(right.signedArea) - Math.abs(left.signedArea) ||
    left.sourceEntityIds.join(":").localeCompare(right.sourceEntityIds.join(":"))
  )
}

function finalizeProfiles(rawLoops: readonly RawLoop[], tolerance: number) {
  const sorted = [...rawLoops].sort(compareRawLoops)
  const parents: Array<number | null> = sorted.map(() => null)
  const depths: number[] = sorted.map(() => 0)
  for (let index = 0; index < sorted.length; index += 1) {
    const loop = sorted[index]
    if (!loop) continue
    const sample = loopInteriorPoint(loop, tolerance)
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = sorted[candidateIndex]
      if (candidate && pointInPolygon(sample, candidate.samples)) {
        parents[index] = candidateIndex
        depths[index] = (depths[candidateIndex] ?? 0) + 1
        break
      }
    }
  }
  const loops: SketchProfileLoop[] = sorted.map((loop, loopIndex) => ({
    loopIndex,
    parentLoopIndex: parents[loopIndex] ?? null,
    depth: depths[loopIndex] ?? 0,
    signedArea: loop.signedArea,
    perimeter: loop.perimeter,
    bounds: loop.bounds,
    sourceEntityIds: loop.sourceEntityIds,
    segments: loop.segments,
  }))
  const profiles = loops
    .filter(({ depth }) => depth % 2 === 0)
    .map((outer, profileIndex) => {
      const holes = loops.filter(
        ({ parentLoopIndex, depth }) =>
          parentLoopIndex === outer.loopIndex && depth === outer.depth + 1,
      )
      return {
        profileIndex,
        outerLoopIndex: outer.loopIndex,
        holeLoopIndices: holes.map(({ loopIndex }) => loopIndex),
        area: outer.signedArea - holes.reduce((total, hole) => total + hole.signedArea, 0),
        perimeter: outer.perimeter + holes.reduce((total, hole) => total + hole.perimeter, 0),
        bounds: outer.bounds,
      }
    })
  return { loops, profiles }
}

export function detectSketchProfiles(
  sketch: SketchRecord,
  solution: SketchProfileSolution,
  tolerance = DEFAULT_PROFILE_TOLERANCE_MM,
): SketchProfileResult {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || !profileSolutionIsValid(solution)) {
    return {
      schemaVersion: 0,
      profiles: [],
      loops: [],
      diagnostics: [
        profileDiagnostic(
          "invalid-solution",
          "Profile tolerance and solved values must be finite, positive where required, and unique.",
          [],
        ),
      ],
    }
  }
  const collected = collectCurves(sketch, solution, tolerance)
  if (collected.curves.length > MAX_PROFILE_CURVES) {
    return {
      schemaVersion: 0,
      profiles: [],
      loops: [],
      diagnostics: [
        ...collected.diagnostics,
        profileDiagnostic(
          "profile-budget-exceeded",
          `Profile detection supports at most ${MAX_PROFILE_CURVES} non-construction curves.`,
          collected.curves.map(({ entityId }) => entityId),
        ),
      ],
    }
  }
  const classified = classifyCurvePairs(collected.curves, tolerance)
  const available = collected.curves.filter((_, index) => !classified.blocked.has(index))
  const closedCurves = available.filter(
    (curve): curve is Extract<ProfileCurve, { type: "circle" | "ellipse" }> =>
      curve.type === "circle" || curve.type === "ellipse",
  )
  const openCurves = available.filter(
    (curve): curve is Exclude<ProfileCurve, { type: "circle" | "ellipse" }> =>
      curve.type !== "circle" && curve.type !== "ellipse",
  )
  const graph = buildGraphEdges(openCurves, tolerance)
  const extracted = extractGraphLoops(graph.edges, tolerance)
  const diagnostics = [...collected.diagnostics, ...classified.diagnostics, ...graph.diagnostics]
  if (extracted.openEntityIds.length > 0) {
    diagnostics.push(
      profileDiagnostic(
        "open-chain",
        "Profile entities do not participate in a closed bounded loop.",
        extracted.openEntityIds,
      ),
    )
  }
  const finalized = finalizeProfiles(
    [...extracted.loops, ...closedCurves.map(closedCurveLoop)],
    tolerance,
  )
  return {
    schemaVersion: 0,
    profiles: finalized.profiles,
    loops: finalized.loops,
    diagnostics: diagnostics.slice(0, MAX_PROFILE_DIAGNOSTICS),
  }
}
