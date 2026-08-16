import { isString } from "is-what"
import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import {
  type SketchConstraint,
  type SketchEntity,
  type SketchRecord,
  sketchConstraintSchema,
  sketchRecordSchema,
} from "./sketch"
import type { AngleQuantity, LengthQuantity } from "./units"

export type SketchPoint2 = Readonly<{ x: number; y: number }>

export type SketchPointTarget =
  | Readonly<{ kind: "existing"; pointId: SketchEntityId }>
  | Readonly<{ kind: "new"; point: SketchPoint2 }>

export type SketchAppendResult = Readonly<{
  createdEntityIds: readonly SketchEntityId[]
  sketch: SketchRecord
}>

export type SketchConstraintDefinition<Constraint extends SketchConstraint = SketchConstraint> =
  Constraint extends SketchConstraint ? Omit<Constraint, "id" | "schemaVersion"> : never

export type SketchDimensionValue = LengthQuantity | AngleQuantity

type EntityIdFactory = () => SketchEntityId
type ConstraintIdFactory = () => SketchConstraintId

const MIN_GEOMETRY_DISTANCE = 1e-9

function distance(first: SketchPoint2, second: SketchPoint2) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function pointById(sketch: SketchRecord, pointId: SketchEntityId) {
  const point = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "point" }> =>
      entity.id === pointId && entity.type === "point",
  )
  if (!point) throw new TypeError("A sketch point target must reference an existing point entity.")
  return point
}

function resolvePointTarget(
  sketch: SketchRecord,
  target: SketchPointTarget,
  construction: boolean,
  createEntityId: EntityIdFactory,
) {
  if (target.kind === "existing") {
    const point = pointById(sketch, target.pointId)
    return { entity: null, id: point.id, point }
  }
  const id = createEntityId()
  const entity = {
    schemaVersion: 0,
    id,
    type: "point",
    x: target.point.x,
    y: target.point.y,
    construction,
  } as const
  return { entity, id, point: entity }
}

function parsedSketch(sketch: SketchRecord, entities: readonly SketchEntity[]) {
  return sketchRecordSchema.parse({ ...sketch, entities })
}

function allocateFourEntityIds(createEntityId: EntityIdFactory) {
  return [createEntityId(), createEntityId(), createEntityId(), createEntityId()] as const
}

export function createEmptySketch(input: {
  id: SketchId
  label: string
  plane: SketchRecord["plane"]
}): SketchRecord {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: input.id,
    label: input.label,
    plane: input.plane,
    entities: [],
    constraints: [],
  })
}

export function appendSketchPoint(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createEntityId: EntityIdFactory
    point: SketchPoint2
  },
): SketchAppendResult {
  const entity = {
    schemaVersion: 0,
    id: input.createEntityId(),
    type: "point",
    x: input.point.x,
    y: input.point.y,
    construction: input.construction ?? false,
  } as const
  return {
    sketch: parsedSketch(sketch, [...sketch.entities, entity]),
    createdEntityIds: [entity.id],
  }
}

export function appendSketchLine(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createEntityId: EntityIdFactory
    end: SketchPointTarget
    start: SketchPointTarget
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const start = resolvePointTarget(sketch, input.start, construction, input.createEntityId)
  const end = resolvePointTarget(sketch, input.end, construction, input.createEntityId)
  if (start.id === end.id || distance(start.point, end.point) <= MIN_GEOMETRY_DISTANCE) {
    throw new RangeError("A sketch line requires two distinct positions.")
  }
  const lineId = input.createEntityId()
  const additions: SketchEntity[] = [
    ...(start.entity ? [start.entity] : []),
    ...(end.entity ? [end.entity] : []),
    {
      schemaVersion: 0,
      id: lineId,
      type: "line",
      startPointId: start.id,
      endPointId: end.id,
      construction,
    },
  ]
  return {
    sketch: parsedSketch(sketch, [...sketch.entities, ...additions]),
    createdEntityIds: additions.map(({ id }) => id),
  }
}

