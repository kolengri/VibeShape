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

type FourEntityIds = ReturnType<typeof allocateFourEntityIds>
type FourPoints = readonly [SketchPoint2, SketchPoint2, SketchPoint2, SketchPoint2]

function pointEntities(
  pointIds: FourEntityIds,
  points: FourPoints,
  construction: boolean,
): readonly SketchEntity[] {
  return points.map((point, index) => ({
    schemaVersion: 0 as const,
    id: pointIds[index] as SketchEntityId,
    type: "point" as const,
    ...point,
    construction,
  }))
}

function closedLineEntities(
  pointIds: FourEntityIds,
  construction: boolean,
  createEntityId: EntityIdFactory,
) {
  const lineIds = allocateFourEntityIds(createEntityId)
  const entities = lineIds.map(
    (id, index): SketchEntity => ({
      schemaVersion: 0,
      id,
      type: "line",
      startPointId: pointIds[index] as SketchEntityId,
      endPointId: pointIds[(index + 1) % pointIds.length] as SketchEntityId,
      construction,
    }),
  )
  return { entities, lineIds }
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

export function appendSketchMidpointLine(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    endpoint: SketchPointTarget
    midpoint: SketchPointTarget
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const midpoint = resolvePointTarget(sketch, input.midpoint, true, input.createEntityId)
  const sketchWithMidpoint = midpoint.entity
    ? parsedSketch(sketch, [...sketch.entities, midpoint.entity])
    : sketch
  const endpoint = resolvePointTarget(
    sketchWithMidpoint,
    input.endpoint,
    construction,
    input.createEntityId,
  )
  if (
    endpoint.id === midpoint.id ||
    distance(endpoint.point, midpoint.point) <= MIN_GEOMETRY_DISTANCE
  ) {
    throw new RangeError("A midpoint line requires a distinct midpoint and endpoint.")
  }
  const oppositePointId = input.createEntityId()
  const lineId = input.createEntityId()
  const oppositePoint = {
    schemaVersion: 0,
    id: oppositePointId,
    type: "point",
    x: midpoint.point.x * 2 - endpoint.point.x,
    y: midpoint.point.y * 2 - endpoint.point.y,
    construction,
  } as const
  const line = {
    schemaVersion: 0,
    id: lineId,
    type: "line",
    startPointId: oppositePointId,
    endPointId: endpoint.id,
    construction,
  } as const
  const additions: SketchEntity[] = [
    ...(midpoint.entity ? [midpoint.entity] : []),
    ...(endpoint.entity ? [endpoint.entity] : []),
    oppositePoint,
    line,
  ]
  const constraint = {
    schemaVersion: 0,
    id: input.createConstraintId(),
    type: "midpoint",
    pointId: midpoint.id,
    lineId,
  } as const
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...sketch.entities, ...additions],
      constraints: [...sketch.constraints, constraint],
    }),
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
  const points: FourPoints = [
    { x: input.firstCorner.x, y: input.firstCorner.y },
    { x: input.oppositeCorner.x, y: input.firstCorner.y },
    { x: input.oppositeCorner.x, y: input.oppositeCorner.y },
    { x: input.firstCorner.x, y: input.oppositeCorner.y },
  ]
  const outline = closedLineEntities(pointIds, construction, input.createEntityId)
  const [lineA, lineB, lineC, lineD] = outline.lineIds
  const entities = [...pointEntities(pointIds, points, construction), ...outline.entities]
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

export type AlignedRectangleGeometry = Readonly<{
  fourth: SketchPoint2
  third: SketchPoint2
}>

export function alignedRectangleGeometry(
  first: SketchPoint2,
  second: SketchPoint2,
  widthPoint: SketchPoint2,
): AlignedRectangleGeometry | null {
  const sideX = second.x - first.x
  const sideY = second.y - first.y
  const sideLength = Math.hypot(sideX, sideY)
  if (sideLength <= MIN_GEOMETRY_DISTANCE) return null
  const signedWidth =
    (sideX * (widthPoint.y - first.y) - sideY * (widthPoint.x - first.x)) / sideLength
  if (Math.abs(signedWidth) <= MIN_GEOMETRY_DISTANCE) return null
  const offset = {
    x: (-sideY * signedWidth) / sideLength,
    y: (sideX * signedWidth) / sideLength,
  }
  return {
    third: { x: second.x + offset.x, y: second.y + offset.y },
    fourth: { x: first.x + offset.x, y: first.y + offset.y },
  }
}

