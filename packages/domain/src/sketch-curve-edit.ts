import { isString } from "is-what"
import type { SketchConstraintId, SketchEntityId } from "./identifiers"
import {
  type SketchConstraint,
  type SketchEntity,
  type SketchRecord,
  sketchRecordSchema,
} from "./sketch"
import {
  appendSketchConstraint,
  requireSketchPoint,
  type SketchAppendResult,
  type SketchPoint2,
  sketchCurvePointIds,
  sketchLineIntersection,
  splitSketchLine,
} from "./sketch-edit"

type EntityIdFactory = () => SketchEntityId
type ConstraintIdFactory = () => SketchConstraintId
type SketchCurveEntity = Extract<SketchEntity, { type: "arc" | "circle" | "line" }>
type SketchArcEntity = Extract<SketchEntity, { type: "arc" }>
type SketchCircleEntity = Extract<SketchEntity, { type: "circle" }>
type SketchPointEntity = Extract<SketchEntity, { type: "point" }>

type CurveIntersection = Readonly<{
  boundary: SketchCurveEntity
  parameter: number
  point: SketchPoint2
}>

type RoundGeometry = Readonly<{
  center: SketchPointEntity
  radius: number
  startAngle: number
  sweep: number
}>

type ResolvedOperationPoint = Readonly<{
  constrainToBoundary: boolean
  entity: SketchPointEntity | null
  id: SketchEntityId
  point: SketchPoint2
}>

const FULL_TURN = Math.PI * 2
const OPERATION_EPSILON = 1e-7

function distance(first: SketchPoint2, second: SketchPoint2) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function normalizedAngle(angle: number) {
  const normalized = angle % FULL_TURN
  return normalized < 0 ? normalized + FULL_TURN : normalized
}

function positiveSweep(startAngle: number, endAngle: number) {
  return normalizedAngle(endAngle - startAngle)
}

function pointById(sketch: SketchRecord, pointId: SketchEntityId) {
  return requireSketchPoint(sketch, pointId, "A curve operation requires an existing point entity.")
}

function curveById(sketch: SketchRecord, curveId: SketchEntityId) {
  const curve = sketch.entities.find(
    (entity): entity is SketchCurveEntity =>
      entity.id === curveId &&
      (entity.type === "line" || entity.type === "circle" || entity.type === "arc"),
  )
  if (!curve) throw new TypeError("A curve operation must reference an existing curve entity.")
  return curve
}

function linePoints(sketch: SketchRecord, line: Extract<SketchEntity, { type: "line" }>) {
  return {
    end: pointById(sketch, line.endPointId),
    start: pointById(sketch, line.startPointId),
  }
}

function roundGeometry(
  sketch: SketchRecord,
  curve: SketchArcEntity | SketchCircleEntity,
): RoundGeometry {
  const center = pointById(sketch, curve.centerPointId)
  if (curve.type === "circle") {
    return { center, radius: curve.radius, startAngle: 0, sweep: FULL_TURN }
  }
  const start = pointById(sketch, curve.startPointId)
  const end = pointById(sketch, curve.endPointId)
  const startRadius = distance(center, start)
  const endRadius = distance(center, end)
  const scale = Math.max(startRadius, endRadius, 1)
  if (
    startRadius <= OPERATION_EPSILON ||
    Math.abs(startRadius - endRadius) > OPERATION_EPSILON * scale
  ) {
    throw new RangeError("A curve operation requires a circular analytical arc.")
  }
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  return {
    center,
    radius: (startRadius + endRadius) / 2,
    startAngle,
    sweep: positiveSweep(startAngle, Math.atan2(end.y - center.y, end.x - center.x)),
  }
}

function lineParameter(start: SketchPoint2, end: SketchPoint2, point: SketchPoint2) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared <= OPERATION_EPSILON ** 2) {
    throw new RangeError("A curve operation requires a non-degenerate line.")
  }
  return ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
}

function roundParameter(geometry: RoundGeometry, point: SketchPoint2) {
  const angle = Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x)
  return positiveSweep(geometry.startAngle, angle) / FULL_TURN
}