export function appendSketchRectangle(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    firstCorner: SketchPoint2
    oppositeCorner: SketchPoint2
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const width = Math.abs(input.oppositeCorner.x - input.firstCorner.x)
  const height = Math.abs(input.oppositeCorner.y - input.firstCorner.y)
  if (width <= MIN_GEOMETRY_DISTANCE || height <= MIN_GEOMETRY_DISTANCE) {
    throw new RangeError("A sketch rectangle requires nonzero width and height.")
  }
  const pointIds = allocateFourEntityIds(input.createEntityId)
  const lineIds = allocateFourEntityIds(input.createEntityId)
  const [pointA, pointB, pointC, pointD] = pointIds
  const [lineA, lineB, lineC, lineD] = lineIds
  const points = [
    { x: input.firstCorner.x, y: input.firstCorner.y },
    { x: input.oppositeCorner.x, y: input.firstCorner.y },
    { x: input.oppositeCorner.x, y: input.oppositeCorner.y },
    { x: input.firstCorner.x, y: input.oppositeCorner.y },
  ]
  const entities: SketchEntity[] = [
    ...points.map((point, index) => ({
      schemaVersion: 0 as const,
      id: pointIds[index] as SketchEntityId,
      type: "point" as const,
      ...point,
      construction,
    })),
    {
      schemaVersion: 0,
      id: lineA,
      type: "line",
      startPointId: pointA,
      endPointId: pointB,
      construction,
    },
    {
      schemaVersion: 0,
      id: lineB,
      type: "line",
      startPointId: pointB,
      endPointId: pointC,
      construction,
    },
    {
      schemaVersion: 0,
      id: lineC,
      type: "line",
      startPointId: pointC,
      endPointId: pointD,
      construction,
    },
    {
      schemaVersion: 0,
      id: lineD,
      type: "line",
      startPointId: pointD,
      endPointId: pointA,
      construction,
    },
  ]
  const constraints: SketchConstraint[] = [
    { schemaVersion: 0, id: input.createConstraintId(), type: "horizontal", lineId: lineA },
    { schemaVersion: 0, id: input.createConstraintId(), type: "vertical", lineId: lineB },
    { schemaVersion: 0, id: input.createConstraintId(), type: "horizontal", lineId: lineC },
    { schemaVersion: 0, id: input.createConstraintId(), type: "vertical", lineId: lineD },
  ]
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...sketch.entities, ...entities],
      constraints: [...sketch.constraints, ...constraints],
    }),
    createdEntityIds: entities.map(({ id }) => id),
  }
}

function centerRectangleSpokes(
  centerId: SketchEntityId,
  cornerIds: readonly [SketchEntityId, SketchEntityId, SketchEntityId, SketchEntityId],
  createEntityId: EntityIdFactory,
) {
  const spokeIds = allocateFourEntityIds(createEntityId)
  const entities = spokeIds.map(
    (id, index): SketchEntity => ({
      schemaVersion: 0,
      id,
      type: "line",
      startPointId: centerId,
      endPointId: cornerIds[index] as SketchEntityId,
      construction: true,
    }),
  )
  return { entities, ids: spokeIds }
}

function centerRectangleSymmetryConstraints(
  oppositeSpokeIds: readonly [SketchEntityId, SketchEntityId],
  createConstraintId: ConstraintIdFactory,
): readonly SketchConstraint[] {
  const [firstEntityId, secondEntityId] = oppositeSpokeIds
  return [
    {
      schemaVersion: 0,
      id: createConstraintId(),
      type: "parallel",
      firstEntityId,
      secondEntityId,
    },
    {
      schemaVersion: 0,
      id: createConstraintId(),
      type: "equal",
      firstEntityId,
      secondEntityId,
    },
  ]
}