function alignedRectangleEntities(
  first: ReturnType<typeof resolvePointTarget>,
  second: ReturnType<typeof resolvePointTarget>,
  geometry: AlignedRectangleGeometry,
  construction: boolean,
  createEntityId: EntityIdFactory,
) {
  const thirdPointId = createEntityId()
  const fourthPointId = createEntityId()
  const cornerIds = [first.id, second.id, thirdPointId, fourthPointId] as const
  const points: SketchEntity[] = [geometry.third, geometry.fourth].map((point, index) => ({
    schemaVersion: 0,
    id: [thirdPointId, fourthPointId][index] as SketchEntityId,
    type: "point",
    ...point,
    construction,
  }))
  const outline = closedLineEntities(cornerIds, construction, createEntityId)
  return {
    additions: [
      ...(first.entity ? [first.entity] : []),
      ...(second.entity ? [second.entity] : []),
      ...points,
      ...outline.entities,
    ],
    lineIds: outline.lineIds,
  }
}

function alignedRectangleConstraints(
  lineIds: readonly [SketchEntityId, SketchEntityId, SketchEntityId, SketchEntityId],
  createConstraintId: ConstraintIdFactory,
) {
  const [firstLineId, secondLineId, thirdLineId, fourthLineId] = lineIds
  const definitions = [
    { type: "perpendicular", firstEntityId: firstLineId, secondEntityId: secondLineId },
    { type: "parallel", firstEntityId: firstLineId, secondEntityId: thirdLineId },
    { type: "parallel", firstEntityId: secondLineId, secondEntityId: fourthLineId },
  ] as const
  return definitions.map(
    ({ type, firstEntityId, secondEntityId }): SketchConstraint => ({
      schemaVersion: 0,
      id: createConstraintId(),
      type,
      firstEntityId,
      secondEntityId,
    }),
  )
}

export function appendSketchAlignedRectangle(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    firstSideEnd: SketchPointTarget
    firstSideStart: SketchPointTarget
    widthPoint: SketchPoint2
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const first = resolvePointTarget(sketch, input.firstSideStart, construction, input.createEntityId)
  const sketchWithFirst = first.entity
    ? parsedSketch(sketch, [...sketch.entities, first.entity])
    : sketch
  const second = resolvePointTarget(
    sketchWithFirst,
    input.firstSideEnd,
    construction,
    input.createEntityId,
  )
  const sideX = second.point.x - first.point.x
  const sideY = second.point.y - first.point.y
  const sideLength = Math.hypot(sideX, sideY)
  if (first.id === second.id || sideLength <= MIN_GEOMETRY_DISTANCE) {
    throw new RangeError("An aligned rectangle requires a nonzero first side.")
  }
  const geometry = alignedRectangleGeometry(first.point, second.point, input.widthPoint)
  if (!geometry) {
    throw new RangeError("An aligned rectangle requires a nonzero perpendicular width.")
  }
  const { additions, lineIds } = alignedRectangleEntities(
    first,
    second,
    geometry,
    construction,
    input.createEntityId,
  )
  const constraints = alignedRectangleConstraints(lineIds, input.createConstraintId)
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...sketch.entities, ...additions],
      constraints: [...sketch.constraints, ...constraints],
    }),
    createdEntityIds: additions.map(({ id }) => id),
  }
}

export type CenteredAlignedRectangleGeometry = Readonly<{
  corners: FourPoints
  oppositeSidePoint: SketchPoint2
}>

