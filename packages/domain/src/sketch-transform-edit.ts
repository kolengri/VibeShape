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
  sketchConstraintEntityIds,
  sketchSourcePointIds,
} from "./sketch-edit"

type EntityIdFactory = () => SketchEntityId
type ConstraintIdFactory = () => SketchConstraintId
type SketchPointEntity = Extract<SketchEntity, { type: "point" }>
type SketchCurveEntity = Exclude<SketchEntity, { type: "point" }>

const TRANSFORM_EPSILON = 1e-9

export type SketchEntityTransform = Readonly<{
  origin: SketchPoint2
  rotationRadians?: number
  scale?: number
  translation?: SketchPoint2
}>

function pointById(sketch: SketchRecord, pointId: SketchEntityId) {
  return requireSketchPoint(
    sketch,
    pointId,
    "A sketch transform requires an existing point entity.",
  )
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
    throw new TypeError("A sketch transform cannot reference missing source entities.")
  }
  return entities
}

function transformPoint(point: SketchPoint2, transform: SketchEntityTransform) {
  const scale = transform.scale ?? 1
  const rotation = transform.rotationRadians ?? 0
  const translation = transform.translation ?? { x: 0, y: 0 }
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const localX = (point.x - transform.origin.x) * scale
  const localY = (point.y - transform.origin.y) * scale
  return {
    x: transform.origin.x + localX * cosine - localY * sine + translation.x,
    y: transform.origin.y + localX * sine + localY * cosine + translation.y,
  }
}

function quarterTurns(rotation: number) {
  const turns = rotation / (Math.PI / 2)
  const nearest = Math.round(turns)
  return Math.abs(turns - nearest) <= TRANSFORM_EPSILON ? nearest : null
}

function transformOrientationConstraint(
  constraint: Extract<SketchConstraint, { type: "horizontal" | "vertical" }>,
  rotation: number,
): SketchConstraint | null {
  const turns = quarterTurns(rotation)
  if (turns === null) return null
  if (Math.abs(turns) % 2 === 0) return constraint
  return {
    ...constraint,
    type: constraint.type === "horizontal" ? "vertical" : "horizontal",
  }
}

const scaleInvalidatedConstraintTypes: ReadonlySet<SketchConstraint["type"]> = new Set([
  "diameter",
  "distance",
  "horizontal-distance",
  "offset",
  "radius",
  "vertical-distance",
])

function constraintSelectionRelation(
  constraint: SketchConstraint,
  transformedIds: ReadonlySet<string>,
) {
  const references = sketchConstraintEntityIds(constraint)
  const selectedCount = references.filter((id) => transformedIds.has(id)).length
  if (selectedCount === 0) return "outside" as const
  return selectedCount === references.length ? ("internal" as const) : ("crossing" as const)
}

function rotatedConstraint(constraint: SketchConstraint, rotation: number) {
  if (Math.abs(rotation) <= TRANSFORM_EPSILON) return constraint
  if (constraint.type === "horizontal" || constraint.type === "vertical") {
    return transformOrientationConstraint(constraint, rotation)
  }
  if (constraint.type === "horizontal-distance" || constraint.type === "vertical-distance") {
    return null
  }
  return constraint
}

function transformedInternalConstraint(
  constraint: SketchConstraint,
  transform: SketchEntityTransform,
) {
  if (constraint.type === "fixed") return null
  const scaled = Math.abs((transform.scale ?? 1) - 1) > TRANSFORM_EPSILON
  if (scaled && scaleInvalidatedConstraintTypes.has(constraint.type)) return null
  return rotatedConstraint(constraint, transform.rotationRadians ?? 0)
}

function transformedConstraint(
  constraint: SketchConstraint,
  transformedIds: ReadonlySet<string>,
  transform: SketchEntityTransform,
): SketchConstraint | null {
  const relation = constraintSelectionRelation(constraint, transformedIds)
  if (relation === "outside") return constraint
  return relation === "crossing" ? null : transformedInternalConstraint(constraint, transform)
}

function validateEntityTransform(transform: SketchEntityTransform) {
  const { origin, rotationRadians = 0, scale = 1, translation = { x: 0, y: 0 } } = transform
  const values = [origin.x, origin.y, rotationRadians, scale, translation.x, translation.y]
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("Sketch Transform requires finite parameters.")
  }
  if (scale <= TRANSFORM_EPSILON) {
    throw new RangeError("Sketch Transform requires a positive scale factor.")
  }
}

export function sketchEntityTransformOrigin(
  sketch: SketchRecord,
  entityIds: readonly SketchEntityId[],
): SketchPoint2 {
  const entities = selectedEntities(sketch, entityIds)
  if (entities.length === 0) {
    throw new RangeError("Sketch Transform requires at least one selected entity.")
  }
  const points = sketchSourcePointIds(entities).map((pointId) => pointById(sketch, pointId))
  if (points.length === 0) {
    throw new RangeError("Sketch Transform requires transformable sketch geometry.")
  }
  const bounds = points.reduce(
    (current, point) => ({
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
    }),
    {
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
    },
  )
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

export function transformSketchEntities(
  sketch: SketchRecord,
  input: Readonly<{
    entityIds: readonly SketchEntityId[]
    transform: SketchEntityTransform
  }>,
): SketchRecord {
  validateEntityTransform(input.transform)
  const entities = selectedEntities(sketch, input.entityIds)
  if (entities.length === 0) {
    throw new RangeError("Sketch Transform requires at least one selected entity.")
  }
  const pointIds = new Set(sketchSourcePointIds(entities))
  const curveIds = new Set(
    entities.flatMap((entity) => (entity.type === "point" ? [] : [entity.id])),
  )
  const transformedIds = new Set<string>([...pointIds, ...curveIds])
  const scale = input.transform.scale ?? 1
  return sketchRecordSchema.parse({
    ...sketch,
    constraints: sketch.constraints.flatMap((constraint) => {
      const next = transformedConstraint(constraint, transformedIds, input.transform)
      return next ? [next] : []
    }),
    entities: sketch.entities.map((entity): SketchEntity => {
      if (entity.type === "point" && pointIds.has(entity.id)) {
        return { ...entity, ...transformPoint(entity, input.transform) }
      }
      if (entity.type === "circle" && curveIds.has(entity.id)) {
        return { ...entity, radius: entity.radius * scale }
      }
      return entity
    }),
  })
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

function reflectedEllipse(
  entity: Extract<SketchEntity, { type: "ellipse" | "elliptical-arc" }>,
  points: ReflectedPointMap,
  createEntityId: EntityIdFactory,
): ReflectedCurveResult {
  return {
    auxiliaryPoints: [],
    entity: {
      ...entity,
      id: createEntityId(),
      centerPointId: reflectedPointId(points, entity.centerPointId),
      primaryAxisPointId: reflectedPointId(points, entity.primaryAxisPointId),
      secondaryAxisPointId: reflectedPointId(points, entity.secondaryAxisPointId),
      ...(entity.type === "elliptical-arc"
        ? {
            startPointId: reflectedPointId(points, entity.startPointId),
            endPointId: reflectedPointId(points, entity.endPointId),
          }
        : {}),
    },
    requiresEqual: false,
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
    case "ellipse":
      return reflectedEllipse(entity, points, createEntityId)
    case "elliptical-arc":
      return reflectedEllipse(entity, points, createEntityId)
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
    sketchSourcePointIds(sourceEntities),
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