export function appendSketchCenterRectangle(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    corner: SketchPoint2
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
  },
): SketchAppendResult {
  const center = resolvePointTarget(sketch, input.center, true, input.createEntityId)
  const sketchWithCenter = center.entity
    ? parsedSketch(sketch, [...sketch.entities, center.entity])
    : sketch
  const rectangle = appendSketchRectangle(sketchWithCenter, {
    ...(input.construction === undefined ? {} : { construction: input.construction }),
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    firstCorner: {
      x: center.point.x * 2 - input.corner.x,
      y: center.point.y * 2 - input.corner.y,
    },
    oppositeCorner: input.corner,
  })
  const [pointA, pointB, pointC, pointD] = rectangle.createdEntityIds
  if (!pointA || !pointB || !pointC || !pointD) {
    throw new TypeError("Center rectangle corner identity allocation failed.")
  }
  const spokes = centerRectangleSpokes(
    center.id,
    [pointA, pointB, pointC, pointD],
    input.createEntityId,
  )
  const symmetryConstraints = centerRectangleSymmetryConstraints(
    [spokes.ids[0], spokes.ids[2]],
    input.createConstraintId,
  )
  return {
    sketch: sketchRecordSchema.parse({
      ...rectangle.sketch,
      entities: [...rectangle.sketch.entities, ...spokes.entities],
      constraints: [...rectangle.sketch.constraints, ...symmetryConstraints],
    }),
    createdEntityIds: [
      ...(center.entity ? [center.entity.id] : []),
      ...rectangle.createdEntityIds,
      ...spokes.ids,
    ],
  }
}

export function appendSketchCircle(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    createEntityId: EntityIdFactory
    perimeterPoint: SketchPoint2
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const center = resolvePointTarget(sketch, input.center, construction, input.createEntityId)
  const radius = distance(center.point, input.perimeterPoint)
  if (radius <= MIN_GEOMETRY_DISTANCE) {
    throw new RangeError("A sketch circle requires a positive radius.")
  }
  const circleId = input.createEntityId()
  const additions: SketchEntity[] = [
    ...(center.entity ? [center.entity] : []),
    {
      schemaVersion: 0,
      id: circleId,
      type: "circle",
      centerPointId: center.id,
      radius,
      construction,
    },
  ]
  return {
    sketch: parsedSketch(sketch, [...sketch.entities, ...additions]),
    createdEntityIds: additions.map(({ id }) => id),
  }
}