function projectToRound(geometry: RoundGeometry, point: SketchPoint2) {
  const offsetX = point.x - geometry.center.x
  const offsetY = point.y - geometry.center.y
  const offsetLength = Math.hypot(offsetX, offsetY)
  if (offsetLength <= OPERATION_EPSILON) {
    throw new RangeError("A curve operation point cannot coincide with the curve center.")
  }
  return {
    x: geometry.center.x + (offsetX / offsetLength) * geometry.radius,
    y: geometry.center.y + (offsetY / offsetLength) * geometry.radius,
  }
}

function pointOnBoundedCurve(sketch: SketchRecord, curve: SketchCurveEntity, point: SketchPoint2) {
  if (curve.type === "line") {
    const { start, end } = linePoints(sketch, curve)
    const parameter = lineParameter(start, end, point)
    return parameter >= -OPERATION_EPSILON && parameter <= 1 + OPERATION_EPSILON
  }
  if (curve.type === "circle") return true
  const geometry = roundGeometry(sketch, curve)
  return roundParameter(geometry, point) * FULL_TURN <= geometry.sweep + OPERATION_EPSILON
}

function lineRoundIntersections(
  lineStart: SketchPoint2,
  lineEnd: SketchPoint2,
  round: RoundGeometry,
) {
  const directionX = lineEnd.x - lineStart.x
  const directionY = lineEnd.y - lineStart.y
  const centerX = lineStart.x - round.center.x
  const centerY = lineStart.y - round.center.y
  const a = directionX * directionX + directionY * directionY
  if (a <= OPERATION_EPSILON ** 2) return []
  const b = 2 * (centerX * directionX + centerY * directionY)
  const c = centerX * centerX + centerY * centerY - round.radius * round.radius
  const discriminant = b * b - 4 * a * c
  const scale = Math.max(a, round.radius * round.radius, 1)
  if (discriminant < -OPERATION_EPSILON * scale) return []
  const root = Math.sqrt(Math.max(0, discriminant))
  return [...new Set([(-b - root) / (2 * a), (-b + root) / (2 * a)])].map(
    (parameter): SketchPoint2 => ({
      x: lineStart.x + directionX * parameter,
      y: lineStart.y + directionY * parameter,
    }),
  )
}

function roundRoundIntersections(first: RoundGeometry, second: RoundGeometry) {
  const centerDistance = distance(first.center, second.center)
  if (
    centerDistance <= OPERATION_EPSILON ||
    centerDistance > first.radius + second.radius + OPERATION_EPSILON ||
    centerDistance < Math.abs(first.radius - second.radius) - OPERATION_EPSILON
  ) {
    return []
  }
  const along =
    (first.radius * first.radius -
      second.radius * second.radius +
      centerDistance * centerDistance) /
    (2 * centerDistance)
  const height = Math.sqrt(Math.max(0, first.radius * first.radius - along * along))
  const directionX = (second.center.x - first.center.x) / centerDistance
  const directionY = (second.center.y - first.center.y) / centerDistance
  const base = {
    x: first.center.x + directionX * along,
    y: first.center.y + directionY * along,
  }
  const points = [
    { x: base.x - directionY * height, y: base.y + directionX * height },
    { x: base.x + directionY * height, y: base.y - directionX * height },
  ]
  return points.filter(
    (point, index) =>
      points.findIndex((candidate) => distance(point, candidate) <= OPERATION_EPSILON) === index,
  )
}

function supportingIntersections(
  sketch: SketchRecord,
  target: SketchCurveEntity,
  boundary: SketchCurveEntity,
) {
  if (target.type === "line") {
    const targetPoints = linePoints(sketch, target)
    if (boundary.type === "line") {
      const boundaryPoints = linePoints(sketch, boundary)
      const intersection = sketchLineIntersection(
        targetPoints.start,
        targetPoints.end,
        boundaryPoints.start,
        boundaryPoints.end,
      )
      return intersection &&
        intersection.secondParameter >= -OPERATION_EPSILON &&
        intersection.secondParameter <= 1 + OPERATION_EPSILON
        ? [intersection.point]
        : []
    }
    return lineRoundIntersections(
      targetPoints.start,
      targetPoints.end,
      roundGeometry(sketch, boundary),
    ).filter((point) => pointOnBoundedCurve(sketch, boundary, point))
  }
  const targetRound = roundGeometry(sketch, target)
  if (boundary.type === "line") {
    const boundaryPoints = linePoints(sketch, boundary)
    return lineRoundIntersections(boundaryPoints.start, boundaryPoints.end, targetRound).filter(
      (point) => pointOnBoundedCurve(sketch, boundary, point),
    )
  }
  return roundRoundIntersections(targetRound, roundGeometry(sketch, boundary)).filter((point) =>
    pointOnBoundedCurve(sketch, boundary, point),
  )
}