export function centeredAlignedRectangleGeometry(
  center: SketchPoint2,
  sidePoint: SketchPoint2,
  widthPoint: SketchPoint2,
): CenteredAlignedRectangleGeometry | null {
  const halfSide = { x: sidePoint.x - center.x, y: sidePoint.y - center.y }
  const halfSideLength = Math.hypot(halfSide.x, halfSide.y)
  if (halfSideLength <= MIN_GEOMETRY_DISTANCE) return null
  const signedHalfWidth =
    (halfSide.x * (widthPoint.y - center.y) - halfSide.y * (widthPoint.x - center.x)) /
    halfSideLength
  if (Math.abs(signedHalfWidth) <= MIN_GEOMETRY_DISTANCE) return null
  const halfWidth = {
    x: (-halfSide.y * signedHalfWidth) / halfSideLength,
    y: (halfSide.x * signedHalfWidth) / halfSideLength,
  }
  return {
    corners: [
      { x: center.x - halfSide.x - halfWidth.x, y: center.y - halfSide.y - halfWidth.y },
      { x: center.x + halfSide.x - halfWidth.x, y: center.y + halfSide.y - halfWidth.y },
      { x: center.x + halfSide.x + halfWidth.x, y: center.y + halfSide.y + halfWidth.y },
      { x: center.x - halfSide.x + halfWidth.x, y: center.y - halfSide.y + halfWidth.y },
    ],
    oppositeSidePoint: { x: center.x - halfSide.x, y: center.y - halfSide.y },
  }
}

function centeredAlignedRectangleConstraints(
  centerId: SketchEntityId,
  sidePointId: SketchEntityId,
  oppositeSidePointId: SketchEntityId,
  axisLineId: SketchEntityId,
  lineIds: FourEntityIds,
  createConstraintId: ConstraintIdFactory,
) {
  const [, secondLineId, , fourthLineId] = lineIds
  const midpointDefinitions = [
    { type: "midpoint", pointId: centerId, lineId: axisLineId },
    { type: "midpoint", pointId: sidePointId, lineId: secondLineId },
    { type: "midpoint", pointId: oppositeSidePointId, lineId: fourthLineId },
  ] as const
  return [
    ...alignedRectangleConstraints(lineIds, createConstraintId),
    ...midpointDefinitions.map(
      ({ pointId, lineId }): SketchConstraint => ({
        schemaVersion: 0,
        id: createConstraintId(),
        type: "midpoint",
        pointId,
        lineId,
      }),
    ),
  ]
}

export function appendSketchCenteredAlignedRectangle(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    sidePoint: SketchPointTarget
    widthPoint: SketchPoint2
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const center = resolvePointTarget(sketch, input.center, true, input.createEntityId)
  const sketchWithCenter = center.entity
    ? parsedSketch(sketch, [...sketch.entities, center.entity])
    : sketch
  const sidePoint = resolvePointTarget(
    sketchWithCenter,
    input.sidePoint,
    true,
    input.createEntityId,
  )
  if (
    center.id === sidePoint.id ||
    distance(center.point, sidePoint.point) <= MIN_GEOMETRY_DISTANCE
  ) {
    throw new RangeError("A centered aligned rectangle requires a nonzero center axis.")
  }
  const geometry = centeredAlignedRectangleGeometry(center.point, sidePoint.point, input.widthPoint)
  if (!geometry) {
    throw new RangeError("A centered aligned rectangle requires a nonzero perpendicular width.")
  }
  const oppositeSidePointId = input.createEntityId()
  const axisLineId = input.createEntityId()
  const cornerIds = allocateFourEntityIds(input.createEntityId)
  const outline = closedLineEntities(cornerIds, construction, input.createEntityId)
  const additions: SketchEntity[] = [
    ...(center.entity ? [center.entity] : []),
    ...(sidePoint.entity ? [sidePoint.entity] : []),
    {
      schemaVersion: 0,
      id: oppositeSidePointId,
      type: "point",
      ...geometry.oppositeSidePoint,
      construction: true,
    },
    {
      schemaVersion: 0,
      id: axisLineId,
      type: "line",
      startPointId: oppositeSidePointId,
      endPointId: sidePoint.id,
      construction: true,
    },
    ...pointEntities(cornerIds, geometry.corners, construction),
    ...outline.entities,
  ]
  const constraints = centeredAlignedRectangleConstraints(
    center.id,
    sidePoint.id,
    oppositeSidePointId,
    axisLineId,
    outline.lineIds,
    input.createConstraintId,
  )
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...sketch.entities, ...additions],
      constraints: [...sketch.constraints, ...constraints],
    }),
    createdEntityIds: additions.map(({ id }) => id),
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

export type StraightSlotGeometry = Readonly<{
  endNegative: SketchPoint2
  endPositive: SketchPoint2
  radius: number
  startNegative: SketchPoint2
  startPositive: SketchPoint2
}>