export function appendSketchArc(
  sketch: SketchRecord,
  input: {
    center: SketchPoint2
    construction?: boolean
    createEntityId: EntityIdFactory
    end: SketchPoint2
    start: SketchPoint2
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const radius = distance(input.center, input.start)
  const endDistance = distance(input.center, input.end)
  if (radius <= MIN_GEOMETRY_DISTANCE || endDistance <= MIN_GEOMETRY_DISTANCE) {
    throw new RangeError("A sketch arc requires a positive radius.")
  }
  const end = {
    x: input.center.x + ((input.end.x - input.center.x) * radius) / endDistance,
    y: input.center.y + ((input.end.y - input.center.y) * radius) / endDistance,
  }
  if (distance(input.start, end) <= MIN_GEOMETRY_DISTANCE) {
    throw new RangeError("A sketch arc requires distinct start and end angles.")
  }
  const centerPointId = input.createEntityId()
  const startPointId = input.createEntityId()
  const endPointId = input.createEntityId()
  const arcId = input.createEntityId()
  const entities: SketchEntity[] = [
    { schemaVersion: 0, id: centerPointId, type: "point", ...input.center, construction },
    { schemaVersion: 0, id: startPointId, type: "point", ...input.start, construction },
    { schemaVersion: 0, id: endPointId, type: "point", ...end, construction },
    {
      schemaVersion: 0,
      id: arcId,
      type: "arc",
      centerPointId,
      startPointId,
      endPointId,
      construction,
    },
  ]
  return {
    sketch: parsedSketch(sketch, [...sketch.entities, ...entities]),
    createdEntityIds: entities.map(({ id }) => id),
  }
}

function positiveArcSweep(start: SketchPoint2, end: SketchPoint2, center: SketchPoint2) {
  const fullTurn = Math.PI * 2
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  return (((endAngle - startAngle) % fullTurn) + fullTurn) % fullTurn
}

export type ThreePointArcGeometry = Readonly<{
  center: SketchPoint2
  end: SketchPoint2
  reversed: boolean
  start: SketchPoint2
}>

export function threePointArcGeometry(
  firstEndpoint: SketchPoint2,
  secondEndpoint: SketchPoint2,
  pointOnArc: SketchPoint2,
): ThreePointArcGeometry | null {
  const denominator =
    2 *
    (firstEndpoint.x * (secondEndpoint.y - pointOnArc.y) +
      secondEndpoint.x * (pointOnArc.y - firstEndpoint.y) +
      pointOnArc.x * (firstEndpoint.y - secondEndpoint.y))
  const scale = Math.max(
    distance(firstEndpoint, secondEndpoint),
    distance(secondEndpoint, pointOnArc),
    distance(pointOnArc, firstEndpoint),
    1,
  )
  if (Math.abs(denominator) <= MIN_GEOMETRY_DISTANCE * scale * scale) return null
  const firstSquared = firstEndpoint.x ** 2 + firstEndpoint.y ** 2
  const secondSquared = secondEndpoint.x ** 2 + secondEndpoint.y ** 2
  const pointSquared = pointOnArc.x ** 2 + pointOnArc.y ** 2
  const center = {
    x:
      (firstSquared * (secondEndpoint.y - pointOnArc.y) +
        secondSquared * (pointOnArc.y - firstEndpoint.y) +
        pointSquared * (firstEndpoint.y - secondEndpoint.y)) /
      denominator,
    y:
      (firstSquared * (pointOnArc.x - secondEndpoint.x) +
        secondSquared * (firstEndpoint.x - pointOnArc.x) +
        pointSquared * (secondEndpoint.x - firstEndpoint.x)) /
      denominator,
  }
  const endpointSweep = positiveArcSweep(firstEndpoint, secondEndpoint, center)
  const pointSweep = positiveArcSweep(firstEndpoint, pointOnArc, center)
  const reversed = pointSweep >= endpointSweep
  return {
    center,
    end: reversed ? firstEndpoint : secondEndpoint,
    reversed,
    start: reversed ? secondEndpoint : firstEndpoint,
  }
}

export function appendSketchThreePointArc(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createEntityId: EntityIdFactory
    firstEndpoint: SketchPointTarget
    pointOnArc: SketchPoint2
    secondEndpoint: SketchPointTarget
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const first = resolvePointTarget(sketch, input.firstEndpoint, construction, input.createEntityId)
  const sketchWithFirst = first.entity
    ? parsedSketch(sketch, [...sketch.entities, first.entity])
    : sketch
  const second = resolvePointTarget(
    sketchWithFirst,
    input.secondEndpoint,
    construction,
    input.createEntityId,
  )
  if (first.id === second.id) {
    throw new RangeError("A three-point arc requires distinct endpoints.")
  }
  const geometry = threePointArcGeometry(first.point, second.point, input.pointOnArc)
  if (!geometry) {
    throw new RangeError("A three-point arc requires three non-collinear positions.")
  }
  const centerPointId = input.createEntityId()
  const arcId = input.createEntityId()
  const arc = {
    schemaVersion: 0,
    id: arcId,
    type: "arc",
    centerPointId,
    startPointId: geometry.reversed ? second.id : first.id,
    endPointId: geometry.reversed ? first.id : second.id,
    construction,
  } as const
  const additions: SketchEntity[] = [
    ...(first.entity ? [first.entity] : []),
    ...(second.entity ? [second.entity] : []),
    { schemaVersion: 0, id: centerPointId, type: "point", ...geometry.center, construction },
    arc,
  ]
  return {
    sketch: parsedSketch(sketch, [...sketch.entities, ...additions]),
    createdEntityIds: additions.map(({ id }) => id),
  }
}

export function appendSketchConstraint(
  sketch: SketchRecord,
  definition: SketchConstraintDefinition,
  createConstraintId: ConstraintIdFactory,
): SketchRecord {
  const constraint = sketchConstraintSchema.parse({
    ...definition,
    schemaVersion: 0,
    id: createConstraintId(),
  })
  const semanticConstraint = ({ id: _id, ...value }: SketchConstraint) => JSON.stringify(value)
  if (
    sketch.constraints.some(
      (candidate) => semanticConstraint(candidate) === semanticConstraint(constraint),
    )
  ) {
    return sketch
  }
  return sketchRecordSchema.parse({
    ...sketch,
    constraints: [...sketch.constraints, constraint],
  })
}

function referencedEntityIds(constraint: SketchConstraint) {
  return Object.entries(constraint)
    .filter(([key, value]) => key !== "id" && key.endsWith("Id") && isString(value))
    .map(([, value]) => value as string)
}

function geometryPointIds(entity: SketchEntity) {
  switch (entity.type) {
    case "point":
      return []
    case "line":
      return [entity.startPointId, entity.endPointId]
    case "circle":
      return [entity.centerPointId]
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId]
  }
}