function curveParameter(sketch: SketchRecord, curve: SketchCurveEntity, point: SketchPoint2) {
  if (curve.type === "line") {
    const { start, end } = linePoints(sketch, curve)
    return lineParameter(start, end, point)
  }
  return roundParameter(roundGeometry(sketch, curve), point)
}

function curveIntersections(sketch: SketchRecord, target: SketchCurveEntity) {
  const intersections = sketch.entities.flatMap((entity): CurveIntersection[] => {
    if (
      entity.type === "point" ||
      entity.type === "ellipse" ||
      entity.type === "elliptical-arc" ||
      entity.id === target.id
    ) {
      return []
    }
    return supportingIntersections(sketch, target, entity).map((point) => ({
      boundary: entity,
      parameter: curveParameter(sketch, target, point),
      point,
    }))
  })
  intersections.sort(
    (left, right) =>
      left.parameter - right.parameter || left.boundary.id.localeCompare(right.boundary.id),
  )
  return intersections.filter(
    (intersection, index) =>
      index === 0 ||
      Math.abs(intersection.parameter - (intersections[index - 1]?.parameter ?? 0)) >
        OPERATION_EPSILON,
  )
}

function requiredIntersection(
  intersection: CurveIntersection | undefined,
  message = "A required curve intersection is unavailable.",
) {
  if (!intersection) throw new RangeError(message)
  return intersection
}

function matchingOperationPoint(
  sketch: SketchRecord,
  target: SketchCurveEntity,
  intersection: CurveIntersection,
) {
  const candidateIds = [
    ...sketchCurvePointIds(target),
    ...sketchCurvePointIds(intersection.boundary),
  ]
  return candidateIds
    .map((pointId) => pointById(sketch, pointId))
    .find((point) => distance(point, intersection.point) <= OPERATION_EPSILON)
}

function resolveIntersectionPoint(
  sketch: SketchRecord,
  target: SketchCurveEntity,
  intersection: CurveIntersection,
  createEntityId: EntityIdFactory,
): ResolvedOperationPoint {
  const existing = matchingOperationPoint(sketch, target, intersection)
  if (existing) {
    return {
      constrainToBoundary: !sketchCurvePointIds(intersection.boundary).includes(existing.id),
      entity: null,
      id: existing.id,
      point: existing,
    }
  }
  const entity: SketchPointEntity = {
    schemaVersion: 0,
    id: createEntityId(),
    type: "point",
    ...intersection.point,
    construction: target.construction,
  }
  return { constrainToBoundary: true, entity, id: entity.id, point: entity }
}

function createProjectedPoint(
  geometry: RoundGeometry,
  point: SketchPoint2,
  construction: boolean,
  createEntityId: EntityIdFactory,
) {
  const projected = projectToRound(geometry, point)
  return {
    schemaVersion: 0,
    id: createEntityId(),
    type: "point",
    ...projected,
    construction,
  } satisfies SketchPointEntity
}

function replaceCurve(
  sketch: SketchRecord,
  target: SketchCurveEntity,
  replacement: SketchCurveEntity,
  additions: readonly SketchEntity[],
) {
  return sketchRecordSchema.parse({
    ...sketch,
    entities: [
      ...sketch.entities.map((entity) => (entity.id === target.id ? replacement : entity)),
      ...additions,
    ],
  })
}

function appendBoundaryConstraint(
  sketch: SketchRecord,
  point: ResolvedOperationPoint,
  boundary: SketchCurveEntity,
  createConstraintId: ConstraintIdFactory,
) {
  if (!point.constrainToBoundary) return sketch
  return appendSketchConstraint(
    sketch,
    boundary.type === "line"
      ? { type: "point-on-line", pointId: point.id, lineId: boundary.id }
      : { type: "point-on-curve", pointId: point.id, curveId: boundary.id },
    createConstraintId,
  )
}