export function straightSlotGeometry(
  startCenter: SketchPoint2,
  endCenter: SketchPoint2,
  widthPoint: SketchPoint2,
): StraightSlotGeometry | null {
  const axis = { x: endCenter.x - startCenter.x, y: endCenter.y - startCenter.y }
  const axisLength = Math.hypot(axis.x, axis.y)
  if (axisLength <= MIN_GEOMETRY_DISTANCE) return null
  const unitNormal = { x: -axis.y / axisLength, y: axis.x / axisLength }
  const radius = Math.abs(
    (widthPoint.x - startCenter.x) * unitNormal.x + (widthPoint.y - startCenter.y) * unitNormal.y,
  )
  if (radius <= MIN_GEOMETRY_DISTANCE) return null
  const offset = { x: unitNormal.x * radius, y: unitNormal.y * radius }
  return {
    endNegative: { x: endCenter.x - offset.x, y: endCenter.y - offset.y },
    endPositive: { x: endCenter.x + offset.x, y: endCenter.y + offset.y },
    radius,
    startNegative: { x: startCenter.x - offset.x, y: startCenter.y - offset.y },
    startPositive: { x: startCenter.x + offset.x, y: startCenter.y + offset.y },
  }
}

function slotBoundaryEntities(
  centerLine: Extract<SketchEntity, { type: "line" }>,
  geometry: StraightSlotGeometry,
  construction: boolean,
  createEntityId: EntityIdFactory,
) {
  const startPositiveId = createEntityId()
  const endPositiveId = createEntityId()
  const endNegativeId = createEntityId()
  const startNegativeId = createEntityId()
  const positiveLineId = createEntityId()
  const negativeLineId = createEntityId()
  const endArcId = createEntityId()
  const startArcId = createEntityId()
  const entities: SketchEntity[] = [
    {
      schemaVersion: 0,
      id: startPositiveId,
      type: "point",
      ...geometry.startPositive,
      construction,
    },
    {
      schemaVersion: 0,
      id: endPositiveId,
      type: "point",
      ...geometry.endPositive,
      construction,
    },
    {
      schemaVersion: 0,
      id: endNegativeId,
      type: "point",
      ...geometry.endNegative,
      construction,
    },
    {
      schemaVersion: 0,
      id: startNegativeId,
      type: "point",
      ...geometry.startNegative,
      construction,
    },
    {
      schemaVersion: 0,
      id: positiveLineId,
      type: "line",
      startPointId: startPositiveId,
      endPointId: endPositiveId,
      construction,
    },
    {
      schemaVersion: 0,
      id: negativeLineId,
      type: "line",
      startPointId: endNegativeId,
      endPointId: startNegativeId,
      construction,
    },
    {
      schemaVersion: 0,
      id: endArcId,
      type: "arc",
      centerPointId: centerLine.endPointId,
      startPointId: endNegativeId,
      endPointId: endPositiveId,
      construction,
    },
    {
      schemaVersion: 0,
      id: startArcId,
      type: "arc",
      centerPointId: centerLine.startPointId,
      startPointId: startPositiveId,
      endPointId: startNegativeId,
      construction,
    },
  ]
  return {
    entities,
    positiveLineId,
  }
}

function slotConstraints(
  centerLineId: SketchEntityId,
  boundary: ReturnType<typeof slotBoundaryEntities>,
  createConstraintId: ConstraintIdFactory,
): readonly SketchConstraint[] {
  const definitions = [
    {
      type: "parallel",
      firstEntityId: centerLineId,
      secondEntityId: boundary.positiveLineId,
    },
  ] as const
  return definitions.map(
    (definition): SketchConstraint => ({
      schemaVersion: 0,
      id: createConstraintId(),
      ...definition,
    }),
  )
}

function lineEntity(sketch: SketchRecord, lineId: SketchEntityId) {
  const line = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "line" }> =>
      entity.id === lineId && entity.type === "line",
  )
  if (!line) throw new TypeError("A slot centerline must reference an existing line entity.")
  return line
}