export function removeSketchEntities(
  sketch: SketchRecord,
  selectedEntityIds: readonly SketchEntityId[],
): SketchRecord {
  const removedIds = new Set<string>(selectedEntityIds)
  let changed = true
  while (changed) {
    changed = false
    for (const entity of sketch.entities) {
      if (entity.type === "point" || removedIds.has(entity.id)) continue
      if (geometryPointIds(entity).some((pointId) => removedIds.has(pointId))) {
        removedIds.add(entity.id)
        changed = true
      }
    }
  }

  const removedPointCandidates = new Set(
    sketch.entities
      .filter((entity) => entity.type !== "point" && removedIds.has(entity.id))
      .flatMap(geometryPointIds),
  )
  const remainingGeometry = sketch.entities.filter(
    (entity) => entity.type !== "point" && !removedIds.has(entity.id),
  )
  const retainedPointIds = new Set(remainingGeometry.flatMap(geometryPointIds))
  for (const pointId of removedPointCandidates) {
    if (!retainedPointIds.has(pointId)) removedIds.add(pointId)
  }

  const entities = sketch.entities.filter(({ id }) => !removedIds.has(id))
  const constraints = sketch.constraints.filter((constraint) =>
    referencedEntityIds(constraint).every((entityId) => !removedIds.has(entityId)),
  )
  return sketchRecordSchema.parse({ ...sketch, entities, constraints })
}

export function removeSketchConstraints(
  sketch: SketchRecord,
  selectedConstraintIds: readonly SketchConstraintId[],
): SketchRecord {
  const removedIds = new Set<string>(selectedConstraintIds)
  return sketchRecordSchema.parse({
    ...sketch,
    constraints: sketch.constraints.filter(({ id }) => !removedIds.has(id)),
  })
}

export function setSketchDimensionValue(
  sketch: SketchRecord,
  constraintId: SketchConstraintId,
  value: SketchDimensionValue,
): SketchRecord {
  let updated = false
  const constraints = sketch.constraints.map((constraint) => {
    if (constraint.id !== constraintId) return constraint
    if (!("value" in constraint)) {
      throw new TypeError("Only dimensional sketch constraints have editable values.")
    }
    updated = true
    return sketchConstraintSchema.parse({ ...constraint, value })
  })
  if (!updated) {
    throw new TypeError("An edited sketch dimension must reference an existing constraint.")
  }
  return sketchRecordSchema.parse({ ...sketch, constraints })
}

export function moveSketchPoint(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  point: SketchPoint2,
): SketchRecord {
  let found = false
  const entities = sketch.entities.map((entity) => {
    if (entity.id !== pointId || entity.type !== "point") return entity
    found = true
    return { ...entity, x: point.x, y: point.y }
  })
  if (!found) throw new TypeError("A moved sketch point must reference an existing point entity.")
  return parsedSketch(sketch, entities)
}

export function setSketchEntityConstruction(
  sketch: SketchRecord,
  entityIds: readonly SketchEntityId[],
  construction: boolean,
): SketchRecord {
  const selectedIds = new Set<string>(entityIds)
  return parsedSketch(
    sketch,
    sketch.entities.map((entity) =>
      selectedIds.has(entity.id) ? { ...entity, construction } : entity,
    ),
  )
}