function referencedEntityIds(constraint: SketchConstraint) {
  return Object.entries(constraint)
    .filter(([key, value]) => key !== "id" && key.endsWith("Id") && isString(value))
    .map(([, value]) => value as string)
}

function removeDetachedPoints(sketch: SketchRecord, pointIds: readonly SketchEntityId[]) {
  const retainedByGeometry = new Set<string>(
    sketch.entities
      .filter((entity): entity is SketchCurveEntity => entity.type !== "point")
      .flatMap(sketchCurvePointIds),
  )
  const removableIds = new Set<string>(
    pointIds.filter((pointId) => !retainedByGeometry.has(pointId)),
  )
  if (removableIds.size === 0) return sketch
  return sketchRecordSchema.parse({
    ...sketch,
    constraints: sketch.constraints.filter((constraint) =>
      referencedEntityIds(constraint).every((id) => !removableIds.has(id)),
    ),
    entities: sketch.entities.filter(({ id }) => !removableIds.has(id)),
  })
}

function addedPointEntities(points: readonly ResolvedOperationPoint[]) {
  return points.flatMap((point): SketchPointEntity[] => (point.entity ? [point.entity] : []))
}

function trimLineEnd(
  sketch: SketchRecord,
  line: Extract<SketchEntity, { type: "line" }>,
  intersection: CurveIntersection,
  replaceStart: boolean,
  input: { createConstraintId: ConstraintIdFactory; createEntityId: EntityIdFactory },
): SketchAppendResult {
  const point = resolveIntersectionPoint(sketch, line, intersection, input.createEntityId)
  const replaced = replaceCurve(
    sketch,
    line,
    {
      ...line,
      startPointId: replaceStart ? point.id : line.startPointId,
      endPointId: replaceStart ? line.endPointId : point.id,
    },
    point.entity ? [point.entity] : [],
  )
  const constrained = appendBoundaryConstraint(
    replaced,
    point,
    intersection.boundary,
    input.createConstraintId,
  )
  return {
    sketch: removeDetachedPoints(constrained, [replaceStart ? line.startPointId : line.endPointId]),
    createdEntityIds: point.entity ? [point.entity.id] : [],
  }
}

function trimLineInterior(
  sketch: SketchRecord,
  line: Extract<SketchEntity, { type: "line" }>,
  before: CurveIntersection,
  after: CurveIntersection,
  input: { createConstraintId: ConstraintIdFactory; createEntityId: EntityIdFactory },
): SketchAppendResult {
  const beforePoint = resolveIntersectionPoint(sketch, line, before, input.createEntityId)
  const afterPoint = resolveIntersectionPoint(sketch, line, after, input.createEntityId)
  const secondLine: Extract<SketchEntity, { type: "line" }> = {
    ...line,
    id: input.createEntityId(),
    startPointId: afterPoint.id,
  }
  const pointEntities = addedPointEntities([beforePoint, afterPoint])
  let next = replaceCurve(sketch, line, { ...line, endPointId: beforePoint.id }, [
    ...pointEntities,
    secondLine,
  ])
  next = appendBoundaryConstraint(next, beforePoint, before.boundary, input.createConstraintId)
  next = appendBoundaryConstraint(next, afterPoint, after.boundary, input.createConstraintId)
  next = appendSketchConstraint(
    next,
    { type: "point-on-line", pointId: afterPoint.id, lineId: line.id },
    input.createConstraintId,
  )
  next = appendSketchConstraint(
    next,
    { type: "parallel", firstEntityId: line.id, secondEntityId: secondLine.id },
    input.createConstraintId,
  )
  return {
    sketch: next,
    createdEntityIds: [...pointEntities.map(({ id }) => id), secondLine.id],
  }
}

function trimCurveLine(
  sketch: SketchRecord,
  line: Extract<SketchEntity, { type: "line" }>,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
) {
  const points = linePoints(sketch, line)
  const pickedParameter = lineParameter(points.start, points.end, input.point)
  const intersections = curveIntersections(sketch, line).filter(
    ({ parameter }) => parameter > OPERATION_EPSILON && parameter < 1 - OPERATION_EPSILON,
  )
  if (intersections.length === 0) {
    throw new RangeError("Trim requires a bounded curve intersection.")
  }
  const afterIndex = intersections.findIndex(({ parameter }) => parameter > pickedParameter)
  if (afterIndex === 0) {
    return trimLineEnd(sketch, line, requiredIntersection(intersections[0]), true, input)
  }
  if (afterIndex < 0) {
    return trimLineEnd(sketch, line, requiredIntersection(intersections.at(-1)), false, input)
  }
  return trimLineInterior(
    sketch,
    line,
    requiredIntersection(intersections[afterIndex - 1]),
    requiredIntersection(intersections[afterIndex]),
    input,
  )
}

