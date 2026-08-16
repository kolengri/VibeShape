import type { SketchConstraintId, SketchEntityId } from "./identifiers"
import { type SketchEntity, type SketchRecord, sketchRecordSchema } from "./sketch"
import { appendSketchConstraint, type SketchAppendResult, type SketchPoint2 } from "./sketch-edit"

type EntityIdFactory = () => SketchEntityId
type ConstraintIdFactory = () => SketchConstraintId
type SketchPointEntity = Extract<SketchEntity, { type: "point" }>
type SketchCurveEntity = Exclude<SketchEntity, { type: "point" }>

const TRANSFORM_EPSILON = 1e-9

function pointById(sketch: SketchRecord, pointId: SketchEntityId) {
  const point = sketch.entities.find(
    (entity): entity is SketchPointEntity => entity.id === pointId && entity.type === "point",
  )
  if (!point) throw new TypeError("A sketch transform requires an existing point entity.")
  return point
}

function lineById(sketch: SketchRecord, lineId: SketchEntityId) {
  const line = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "line" }> =>
      entity.id === lineId && entity.type === "line",
  )
  if (!line) throw new TypeError("Sketch Mirror requires an existing line axis.")
  return line
}

export function reflectSketchPoint(
  point: SketchPoint2,
  axisStart: SketchPoint2,
  axisEnd: SketchPoint2,
) {
  const axisX = axisEnd.x - axisStart.x
  const axisY = axisEnd.y - axisStart.y
  const lengthSquared = axisX * axisX + axisY * axisY
  if (lengthSquared <= TRANSFORM_EPSILON ** 2) {
    throw new RangeError("Sketch Mirror requires a non-degenerate line axis.")
  }
  const projection =
    ((point.x - axisStart.x) * axisX + (point.y - axisStart.y) * axisY) / lengthSquared
  const projectedX = axisStart.x + axisX * projection
  const projectedY = axisStart.y + axisY * projection
  return {
    x: projectedX * 2 - point.x,
    y: projectedY * 2 - point.y,
  }
}

function pointDistance(first: SketchPoint2, second: SketchPoint2) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function selectedEntities(sketch: SketchRecord, entityIds: readonly SketchEntityId[]) {
  const selectedIds = new Set<string>(entityIds)
  const entities = sketch.entities.filter(({ id }) => selectedIds.has(id))
  if (entities.length !== selectedIds.size) {
    throw new TypeError("Sketch Mirror cannot reference missing source entities.")
  }
  return entities
}

function curvePointIds(curve: SketchCurveEntity) {
  switch (curve.type) {
    case "line":
      return [curve.startPointId, curve.endPointId]
    case "circle":
      return [curve.centerPointId]
    case "arc":
      return [curve.centerPointId, curve.startPointId, curve.endPointId]
  }
}

function sourcePointIds(entities: readonly SketchEntity[]) {
  const pointIds = new Set<SketchEntityId>()
  for (const entity of entities) {
    if (entity.type === "point") pointIds.add(entity.id)
    else for (const pointId of curvePointIds(entity)) pointIds.add(pointId)
  }
  return [...pointIds]
}

type ReflectedPointMap = Readonly<{
  additions: readonly SketchPointEntity[]
  ids: ReadonlyMap<SketchEntityId, SketchEntityId>
  mirroredPairs: readonly Readonly<{
    mirroredPointId: SketchEntityId
    sourcePointId: SketchEntityId
  }>[]
}>

function reflectedPoints(
  sketch: SketchRecord,
  pointIds: readonly SketchEntityId[],
  axisStart: SketchPoint2,
  axisEnd: SketchPoint2,
  createEntityId: EntityIdFactory,
): ReflectedPointMap {
  const additions: SketchPointEntity[] = []
  const ids = new Map<SketchEntityId, SketchEntityId>()
  const mirroredPairs: Array<{
    mirroredPointId: SketchEntityId
    sourcePointId: SketchEntityId
  }> = []
  for (const pointId of pointIds) {
    const source = pointById(sketch, pointId)
    const reflected = reflectSketchPoint(source, axisStart, axisEnd)
    if (pointDistance(source, reflected) <= TRANSFORM_EPSILON) {
      ids.set(source.id, source.id)
      continue
    }
    const mirrored: SketchPointEntity = { ...source, id: createEntityId(), ...reflected }
    additions.push(mirrored)
    ids.set(source.id, mirrored.id)
    mirroredPairs.push({ mirroredPointId: mirrored.id, sourcePointId: source.id })
  }
  return { additions, ids, mirroredPairs }
}

function reflectedPointId(points: ReflectedPointMap, pointId: SketchEntityId) {
  const reflectedId = points.ids.get(pointId)
  if (!reflectedId) throw new TypeError("Sketch Mirror point identity allocation failed.")
  return reflectedId
}

type ReflectedCurveResult = Readonly<{
  auxiliaryPoints: readonly SketchPointEntity[]
  entity: SketchCurveEntity
  requiresEqual: boolean
}>

function reflectedLine(
  entity: Extract<SketchEntity, { type: "line" }>,
  points: ReflectedPointMap,
  createEntityId: EntityIdFactory,
): ReflectedCurveResult {
  return {
    auxiliaryPoints: [],
    entity: {
      ...entity,
      id: createEntityId(),
      startPointId: reflectedPointId(points, entity.startPointId),
      endPointId: reflectedPointId(points, entity.endPointId),
    },
    requiresEqual: false,
  }
}