export function appendSketchSlotAroundLine(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    lineId: SketchEntityId
    widthPoint: SketchPoint2
  },
): SketchAppendResult {
  const centerLine = lineEntity(sketch, input.lineId)
  const startCenter = pointById(sketch, centerLine.startPointId)
  const endCenter = pointById(sketch, centerLine.endPointId)
  const geometry = straightSlotGeometry(startCenter, endCenter, input.widthPoint)
  if (!geometry) throw new RangeError("A sketch slot requires a positive axis and width.")
  const boundary = slotBoundaryEntities(
    centerLine,
    geometry,
    input.construction ?? false,
    input.createEntityId,
  )
  const constraints = slotConstraints(centerLine.id, boundary, input.createConstraintId)
  const entities = sketch.entities.map((entity) =>
    entity.id === centerLine.id ? { ...entity, construction: true } : entity,
  )
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...entities, ...boundary.entities],
      constraints: [...sketch.constraints, ...constraints],
    }),
    createdEntityIds: boundary.entities.map(({ id }) => id),
  }
}

function appendedLineId(result: SketchAppendResult) {
  const lineId = result.createdEntityIds.at(-1)
  if (!lineId) throw new TypeError("A slot centerline identity allocation failed.")
  lineEntity(result.sketch, lineId)
  return lineId
}

export function appendSketchStraightSlot(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    endCenter: SketchPointTarget
    startCenter: SketchPointTarget
    widthPoint: SketchPoint2
  },
): SketchAppendResult {
  const centerLine = appendSketchLine(sketch, {
    construction: true,
    createEntityId: input.createEntityId,
    end: input.endCenter,
    start: input.startCenter,
  })
  const slot = appendSketchSlotAroundLine(centerLine.sketch, {
    ...(input.construction === undefined ? {} : { construction: input.construction }),
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    lineId: appendedLineId(centerLine),
    widthPoint: input.widthPoint,
  })
  return {
    sketch: slot.sketch,
    createdEntityIds: [...centerLine.createdEntityIds, ...slot.createdEntityIds],
  }
}

export function appendSketchCenteredSlot(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    endCenter: SketchPointTarget
    widthPoint: SketchPoint2
  },
): SketchAppendResult {
  const centerLine = appendSketchMidpointLine(sketch, {
    construction: true,
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    endpoint: input.endCenter,
    midpoint: input.center,
  })
  const slot = appendSketchSlotAroundLine(centerLine.sketch, {
    ...(input.construction === undefined ? {} : { construction: input.construction }),
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    lineId: appendedLineId(centerLine),
    widthPoint: input.widthPoint,
  })
  return {
    sketch: slot.sketch,
    createdEntityIds: [...centerLine.createdEntityIds, ...slot.createdEntityIds],
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

export type TangentArcGeometry = Readonly<{
  center: SketchPoint2
  sharedEndpoint: "end" | "start"
}>

export function tangentArcGeometry(
  lineInterior: SketchPoint2,
  sharedEndpoint: SketchPoint2,
  requestedEnd: SketchPoint2,
): TangentArcGeometry | null {
  const tangentX = sharedEndpoint.x - lineInterior.x
  const tangentY = sharedEndpoint.y - lineInterior.y
  const tangentLength = Math.hypot(tangentX, tangentY)
  const chordX = requestedEnd.x - sharedEndpoint.x
  const chordY = requestedEnd.y - sharedEndpoint.y
  const chordLength = Math.hypot(chordX, chordY)
  if (tangentLength <= MIN_GEOMETRY_DISTANCE || chordLength <= MIN_GEOMETRY_DISTANCE) return null
  const normalX = -tangentY / tangentLength
  const normalY = tangentX / tangentLength
  const normalProjection = chordX * normalX + chordY * normalY
  if (Math.abs(normalProjection) <= MIN_GEOMETRY_DISTANCE * Math.max(chordLength, 1)) return null
  const centerDistance = chordLength ** 2 / (2 * normalProjection)
  return {
    center: {
      x: sharedEndpoint.x + normalX * centerDistance,
      y: sharedEndpoint.y + normalY * centerDistance,
    },
    sharedEndpoint: centerDistance > 0 ? "start" : "end",
  }
}

export function appendSketchTangentArc(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    end: SketchPointTarget
    lineId: SketchEntityId
    startPointId: SketchEntityId
  },
): SketchAppendResult {
  const line = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "line" }> =>
      entity.id === input.lineId && entity.type === "line",
  )
  if (!line) throw new TypeError("A tangent arc must reference an existing line.")
  const startsAtFirst = line.startPointId === input.startPointId
  if (!startsAtFirst && line.endPointId !== input.startPointId) {
    throw new TypeError("A tangent arc must start at an endpoint of its reference line.")
  }
  const construction = input.construction ?? false
  const start = pointById(sketch, input.startPointId)
  const interior = pointById(sketch, startsAtFirst ? line.endPointId : line.startPointId)
  const end = resolvePointTarget(sketch, input.end, construction, input.createEntityId)
  if (end.id === start.id) throw new RangeError("A tangent arc requires a distinct endpoint.")
  const geometry = tangentArcGeometry(interior, start, end.point)
  if (!geometry) {
    throw new RangeError("A tangent arc requires an endpoint away from the tangent line.")
  }
  const centerPointId = input.createEntityId()
  const arcId = input.createEntityId()
  const additions: SketchEntity[] = [
    ...(end.entity ? [end.entity] : []),
    {
      schemaVersion: 0,
      id: centerPointId,
      type: "point",
      ...geometry.center,
      construction: true,
    },
    {
      schemaVersion: 0,
      id: arcId,
      type: "arc",
      centerPointId,
      startPointId: geometry.sharedEndpoint === "start" ? start.id : end.id,
      endPointId: geometry.sharedEndpoint === "end" ? start.id : end.id,
      construction,
    },
  ]
  const tangent: SketchConstraint = {
    schemaVersion: 0,
    id: input.createConstraintId(),
    type: "tangent",
    arcId,
    lineId: line.id,
  }
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...sketch.entities, ...additions],
      constraints: [...sketch.constraints, tangent],
    }),
    createdEntityIds: additions.map(({ id }) => id),
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