function extendCurveLine(
  sketch: SketchRecord,
  line: Extract<SketchEntity, { type: "line" }>,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
) {
  const points = linePoints(sketch, line)
  const extendStart = lineParameter(points.start, points.end, input.point) < 0.5
  const intersections = curveIntersections(sketch, line).filter(({ parameter }) =>
    extendStart ? parameter < -OPERATION_EPSILON : parameter > 1 + OPERATION_EPSILON,
  )
  const intersection = extendStart ? intersections.at(-1) : intersections[0]
  if (!intersection) {
    throw new RangeError("Extend requires a reachable bounded curve intersection.")
  }
  const point = resolveIntersectionPoint(sketch, line, intersection, input.createEntityId)
  const replaced = replaceCurve(
    sketch,
    line,
    {
      ...line,
      startPointId: extendStart ? point.id : line.startPointId,
      endPointId: extendStart ? line.endPointId : point.id,
    },
    point.entity ? [point.entity] : [],
  )
  const constrained = appendBoundaryConstraint(
    replaced,
    point,
    intersection.boundary,
    input.createConstraintId,
  )
  return {
    sketch: removeDetachedPoints(constrained, [extendStart ? line.startPointId : line.endPointId]),
    createdEntityIds: point.entity ? [point.entity.id] : [],
  }
}