function reflectedCircle(
  entity: Extract<SketchEntity, { type: "circle" }>,
  points: ReflectedPointMap,
  createEntityId: EntityIdFactory,
): ReflectedCurveResult {
  return {
    auxiliaryPoints: [],
    entity: {
      ...entity,
      id: createEntityId(),
      centerPointId: reflectedPointId(points, entity.centerPointId),
    },
    requiresEqual: true,
  }
}

function reflectedArc(
  sketch: SketchRecord,
  entity: Extract<SketchEntity, { type: "arc" }>,
  points: ReflectedPointMap,
  createEntityId: EntityIdFactory,
): ReflectedCurveResult {
  const reflectedCenterId = reflectedPointId(points, entity.centerPointId)
  const reflectedStartId = reflectedPointId(points, entity.endPointId)
  const reflectedEndId = reflectedPointId(points, entity.startPointId)
  const duplicatesInternalEquation =
    reflectedCenterId === entity.centerPointId &&
    reflectedStartId === entity.endPointId &&
    reflectedEndId === entity.startPointId
  const auxiliaryCenter = duplicatesInternalEquation
    ? { ...pointById(sketch, entity.centerPointId), id: createEntityId() }
    : null
  return {
    auxiliaryPoints: auxiliaryCenter ? [auxiliaryCenter] : [],
    entity: {
      ...entity,
      id: createEntityId(),
      centerPointId: auxiliaryCenter?.id ?? reflectedCenterId,
      startPointId: reflectedStartId,
      endPointId: reflectedEndId,
    },
    requiresEqual: duplicatesInternalEquation,
  }
}

function reflectedEntity(
  sketch: SketchRecord,
  entity: SketchEntity,
  points: ReflectedPointMap,
  createEntityId: EntityIdFactory,
): ReflectedCurveResult | null {
  if (entity.type === "point") return null
  switch (entity.type) {
    case "line":
      return reflectedLine(entity, points, createEntityId)
    case "circle":
      return reflectedCircle(entity, points, createEntityId)
    case "arc":
      return reflectedArc(sketch, entity, points, createEntityId)
  }
}

function appendMirrorConstraints(
  sketch: SketchRecord,
  axisLineId: SketchEntityId,
  entityPairs: readonly Readonly<{
    reflected: SketchCurveEntity
    requiresEqual: boolean
    source: SketchCurveEntity
  }>[],
  points: ReflectedPointMap,
  createConstraintId: ConstraintIdFactory,
) {
  let next = sketch
  for (const pair of points.mirroredPairs) {
    next = appendSketchConstraint(
      next,
      {
        type: "symmetric",
        firstPointId: pair.sourcePointId,
        secondPointId: pair.mirroredPointId,
        lineId: axisLineId,
      },
      createConstraintId,
    )
  }
  for (const { reflected, requiresEqual, source } of entityPairs) {
    if (!requiresEqual) continue
    next = appendSketchConstraint(
      next,
      { type: "equal", firstEntityId: source.id, secondEntityId: reflected.id },
      createConstraintId,
    )
  }
  return next
}

export function mirrorSketchEntities(
  sketch: SketchRecord,
  input: {
    axisLineId: SketchEntityId
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    entityIds: readonly SketchEntityId[]
  },
): SketchAppendResult {
  const axis = lineById(sketch, input.axisLineId)
  const sourceEntities = selectedEntities(
    sketch,
    input.entityIds.filter((entityId) => entityId !== axis.id),
  )
  if (sourceEntities.length === 0) {
    throw new RangeError("Sketch Mirror requires at least one source entity outside the axis.")
  }
  const axisStart = pointById(sketch, axis.startPointId)
  const axisEnd = pointById(sketch, axis.endPointId)
  const points = reflectedPoints(
    sketch,
    sourcePointIds(sourceEntities),
    axisStart,
    axisEnd,
    input.createEntityId,
  )
  const entityPairs = sourceEntities.flatMap(
    (
      entity,
    ): Array<{
      auxiliaryPoints: readonly SketchPointEntity[]
      reflected: SketchCurveEntity
      requiresEqual: boolean
      source: SketchCurveEntity
    }> => {
      if (entity.type === "point") return []
      const reflected = reflectedEntity(sketch, entity, points, input.createEntityId)
      return reflected
        ? [
            {
              auxiliaryPoints: reflected.auxiliaryPoints,
              reflected: reflected.entity,
              requiresEqual: reflected.requiresEqual,
              source: entity,
            },
          ]
        : []
    },
  )
  const reflectedEntities = entityPairs.map(({ reflected }) => reflected)
  const auxiliaryPoints = entityPairs.flatMap(({ auxiliaryPoints }) => auxiliaryPoints)
  const additions = [...points.additions, ...auxiliaryPoints, ...reflectedEntities]
  const reflectedSketch = sketchRecordSchema.parse({
    ...sketch,
    entities: [...sketch.entities, ...additions],
  })
  return {
    sketch: appendMirrorConstraints(
      reflectedSketch,
      axis.id,
      entityPairs,
      points,
      input.createConstraintId,
    ),
    createdEntityIds: additions.map(({ id }) => id),
  }
}