export type ThreePointCircleGeometry = Readonly<{
  center: SketchPoint2
  radius: number
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

export function threePointCircleGeometry(
  first: SketchPoint2,
  second: SketchPoint2,
  third: SketchPoint2,
): ThreePointCircleGeometry | null {
  const arc = threePointArcGeometry(first, second, third)
  return arc ? { center: arc.center, radius: distance(arc.center, first) } : null
}

export function appendSketchThreePointCircle(
  sketch: SketchRecord,
  input: {
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    firstPoint: SketchPointTarget
    secondPoint: SketchPointTarget
    thirdPoint: SketchPointTarget
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const first = resolvePointTarget(sketch, input.firstPoint, construction, input.createEntityId)
  const sketchWithFirst = first.entity
    ? parsedSketch(sketch, [...sketch.entities, first.entity])
    : sketch
  const second = resolvePointTarget(
    sketchWithFirst,
    input.secondPoint,
    construction,
    input.createEntityId,
  )
  const sketchWithSecond = second.entity
    ? parsedSketch(sketchWithFirst, [...sketchWithFirst.entities, second.entity])
    : sketchWithFirst
  const third = resolvePointTarget(
    sketchWithSecond,
    input.thirdPoint,
    construction,
    input.createEntityId,
  )
  if (new Set([first.id, second.id, third.id]).size !== 3) {
    throw new RangeError("A three-point circle requires three distinct points.")
  }
  const geometry = threePointCircleGeometry(first.point, second.point, third.point)
  if (!geometry) {
    throw new RangeError("A three-point circle requires three non-collinear positions.")
  }
  const centerPointId = input.createEntityId()
  const circleId = input.createEntityId()
  const circle = {
    schemaVersion: 0,
    id: circleId,
    type: "circle",
    centerPointId,
    radius: geometry.radius,
    construction,
  } as const
  const additions: SketchEntity[] = [
    ...(first.entity ? [first.entity] : []),
    ...(second.entity ? [second.entity] : []),
    ...(third.entity ? [third.entity] : []),
    {
      schemaVersion: 0,
      id: centerPointId,
      type: "point",
      ...geometry.center,
      construction: true,
    },
    circle,
  ]
  const constraints: SketchConstraint[] = [first.id, second.id, third.id].map((pointId) => ({
    schemaVersion: 0,
    id: input.createConstraintId(),
    type: "point-on-curve",
    pointId,
    curveId: circleId,
  }))
  return {
    sketch: sketchRecordSchema.parse({
      ...sketch,
      entities: [...sketch.entities, ...additions],
      constraints: [...sketch.constraints, ...constraints],
    }),
    createdEntityIds: additions.map(({ id }) => id),
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