export function splitSketchArc(
  sketch: SketchRecord,
  input: {
    arcId: SketchEntityId
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
): SketchAppendResult {
  const arc = curveById(sketch, input.arcId)
  if (arc.type !== "arc") throw new TypeError("Arc split requires an arc entity.")
  const geometry = roundGeometry(sketch, arc)
  const splitPoint = createProjectedPoint(
    geometry,
    input.point,
    arc.construction,
    input.createEntityId,
  )
  const parameter = roundParameter(geometry, splitPoint)
  const endParameter = geometry.sweep / FULL_TURN
  if (parameter <= OPERATION_EPSILON || parameter >= endParameter - OPERATION_EPSILON) {
    throw new RangeError("An arc split point must lie inside the selected arc.")
  }
  const secondArc: SketchArcEntity = {
    ...arc,
    id: input.createEntityId(),
    startPointId: splitPoint.id,
  }
  const replaced = replaceCurve(sketch, arc, { ...arc, endPointId: splitPoint.id }, [
    splitPoint,
    secondArc,
  ])
  return { sketch: replaced, createdEntityIds: [splitPoint.id, secondArc.id] }
}

export function splitSketchCircle(
  sketch: SketchRecord,
  input: {
    circleId: SketchEntityId
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    firstPoint: SketchPoint2
    secondPoint: SketchPoint2
  },
): SketchAppendResult {
  const circle = curveById(sketch, input.circleId)
  if (circle.type !== "circle") throw new TypeError("Circle split requires a circle entity.")
  const geometry = roundGeometry(sketch, circle)
  const first = createProjectedPoint(
    geometry,
    input.firstPoint,
    circle.construction,
    input.createEntityId,
  )
  const second = createProjectedPoint(
    geometry,
    input.secondPoint,
    circle.construction,
    input.createEntityId,
  )
  const separation = positiveSweep(
    Math.atan2(first.y - geometry.center.y, first.x - geometry.center.x),
    Math.atan2(second.y - geometry.center.y, second.x - geometry.center.x),
  )
  if (separation <= OPERATION_EPSILON || FULL_TURN - separation <= OPERATION_EPSILON) {
    throw new RangeError("A circle split requires two distinct points.")
  }
  const secondCenter: SketchPointEntity = {
    ...geometry.center,
    id: input.createEntityId(),
  }
  const firstArc: SketchArcEntity = {
    schemaVersion: 0,
    id: circle.id,
    type: "arc",
    centerPointId: circle.centerPointId,
    startPointId: first.id,
    endPointId: second.id,
    construction: circle.construction,
  }
  const secondArc: SketchArcEntity = {
    ...firstArc,
    id: input.createEntityId(),
    centerPointId: secondCenter.id,
    startPointId: second.id,
    endPointId: first.id,
  }
  const replaced = replaceCurve(sketch, circle, firstArc, [first, second, secondCenter, secondArc])
  return {
    sketch: appendSketchConstraint(
      replaced,
      { type: "equal", firstEntityId: firstArc.id, secondEntityId: secondArc.id },
      input.createConstraintId,
    ),
    createdEntityIds: [first.id, second.id, secondCenter.id, secondArc.id],
  }
}

function trimArcEnd(
  sketch: SketchRecord,
  arc: SketchArcEntity,
  intersection: CurveIntersection,
  replaceStart: boolean,
  input: { createConstraintId: ConstraintIdFactory; createEntityId: EntityIdFactory },
): SketchAppendResult {
  const point = resolveIntersectionPoint(sketch, arc, intersection, input.createEntityId)
  const replaced = replaceCurve(
    sketch,
    arc,
    {
      ...arc,
      startPointId: replaceStart ? point.id : arc.startPointId,
      endPointId: replaceStart ? arc.endPointId : point.id,
    },
    point.entity ? [point.entity] : [],
  )
  const constrained = appendBoundaryConstraint(
    replaced,
    point,
    intersection.boundary,
    input.createConstraintId,
  )
  return {
    sketch: removeDetachedPoints(constrained, [replaceStart ? arc.startPointId : arc.endPointId]),
    createdEntityIds: point.entity ? [point.entity.id] : [],
  }
}

function trimArcInterior(
  sketch: SketchRecord,
  arc: SketchArcEntity,
  before: CurveIntersection,
  after: CurveIntersection,
  input: { createConstraintId: ConstraintIdFactory; createEntityId: EntityIdFactory },
): SketchAppendResult {
  const beforePoint = resolveIntersectionPoint(sketch, arc, before, input.createEntityId)
  const afterPoint = resolveIntersectionPoint(sketch, arc, after, input.createEntityId)
  const secondArc: SketchArcEntity = {
    ...arc,
    id: input.createEntityId(),
    startPointId: afterPoint.id,
  }
  const pointEntities = addedPointEntities([beforePoint, afterPoint])
  let next = replaceCurve(sketch, arc, { ...arc, endPointId: beforePoint.id }, [
    ...pointEntities,
    secondArc,
  ])
  next = appendBoundaryConstraint(next, beforePoint, before.boundary, input.createConstraintId)
  next = appendBoundaryConstraint(next, afterPoint, after.boundary, input.createConstraintId)
  next = appendSketchConstraint(
    next,
    { type: "equal", firstEntityId: arc.id, secondEntityId: secondArc.id },
    input.createConstraintId,
  )
  return {
    sketch: next,
    createdEntityIds: [...pointEntities.map(({ id }) => id), secondArc.id],
  }
}

function trimSketchArc(
  sketch: SketchRecord,
  arc: SketchArcEntity,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
) {
  const geometry = roundGeometry(sketch, arc)
  const pickedParameter = roundParameter(geometry, projectToRound(geometry, input.point))
  const endParameter = geometry.sweep / FULL_TURN
  const intersections = curveIntersections(sketch, arc).filter(
    ({ parameter }) =>
      parameter > OPERATION_EPSILON && parameter < endParameter - OPERATION_EPSILON,
  )
  if (intersections.length === 0) throw new RangeError("Trim requires a bounded arc intersection.")
  const afterIndex = intersections.findIndex(({ parameter }) => parameter > pickedParameter)
  if (afterIndex === 0) {
    return trimArcEnd(sketch, arc, requiredIntersection(intersections[0]), true, input)
  }
  if (afterIndex < 0) {
    return trimArcEnd(sketch, arc, requiredIntersection(intersections.at(-1)), false, input)
  }
  return trimArcInterior(
    sketch,
    arc,
    requiredIntersection(intersections[afterIndex - 1]),
    requiredIntersection(intersections[afterIndex]),
    input,
  )
}

function trimSketchCircle(
  sketch: SketchRecord,
  circle: SketchCircleEntity,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
) {
  const geometry = roundGeometry(sketch, circle)
  const pickedParameter = roundParameter(geometry, projectToRound(geometry, input.point))
  const intersections = curveIntersections(sketch, circle)
  if (intersections.length < 2) {
    throw new RangeError("Circle trim requires two distinct bounded intersections.")
  }
  const afterIndex = intersections.findIndex(({ parameter }) => parameter > pickedParameter)
  const after = requiredIntersection(intersections[afterIndex < 0 ? 0 : afterIndex])
  const before = requiredIntersection(
    intersections[(afterIndex <= 0 ? intersections.length : afterIndex) - 1],
  )
  const beforePoint = resolveIntersectionPoint(sketch, circle, before, input.createEntityId)
  const afterPoint = resolveIntersectionPoint(sketch, circle, after, input.createEntityId)
  const pointEntities = addedPointEntities([beforePoint, afterPoint])
  const retainedArc: SketchArcEntity = {
    schemaVersion: 0,
    id: circle.id,
    type: "arc",
    centerPointId: circle.centerPointId,
    startPointId: afterPoint.id,
    endPointId: beforePoint.id,
    construction: circle.construction,
  }
  let next = replaceCurve(sketch, circle, retainedArc, pointEntities)
  next = appendBoundaryConstraint(next, beforePoint, before.boundary, input.createConstraintId)
  next = appendBoundaryConstraint(next, afterPoint, after.boundary, input.createConstraintId)
  return { sketch: next, createdEntityIds: pointEntities.map(({ id }) => id) }
}

export function trimSketchCurve(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    curveId: SketchEntityId
    point: SketchPoint2
  },
): SketchAppendResult {
  const curve = curveById(sketch, input.curveId)
  if (curve.type === "line") {
    return trimCurveLine(sketch, curve, input)
  }
  return curve.type === "arc"
    ? trimSketchArc(sketch, curve, input)
    : trimSketchCircle(sketch, curve, input)
}

export function extendSketchArc(
  sketch: SketchRecord,
  input: {
    arcId: SketchEntityId
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
): SketchAppendResult {
  const arc = curveById(sketch, input.arcId)
  if (arc.type !== "arc") throw new TypeError("Arc extend requires an arc entity.")
  const geometry = roundGeometry(sketch, arc)
  const pickedParameter = roundParameter(geometry, projectToRound(geometry, input.point))
  const endParameter = geometry.sweep / FULL_TURN
  const extendStart = pickedParameter < endParameter / 2
  const intersections = curveIntersections(sketch, arc).filter(
    ({ parameter }) => parameter > endParameter + OPERATION_EPSILON,
  )
  const intersection = extendStart ? intersections.at(-1) : intersections[0]
  if (!intersection) throw new RangeError("Extend requires a reachable bounded arc intersection.")
  const point = resolveIntersectionPoint(sketch, arc, intersection, input.createEntityId)
  const replaced = replaceCurve(
    sketch,
    arc,
    {
      ...arc,
      startPointId: extendStart ? point.id : arc.startPointId,
      endPointId: extendStart ? arc.endPointId : point.id,
    },
    point.entity ? [point.entity] : [],
  )
  const constrained = appendBoundaryConstraint(
    replaced,
    point,
    intersection.boundary,
    input.createConstraintId,
  )
  return {
    sketch: removeDetachedPoints(constrained, [extendStart ? arc.startPointId : arc.endPointId]),
    createdEntityIds: point.entity ? [point.entity.id] : [],
  }
}

export function extendSketchCurve(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    curveId: SketchEntityId
    point: SketchPoint2
  },
): SketchAppendResult {
  const curve = curveById(sketch, input.curveId)
  if (curve.type === "line") {
    return extendCurveLine(sketch, curve, input)
  }
  if (curve.type === "circle") throw new TypeError("A closed circle cannot be extended.")
  return extendSketchArc(sketch, { ...input, arcId: curve.id })
}

export function splitSketchCurve(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    curveId: SketchEntityId
    point: SketchPoint2
  },
): SketchAppendResult {
  const curve = curveById(sketch, input.curveId)
  if (curve.type === "line") {
    return splitSketchLine(sketch, { ...input, lineId: curve.id })
  }
  if (curve.type === "circle") {
    throw new TypeError("A circle split requires two split points.")
  }
  return splitSketchArc(sketch, { ...input, arcId: curve.id })
}
