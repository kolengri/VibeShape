import { isString } from "is-what"
import type {
  SketchConstraintId,
  SketchEntityId,
  SketchExternalReferenceId,
  SketchId,
} from "./identifiers"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  projectedExternalSketchEntities,
  type SketchConstraint,
  type SketchEntity,
  type SketchExternalCurveReference,
  type SketchExternalLineReference,
  type SketchExternalModelCurveReference,
  type SketchExternalModelIntersectionReference,
  type SketchExternalModelLineReference,
  type SketchExternalModelPointReference,
  type SketchExternalModelReference,
  type SketchExternalPiercePointReference,
  type SketchExternalPointReference,
  type SketchExternalReference,
  type SketchFeatureFaceSupport,
  type SketchRecord,
  sketchConstraintSchema,
  sketchRecordSchema,
} from "./sketch"
import type { AngleQuantity, LengthQuantity } from "./units"

export type SketchPoint2 = Readonly<{ x: number; y: number }>

export type SketchSupportReplacement =
  | Readonly<{ kind: "origin-plane"; plane: SketchRecord["plane"] }>
  | Readonly<{
      kind: "feature-face"
      plane: SketchRecord["plane"]
      support: SketchFeatureFaceSupport
    }>

export type SketchExternalReferenceReplacement =
  | Readonly<Pick<SketchExternalPointReference, "kind" | "sourceSketchId" | "sourcePointId">>
  | Readonly<Pick<SketchExternalLineReference, "kind" | "sourceSketchId" | "sourceLineId">>
  | Readonly<Pick<SketchExternalPiercePointReference, "kind" | "sourceSketchId" | "sourceLineId">>
  | Readonly<
      Pick<
        SketchExternalCurveReference,
        "kind" | "projectedType" | "sourceSketchId" | "sourceEntityId" | "sourceType"
      >
    >
  | Readonly<Pick<SketchExternalModelPointReference, "kind" | "reference">>
  | Readonly<Pick<SketchExternalModelLineReference, "kind" | "reference">>
  | Readonly<
      Pick<SketchExternalModelCurveReference, "kind" | "projectedType" | "reference" | "sourceType">
    >
  | Readonly<Pick<SketchExternalModelIntersectionReference, "kind" | "reference">>

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

export const MIN_REGULAR_POLYGON_SIDES = 3
export const MAX_REGULAR_POLYGON_SIDES = 50

export type RegularPolygonMode = "circumscribed" | "inscribed"

function distance(first: SketchPoint2, second: SketchPoint2) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

export type SketchLineIntersection = Readonly<{
  firstParameter: number
  point: SketchPoint2
  secondParameter: number
}>

export function sketchLineIntersection(
  firstStart: SketchPoint2,
  firstEnd: SketchPoint2,
  secondStart: SketchPoint2,
  secondEnd: SketchPoint2,
): SketchLineIntersection | null {
  const firstX = firstEnd.x - firstStart.x
  const firstY = firstEnd.y - firstStart.y
  const secondX = secondEnd.x - secondStart.x
  const secondY = secondEnd.y - secondStart.y
  const denominator = firstX * secondY - firstY * secondX
  const scale = Math.max(Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY), 1)
  if (Math.abs(denominator) <= MIN_GEOMETRY_DISTANCE * scale) return null
  const offsetX = secondStart.x - firstStart.x
  const offsetY = secondStart.y - firstStart.y
  const firstParameter = (offsetX * secondY - offsetY * secondX) / denominator
  const secondParameter = (offsetX * firstY - offsetY * firstX) / denominator
  return {
    firstParameter,
    point: {
      x: firstStart.x + firstX * firstParameter,
      y: firstStart.y + firstY * firstParameter,
    },
    secondParameter,
  }
}

export function requireSketchPoint(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  missingMessage = "A sketch operation requires an existing point entity.",
) {
  const point = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "point" }> =>
      entity.id === pointId && entity.type === "point",
  )
  if (!point) throw new TypeError(missingMessage)
  return point
}

function pointById(sketch: SketchRecord, pointId: SketchEntityId) {
  return requireSketchPoint(
    sketch,
    pointId,
    "A sketch point target must reference an existing point entity.",
  )
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
  support?: SketchRecord["support"]
}): SketchRecord {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: input.id,
    label: input.label,
    plane: input.plane,
    ...(input.support ? { support: input.support } : {}),
    entities: [],
    constraints: [],
  })
}

export function replaceSketchSupport(
  sketch: SketchRecord,
  support: SketchSupportReplacement,
): SketchRecord {
  if (support.kind === "origin-plane") {
    const { support: _staleSupport, ...withoutSupport } = sketch
    return sketchRecordSchema.parse({ ...withoutSupport, plane: support.plane })
  }
  return sketchRecordSchema.parse({ ...sketch, plane: support.plane, support: support.support })
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

function sketchLineById(sketch: SketchRecord, lineId: SketchEntityId) {
  const line = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "line" }> =>
      entity.id === lineId && entity.type === "line",
  )
  if (!line) throw new TypeError("A sketch line operation must reference an existing line entity.")
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
  const centerLine = sketchLineById(sketch, input.lineId)
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
  sketchLineById(result.sketch, lineId)
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

export type SketchEllipseGeometry = Readonly<{
  center: SketchPoint2
  primaryAxisPoint: SketchPoint2
  primaryRadius: number
  secondaryAxisPoint: SketchPoint2
  secondaryRadius: number
}>

export type SketchEllipticalArcGeometry = SketchEllipseGeometry &
  Readonly<{
    endParameter: number
    endPoint: SketchPoint2
    startParameter: number
    startPoint: SketchPoint2
    sweep: number
  }>

const TWO_PI = Math.PI * 2

export function sketchEllipseGeometry(
  center: SketchPoint2,
  primaryAxisPoint: SketchPoint2,
  secondaryRadiusPoint: SketchPoint2,
): SketchEllipseGeometry | null {
  const primaryX = primaryAxisPoint.x - center.x
  const primaryY = primaryAxisPoint.y - center.y
  const primaryRadius = Math.hypot(primaryX, primaryY)
  if (!Number.isFinite(primaryRadius) || primaryRadius <= MIN_GEOMETRY_DISTANCE) return null
  const perpendicular = { x: -primaryY / primaryRadius, y: primaryX / primaryRadius }
  const pointerX = secondaryRadiusPoint.x - center.x
  const pointerY = secondaryRadiusPoint.y - center.y
  const signedSecondaryRadius = pointerX * perpendicular.x + pointerY * perpendicular.y
  const secondaryRadius = Math.abs(signedSecondaryRadius)
  if (!Number.isFinite(secondaryRadius) || secondaryRadius <= MIN_GEOMETRY_DISTANCE) return null
  const direction = signedSecondaryRadius < 0 ? -1 : 1
  return {
    center,
    primaryAxisPoint,
    primaryRadius,
    secondaryAxisPoint: {
      x: center.x + perpendicular.x * secondaryRadius * direction,
      y: center.y + perpendicular.y * secondaryRadius * direction,
    },
    secondaryRadius,
  }
}

function sketchEllipseDirections(geometry: SketchEllipseGeometry) {
  return {
    primary: {
      x: (geometry.primaryAxisPoint.x - geometry.center.x) / geometry.primaryRadius,
      y: (geometry.primaryAxisPoint.y - geometry.center.y) / geometry.primaryRadius,
    },
    secondary: {
      x: (geometry.secondaryAxisPoint.x - geometry.center.x) / geometry.secondaryRadius,
      y: (geometry.secondaryAxisPoint.y - geometry.center.y) / geometry.secondaryRadius,
    },
  }
}

export function sketchEllipsePointAt(geometry: SketchEllipseGeometry, parameter: number) {
  const directions = sketchEllipseDirections(geometry)
  return {
    x:
      geometry.center.x +
      Math.cos(parameter) * geometry.primaryRadius * directions.primary.x +
      Math.sin(parameter) * geometry.secondaryRadius * directions.secondary.x,
    y:
      geometry.center.y +
      Math.cos(parameter) * geometry.primaryRadius * directions.primary.y +
      Math.sin(parameter) * geometry.secondaryRadius * directions.secondary.y,
  }
}

export function sketchEllipseParameterForPoint(
  geometry: SketchEllipseGeometry,
  point: SketchPoint2,
) {
  const directions = sketchEllipseDirections(geometry)
  const offset = { x: point.x - geometry.center.x, y: point.y - geometry.center.y }
  const cosine =
    (offset.x * directions.primary.x + offset.y * directions.primary.y) / geometry.primaryRadius
  const sine =
    (offset.x * directions.secondary.x + offset.y * directions.secondary.y) /
    geometry.secondaryRadius
  return Math.atan2(sine, cosine)
}

export function projectPointToSketchEllipse(geometry: SketchEllipseGeometry, point: SketchPoint2) {
  const parameter = sketchEllipseParameterForPoint(geometry, point)
  return { parameter, point: sketchEllipsePointAt(geometry, parameter) }
}

export function sketchEllipticalArcStartGeometry(
  center: SketchPoint2,
  primaryAxisPoint: SketchPoint2,
  startRadiusPoint: SketchPoint2,
  fallbackSecondaryRadius?: number,
) {
  const primaryX = primaryAxisPoint.x - center.x
  const primaryY = primaryAxisPoint.y - center.y
  const primaryRadius = Math.hypot(primaryX, primaryY)
  if (!Number.isFinite(primaryRadius) || primaryRadius <= MIN_GEOMETRY_DISTANCE) return null
  const primaryDirection = { x: primaryX / primaryRadius, y: primaryY / primaryRadius }
  const perpendicular = { x: -primaryDirection.y, y: primaryDirection.x }
  const offset = { x: startRadiusPoint.x - center.x, y: startRadiusPoint.y - center.y }
  const localX = offset.x * primaryDirection.x + offset.y * primaryDirection.y
  const localY = offset.x * perpendicular.x + offset.y * perpendicular.y
  const cosine = Math.max(-1, Math.min(1, localX / primaryRadius))
  const sineMagnitude = Math.sqrt(Math.max(0, 1 - cosine * cosine))
  const derivedRadius =
    sineMagnitude > MIN_GEOMETRY_DISTANCE
      ? Math.abs(localY) / sineMagnitude
      : (fallbackSecondaryRadius ?? primaryRadius / 2)
  if (!Number.isFinite(derivedRadius) || derivedRadius <= MIN_GEOMETRY_DISTANCE) return null
  const direction = localY < 0 ? -1 : 1
  const ellipse = sketchEllipseGeometry(center, primaryAxisPoint, {
    x: center.x + perpendicular.x * derivedRadius * direction,
    y: center.y + perpendicular.y * derivedRadius * direction,
  })
  if (!ellipse) return null
  const start = projectPointToSketchEllipse(ellipse, startRadiusPoint)
  return { ...ellipse, startParameter: start.parameter, startPoint: start.point }
}

function positiveParameterSweep(start: number, end: number) {
  const sweep = (((end - start) % TWO_PI) + TWO_PI) % TWO_PI
  return sweep <= MIN_GEOMETRY_DISTANCE ? 0 : sweep
}

export function sketchEllipticalArcGeometry(
  center: SketchPoint2,
  primaryAxisPoint: SketchPoint2,
  secondaryAxisPoint: SketchPoint2,
  startPoint: SketchPoint2,
  endPoint: SketchPoint2,
): SketchEllipticalArcGeometry | null {
  const ellipse = sketchEllipseGeometry(center, primaryAxisPoint, secondaryAxisPoint)
  if (!ellipse) return null
  const start = projectPointToSketchEllipse(ellipse, startPoint)
  const end = projectPointToSketchEllipse(ellipse, endPoint)
  const sweep = positiveParameterSweep(start.parameter, end.parameter)
  if (sweep === 0) return null
  return {
    ...ellipse,
    endParameter: end.parameter,
    endPoint: end.point,
    startParameter: start.parameter,
    startPoint: start.point,
    sweep,
  }
}

export function appendSketchEllipse(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    createEntityId: EntityIdFactory
    primaryAxisPoint: SketchPointTarget
    secondaryRadiusPoint: SketchPoint2
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const center = resolvePointTarget(sketch, input.center, construction, input.createEntityId)
  const primaryAxisPoint = resolvePointTarget(
    sketch,
    input.primaryAxisPoint,
    construction,
    input.createEntityId,
  )
  if (center.id === primaryAxisPoint.id) {
    throw new RangeError("A sketch ellipse requires a nonzero primary radius.")
  }
  const geometry = sketchEllipseGeometry(
    center.point,
    primaryAxisPoint.point,
    input.secondaryRadiusPoint,
  )
  if (!geometry) throw new RangeError("A sketch ellipse requires two positive axis radii.")
  const secondaryAxisPointId = input.createEntityId()
  const ellipseId = input.createEntityId()
  const additions: SketchEntity[] = [
    ...(center.entity ? [center.entity] : []),
    ...(primaryAxisPoint.entity ? [primaryAxisPoint.entity] : []),
    {
      schemaVersion: 0,
      id: secondaryAxisPointId,
      type: "point",
      ...geometry.secondaryAxisPoint,
      construction,
    },
    {
      schemaVersion: 0,
      id: ellipseId,
      type: "ellipse",
      centerPointId: center.id,
      primaryAxisPointId: primaryAxisPoint.id,
      secondaryAxisPointId,
      construction,
    },
  ]
  return {
    sketch: parsedSketch(sketch, [...sketch.entities, ...additions]),
    createdEntityIds: additions.map(({ id }) => id),
  }
}

function resolvedEllipseArcPoint(
  sketch: SketchRecord,
  target: SketchPointTarget,
  projectedPoint: SketchPoint2,
  construction: boolean,
  createEntityId: EntityIdFactory,
  reusablePoints: readonly Readonly<{ id: SketchEntityId; point: SketchPoint2 }>[],
) {
  const tolerance = MIN_GEOMETRY_DISTANCE * 100
  if (target.kind === "existing") {
    const point = pointById(sketch, target.pointId)
    if (distance(point, projectedPoint) > tolerance) {
      throw new RangeError("An existing elliptical-arc point must lie on the ellipse.")
    }
    return { entity: null, id: point.id, point }
  }
  const reusable = reusablePoints.find(({ point }) => distance(point, projectedPoint) <= tolerance)
  if (reusable) return { entity: null, ...reusable }
  const entity = {
    schemaVersion: 0,
    id: createEntityId(),
    type: "point",
    ...projectedPoint,
    construction,
  } as const
  return { entity, id: entity.id, point: entity }
}

export function appendSketchEllipticalArc(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    createEntityId: EntityIdFactory
    endPoint: SketchPointTarget
    primaryAxisPoint: SketchPointTarget
    secondaryAxisPoint: SketchPoint2
    startPoint: SketchPointTarget
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const center = resolvePointTarget(sketch, input.center, construction, input.createEntityId)
  const primaryAxisPoint = resolvePointTarget(
    sketch,
    input.primaryAxisPoint,
    construction,
    input.createEntityId,
  )
  if (center.id === primaryAxisPoint.id) {
    throw new RangeError("A sketch elliptical arc requires a nonzero primary radius.")
  }
  const pointForInputTarget = (target: SketchPointTarget) =>
    target.kind === "existing" ? pointById(sketch, target.pointId) : target.point
  const geometry = sketchEllipticalArcGeometry(
    center.point,
    primaryAxisPoint.point,
    input.secondaryAxisPoint,
    pointForInputTarget(input.startPoint),
    pointForInputTarget(input.endPoint),
  )
  if (!geometry) {
    throw new RangeError("A sketch elliptical arc requires positive axes and distinct endpoints.")
  }
  const secondaryAxisPointId = input.createEntityId()
  const secondaryAxisPoint = {
    schemaVersion: 0,
    id: secondaryAxisPointId,
    type: "point",
    ...geometry.secondaryAxisPoint,
    construction,
  } as const
  const reusablePoints = [
    { id: center.id, point: center.point },
    { id: primaryAxisPoint.id, point: primaryAxisPoint.point },
    { id: secondaryAxisPointId, point: secondaryAxisPoint },
  ]
  const start = resolvedEllipseArcPoint(
    sketch,
    input.startPoint,
    geometry.startPoint,
    construction,
    input.createEntityId,
    reusablePoints,
  )
  const end = resolvedEllipseArcPoint(
    sketch,
    input.endPoint,
    geometry.endPoint,
    construction,
    input.createEntityId,
    [...reusablePoints, { id: start.id, point: start.point }],
  )
  if (start.id === end.id) {
    throw new RangeError("A sketch elliptical arc requires distinct endpoints.")
  }
  const arcId = input.createEntityId()
  const additions: SketchEntity[] = [
    ...(center.entity ? [center.entity] : []),
    ...(primaryAxisPoint.entity ? [primaryAxisPoint.entity] : []),
    secondaryAxisPoint,
    ...(start.entity ? [start.entity] : []),
    ...(end.entity ? [end.entity] : []),
    {
      schemaVersion: 0,
      id: arcId,
      type: "elliptical-arc",
      centerPointId: center.id,
      primaryAxisPointId: primaryAxisPoint.id,
      secondaryAxisPointId,
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

export type RegularPolygonGeometry = Readonly<{
  constructionRadius: number
  mode: RegularPolygonMode
  tangentPoints: readonly SketchPoint2[]
  vertices: readonly SketchPoint2[]
}>

function assertRegularPolygonSideCount(sideCount: number) {
  if (
    !Number.isInteger(sideCount) ||
    sideCount < MIN_REGULAR_POLYGON_SIDES ||
    sideCount > MAX_REGULAR_POLYGON_SIDES
  ) {
    throw new RangeError(
      `A regular polygon requires an integer side count from ${MIN_REGULAR_POLYGON_SIDES} through ${MAX_REGULAR_POLYGON_SIDES}.`,
    )
  }
}

function pointsAroundCircle(
  center: SketchPoint2,
  radius: number,
  startAngle: number,
  sideCount: number,
) {
  const angleStep = (Math.PI * 2) / sideCount
  return Array.from({ length: sideCount }, (_, index): SketchPoint2 => {
    const angle = startAngle + angleStep * index
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

export function regularPolygonGeometry(
  center: SketchPoint2,
  radiusPoint: SketchPoint2,
  sideCount: number,
  mode: RegularPolygonMode,
): RegularPolygonGeometry | null {
  assertRegularPolygonSideCount(sideCount)
  const constructionRadius = distance(center, radiusPoint)
  if (!Number.isFinite(constructionRadius) || constructionRadius <= MIN_GEOMETRY_DISTANCE) {
    return null
  }
  const radiusAngle = Math.atan2(radiusPoint.y - center.y, radiusPoint.x - center.x)
  if (mode === "circumscribed") {
    return {
      constructionRadius,
      mode,
      tangentPoints: [],
      vertices: pointsAroundCircle(center, constructionRadius, radiusAngle, sideCount),
    }
  }
  const halfAngle = Math.PI / sideCount
  const vertexRadius = constructionRadius / Math.cos(halfAngle)
  return {
    constructionRadius,
    mode,
    tangentPoints: pointsAroundCircle(center, constructionRadius, radiusAngle, sideCount),
    vertices: pointsAroundCircle(center, vertexRadius, radiusAngle - halfAngle, sideCount),
  }
}

function allocateEntityIds(count: number, createEntityId: EntityIdFactory) {
  return Array.from({ length: count }, () => createEntityId())
}

function polygonPointEntities(
  pointIds: readonly SketchEntityId[],
  points: readonly SketchPoint2[],
  construction: boolean,
) {
  if (pointIds.length !== points.length) {
    throw new TypeError("Regular polygon point identity allocation failed.")
  }
  return points.map(
    (point, index): SketchEntity => ({
      schemaVersion: 0,
      id: pointIds[index] as SketchEntityId,
      type: "point",
      ...point,
      construction,
    }),
  )
}

function polygonLineEntities(
  pointIds: readonly SketchEntityId[],
  construction: boolean,
  createEntityId: EntityIdFactory,
) {
  const lineIds = allocateEntityIds(pointIds.length, createEntityId)
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

function polygonConstructionCircle(
  centerPointId: SketchEntityId,
  radius: number,
  createEntityId: EntityIdFactory,
): Extract<SketchEntity, { type: "circle" }> {
  return {
    schemaVersion: 0,
    id: createEntityId(),
    type: "circle",
    centerPointId,
    radius,
    construction: true,
  }
}

function circumscribedPolygonConstraints(
  vertexIds: readonly SketchEntityId[],
  lineIds: readonly SketchEntityId[],
  circleId: SketchEntityId,
  createConstraintId: ConstraintIdFactory,
) {
  const firstLineId = lineIds[0]
  if (!firstLineId) throw new TypeError("A regular polygon requires an outline.")
  const curveConstraints = vertexIds.map(
    (pointId): SketchConstraint => ({
      schemaVersion: 0,
      id: createConstraintId(),
      type: "point-on-curve",
      pointId,
      curveId: circleId,
    }),
  )
  const equalConstraints = lineIds.slice(1).map(
    (secondEntityId): SketchConstraint => ({
      schemaVersion: 0,
      id: createConstraintId(),
      type: "equal",
      firstEntityId: firstLineId,
      secondEntityId,
    }),
  )
  return [...curveConstraints, ...equalConstraints]
}

function inscribedPolygonConstraints(
  tangentPointIds: readonly SketchEntityId[],
  outlineLineIds: readonly SketchEntityId[],
  circleId: SketchEntityId,
  createConstraintId: ConstraintIdFactory,
) {
  const tangentConstraints = tangentPointIds.flatMap(
    (pointId, index): readonly SketchConstraint[] => {
      const outlineLineId = outlineLineIds[index]
      if (!outlineLineId) {
        throw new TypeError("Regular polygon tangent identity allocation failed.")
      }
      return [
        {
          schemaVersion: 0,
          id: createConstraintId(),
          type: "midpoint",
          pointId,
          lineId: outlineLineId,
        },
        ...(index === tangentPointIds.length - 1
          ? []
          : [
              {
                schemaVersion: 0 as const,
                id: createConstraintId(),
                type: "point-on-curve" as const,
                pointId,
                curveId: circleId,
              },
            ]),
      ]
    },
  )
  const firstOutlineLineId = outlineLineIds[0]
  if (!firstOutlineLineId) {
    throw new TypeError("A regular polygon requires at least three outline references.")
  }
  const equalSideConstraints = outlineLineIds.slice(1).map(
    (outlineLineId): SketchConstraint => ({
      schemaVersion: 0,
      id: createConstraintId(),
      type: "equal",
      firstEntityId: firstOutlineLineId,
      secondEntityId: outlineLineId,
    }),
  )
  return [...tangentConstraints, ...equalSideConstraints]
}

function appendCircumscribedPolygon(
  sketch: SketchRecord,
  input: {
    center: ReturnType<typeof resolvePointTarget>
    construction: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    geometry: RegularPolygonGeometry
    radiusPoint: ReturnType<typeof resolvePointTarget>
  },
) {
  const remainingVertexIds = allocateEntityIds(
    input.geometry.vertices.length - 1,
    input.createEntityId,
  )
  const vertexIds = [input.radiusPoint.id, ...remainingVertexIds]
  const vertices = polygonPointEntities(
    remainingVertexIds,
    input.geometry.vertices.slice(1),
    input.construction,
  )
  const outline = polygonLineEntities(vertexIds, input.construction, input.createEntityId)
  const circle = polygonConstructionCircle(
    input.center.id,
    input.geometry.constructionRadius,
    input.createEntityId,
  )
  const additions: SketchEntity[] = [
    ...(input.center.entity ? [input.center.entity] : []),
    ...(input.radiusPoint.entity ? [input.radiusPoint.entity] : []),
    ...vertices,
    ...outline.entities,
    circle,
  ]
  const constraints = circumscribedPolygonConstraints(
    vertexIds,
    outline.lineIds,
    circle.id,
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

function appendInscribedPolygon(
  sketch: SketchRecord,
  input: {
    center: ReturnType<typeof resolvePointTarget>
    construction: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    geometry: RegularPolygonGeometry
    radiusPoint: ReturnType<typeof resolvePointTarget>
  },
) {
  const remainingTangentPointIds = allocateEntityIds(
    input.geometry.tangentPoints.length - 1,
    input.createEntityId,
  )
  const tangentPointIds = [input.radiusPoint.id, ...remainingTangentPointIds]
  const tangentPoints = polygonPointEntities(
    remainingTangentPointIds,
    input.geometry.tangentPoints.slice(1),
    true,
  )
  const vertexIds = allocateEntityIds(input.geometry.vertices.length, input.createEntityId)
  const vertices = polygonPointEntities(vertexIds, input.geometry.vertices, input.construction)
  const outline = polygonLineEntities(vertexIds, input.construction, input.createEntityId)
  const circle = polygonConstructionCircle(
    input.center.id,
    input.geometry.constructionRadius,
    input.createEntityId,
  )
  const additions: SketchEntity[] = [
    ...(input.center.entity ? [input.center.entity] : []),
    ...(input.radiusPoint.entity ? [input.radiusPoint.entity] : []),
    ...tangentPoints,
    ...vertices,
    ...outline.entities,
    circle,
  ]
  const constraints = inscribedPolygonConstraints(
    tangentPointIds,
    outline.lineIds,
    circle.id,
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

export function appendSketchRegularPolygon(
  sketch: SketchRecord,
  input: {
    center: SketchPointTarget
    construction?: boolean
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    mode: RegularPolygonMode
    radiusPoint: SketchPointTarget
    sideCount: number
  },
): SketchAppendResult {
  const construction = input.construction ?? false
  const center = resolvePointTarget(sketch, input.center, true, input.createEntityId)
  const sketchWithCenter = center.entity
    ? parsedSketch(sketch, [...sketch.entities, center.entity])
    : sketch
  const radiusPoint = resolvePointTarget(
    sketchWithCenter,
    input.radiusPoint,
    input.mode === "inscribed" ? true : construction,
    input.createEntityId,
  )
  const geometry = regularPolygonGeometry(
    center.point,
    radiusPoint.point,
    input.sideCount,
    input.mode,
  )
  if (center.id === radiusPoint.id || !geometry) {
    throw new RangeError("A regular polygon requires a positive construction radius.")
  }
  const append = input.mode === "inscribed" ? appendInscribedPolygon : appendCircumscribedPolygon
  return append(sketch, {
    center,
    construction,
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    geometry,
    radiusPoint,
  })
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

export function sketchConstraintEntityIds(constraint: SketchConstraint) {
  if (constraint.type === "offset") {
    return [
      ...constraint.linePairs.flatMap(({ sourceLineId, offsetLineId }) => [
        sourceLineId,
        offsetLineId,
      ]),
      ...constraint.endpointPairs.flatMap(({ sourcePointId, offsetPointId }) => [
        sourcePointId,
        offsetPointId,
      ]),
    ]
  }
  return Object.entries(constraint)
    .filter(([key, value]) => key !== "id" && key.endsWith("Id") && isString(value))
    .map(([, value]) => value as string)
}

export function sketchCurvePointIds(curve: Exclude<SketchEntity, { type: "point" }>) {
  switch (curve.type) {
    case "line":
      return [curve.startPointId, curve.endPointId]
    case "circle":
      return [curve.centerPointId]
    case "arc":
      return [curve.centerPointId, curve.startPointId, curve.endPointId]
    case "ellipse":
      return [curve.centerPointId, curve.primaryAxisPointId, curve.secondaryAxisPointId]
    case "elliptical-arc":
      return [
        curve.centerPointId,
        curve.primaryAxisPointId,
        curve.secondaryAxisPointId,
        curve.startPointId,
        curve.endPointId,
      ]
  }
}

export function sketchSourcePointIds(entities: readonly SketchEntity[]) {
  const pointIds = new Set<SketchEntityId>()
  for (const entity of entities) {
    if (entity.type === "point") pointIds.add(entity.id)
    else for (const pointId of sketchCurvePointIds(entity)) pointIds.add(pointId)
  }
  return [...pointIds]
}

function geometryPointIds(entity: SketchEntity) {
  return entity.type === "point" ? [] : sketchCurvePointIds(entity)
}

type SketchLineEntity = Extract<SketchEntity, { type: "line" }>
type SketchPointEntity = Extract<SketchEntity, { type: "point" }>
type LineOperationIntersection = SketchLineIntersection &
  Readonly<{
    boundary: SketchLineEntity
  }>

const LINE_OPERATION_PARAMETER_EPSILON = 1e-7

function sketchLinePoints(sketch: SketchRecord, line: SketchLineEntity) {
  return {
    end: pointById(sketch, line.endPointId),
    start: pointById(sketch, line.startPointId),
  }
}

function parameterOnSketchLine(sketch: SketchRecord, line: SketchLineEntity, point: SketchPoint2) {
  const { start, end } = sketchLinePoints(sketch, line)
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared <= MIN_GEOMETRY_DISTANCE ** 2) {
    throw new RangeError("A sketch line operation requires a non-degenerate line.")
  }
  return ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
}

function lineOperationIntersections(sketch: SketchRecord, target: SketchLineEntity) {
  const targetPoints = sketchLinePoints(sketch, target)
  const intersections = sketch.entities.flatMap((entity): LineOperationIntersection[] => {
    if (entity.type !== "line" || entity.id === target.id) return []
    const boundaryPoints = sketchLinePoints(sketch, entity)
    const intersection = sketchLineIntersection(
      targetPoints.start,
      targetPoints.end,
      boundaryPoints.start,
      boundaryPoints.end,
    )
    if (
      !intersection ||
      intersection.secondParameter < -LINE_OPERATION_PARAMETER_EPSILON ||
      intersection.secondParameter > 1 + LINE_OPERATION_PARAMETER_EPSILON
    ) {
      return []
    }
    return [{ ...intersection, boundary: entity }]
  })
  intersections.sort(
    (left, right) =>
      left.firstParameter - right.firstParameter ||
      left.boundary.id.localeCompare(right.boundary.id),
  )
  return intersections.filter(
    (intersection, index) =>
      index === 0 ||
      Math.abs(intersection.firstParameter - (intersections[index - 1]?.firstParameter ?? 0)) >
        LINE_OPERATION_PARAMETER_EPSILON,
  )
}

function matchingIntersectionPoint(
  sketch: SketchRecord,
  target: SketchLineEntity,
  intersection: LineOperationIntersection,
) {
  const candidateIds = [
    target.startPointId,
    target.endPointId,
    intersection.boundary.startPointId,
    intersection.boundary.endPointId,
  ]
  return candidateIds
    .map((pointId) => pointById(sketch, pointId))
    .find((point) => distance(point, intersection.point) <= MIN_GEOMETRY_DISTANCE)
}

function resolveLineOperationPoint(
  sketch: SketchRecord,
  target: SketchLineEntity,
  intersection: LineOperationIntersection,
  createEntityId: EntityIdFactory,
) {
  const existing = matchingIntersectionPoint(sketch, target, intersection)
  if (existing) return { entity: null, id: existing.id, point: existing }
  const id = createEntityId()
  const entity: SketchPointEntity = {
    schemaVersion: 0,
    id,
    type: "point",
    ...intersection.point,
    construction: target.construction,
  }
  return { entity, id, point: entity }
}

function replaceSketchLine(
  sketch: SketchRecord,
  line: SketchLineEntity,
  endpoints: Readonly<{ startPointId: SketchEntityId; endPointId: SketchEntityId }>,
  additions: readonly SketchEntity[],
) {
  return sketchRecordSchema.parse({
    ...sketch,
    entities: [
      ...sketch.entities.map((entity) =>
        entity.id === line.id ? { ...line, ...endpoints } : entity,
      ),
      ...additions,
    ],
  })
}

function appendPointOnBoundaryConstraint(
  sketch: SketchRecord,
  point: ReturnType<typeof resolveLineOperationPoint>,
  boundaryLineId: SketchEntityId,
  createConstraintId: ConstraintIdFactory,
) {
  return point.entity
    ? appendSketchConstraint(
        sketch,
        { type: "point-on-line", pointId: point.id, lineId: boundaryLineId },
        createConstraintId,
      )
    : sketch
}

function removeDetachedOperationPoints(sketch: SketchRecord, pointIds: readonly SketchEntityId[]) {
  const retainedByGeometry = new Set(
    sketch.entities.filter(({ type }) => type !== "point").flatMap(geometryPointIds),
  )
  const removableIds = new Set<string>(
    pointIds.filter((pointId) => !retainedByGeometry.has(pointId)),
  )
  return removableIds.size === 0
    ? sketch
    : sketchRecordSchema.parse({
        ...sketch,
        constraints: sketch.constraints.filter((constraint) =>
          sketchConstraintEntityIds(constraint).every((id) => !removableIds.has(id)),
        ),
        entities: sketch.entities.filter(({ id }) => !removableIds.has(id)),
      })
}

export function splitSketchLine(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    lineId: SketchEntityId
    point: SketchPoint2
  },
): SketchAppendResult {
  const line = sketchLineById(sketch, input.lineId)
  const parameter = parameterOnSketchLine(sketch, line, input.point)
  if (
    parameter <= LINE_OPERATION_PARAMETER_EPSILON ||
    parameter >= 1 - LINE_OPERATION_PARAMETER_EPSILON
  ) {
    throw new RangeError("A split point must lie inside the selected line.")
  }
  const points = sketchLinePoints(sketch, line)
  const splitPoint: SketchPointEntity = {
    schemaVersion: 0,
    id: input.createEntityId(),
    type: "point",
    x: points.start.x + (points.end.x - points.start.x) * parameter,
    y: points.start.y + (points.end.y - points.start.y) * parameter,
    construction: line.construction,
  }
  const secondLine: SketchLineEntity = {
    schemaVersion: 0,
    id: input.createEntityId(),
    type: "line",
    startPointId: splitPoint.id,
    endPointId: line.endPointId,
    construction: line.construction,
  }
  const replaced = replaceSketchLine(
    sketch,
    line,
    { startPointId: line.startPointId, endPointId: splitPoint.id },
    [splitPoint, secondLine],
  )
  return {
    sketch: appendSketchConstraint(
      replaced,
      { type: "parallel", firstEntityId: line.id, secondEntityId: secondLine.id },
      input.createConstraintId,
    ),
    createdEntityIds: [splitPoint.id, secondLine.id],
  }
}

function trimInteriorSketchLine(
  sketch: SketchRecord,
  line: SketchLineEntity,
  before: LineOperationIntersection,
  after: LineOperationIntersection,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
  },
): SketchAppendResult {
  const beforePoint = resolveLineOperationPoint(sketch, line, before, input.createEntityId)
  const afterPoint = resolveLineOperationPoint(sketch, line, after, input.createEntityId)
  const secondLine: SketchLineEntity = {
    schemaVersion: 0,
    id: input.createEntityId(),
    type: "line",
    startPointId: afterPoint.id,
    endPointId: line.endPointId,
    construction: line.construction,
  }
  const additions: SketchEntity[] = [
    ...(beforePoint.entity ? [beforePoint.entity] : []),
    ...(afterPoint.entity ? [afterPoint.entity] : []),
    secondLine,
  ]
  let next = replaceSketchLine(
    sketch,
    line,
    { startPointId: line.startPointId, endPointId: beforePoint.id },
    additions,
  )
  next = appendPointOnBoundaryConstraint(
    next,
    beforePoint,
    before.boundary.id,
    input.createConstraintId,
  )
  next = appendPointOnBoundaryConstraint(
    next,
    afterPoint,
    after.boundary.id,
    input.createConstraintId,
  )
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
    createdEntityIds: additions.map(({ id }) => id),
  }
}

function trimEndSketchLine(
  sketch: SketchRecord,
  line: SketchLineEntity,
  intersection: LineOperationIntersection,
  replaceStart: boolean,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
  },
): SketchAppendResult {
  const point = resolveLineOperationPoint(sketch, line, intersection, input.createEntityId)
  const replaced = replaceSketchLine(
    sketch,
    line,
    {
      startPointId: replaceStart ? point.id : line.startPointId,
      endPointId: replaceStart ? line.endPointId : point.id,
    },
    point.entity ? [point.entity] : [],
  )
  const constrained = appendPointOnBoundaryConstraint(
    replaced,
    point,
    intersection.boundary.id,
    input.createConstraintId,
  )
  const removedEndpointId = replaceStart ? line.startPointId : line.endPointId
  return {
    sketch: removeDetachedOperationPoints(constrained, [removedEndpointId]),
    createdEntityIds: point.entity ? [point.entity.id] : [],
  }
}

export function trimSketchLine(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    lineId: SketchEntityId
    point: SketchPoint2
  },
): SketchAppendResult {
  const line = sketchLineById(sketch, input.lineId)
  const pickedParameter = parameterOnSketchLine(sketch, line, input.point)
  const intersections = lineOperationIntersections(sketch, line).filter(
    ({ firstParameter }) =>
      firstParameter > LINE_OPERATION_PARAMETER_EPSILON &&
      firstParameter < 1 - LINE_OPERATION_PARAMETER_EPSILON,
  )
  if (intersections.length === 0) {
    throw new RangeError("Trim requires a bounded line intersection.")
  }
  const afterIndex = intersections.findIndex(
    ({ firstParameter }) => firstParameter > pickedParameter,
  )
  if (afterIndex === 0) {
    return trimEndSketchLine(
      sketch,
      line,
      intersections[0] as LineOperationIntersection,
      true,
      input,
    )
  }
  if (afterIndex < 0) {
    return trimEndSketchLine(
      sketch,
      line,
      intersections.at(-1) as LineOperationIntersection,
      false,
      input,
    )
  }
  return trimInteriorSketchLine(
    sketch,
    line,
    intersections[afterIndex - 1] as LineOperationIntersection,
    intersections[afterIndex] as LineOperationIntersection,
    input,
  )
}

export function extendSketchLine(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    lineId: SketchEntityId
    point: SketchPoint2
  },
): SketchAppendResult {
  const line = sketchLineById(sketch, input.lineId)
  const extendStart = parameterOnSketchLine(sketch, line, input.point) < 0.5
  const intersections = lineOperationIntersections(sketch, line).filter(({ firstParameter }) =>
    extendStart
      ? firstParameter < -LINE_OPERATION_PARAMETER_EPSILON
      : firstParameter > 1 + LINE_OPERATION_PARAMETER_EPSILON,
  )
  const intersection = extendStart ? intersections.at(-1) : intersections[0]
  if (!intersection) {
    throw new RangeError("Extend requires a reachable bounded line intersection.")
  }
  const point = resolveLineOperationPoint(sketch, line, intersection, input.createEntityId)
  const replaced = replaceSketchLine(
    sketch,
    line,
    {
      startPointId: extendStart ? point.id : line.startPointId,
      endPointId: extendStart ? line.endPointId : point.id,
    },
    point.entity ? [point.entity] : [],
  )
  const constrained = appendPointOnBoundaryConstraint(
    replaced,
    point,
    intersection.boundary.id,
    input.createConstraintId,
  )
  const removedEndpointId = extendStart ? line.startPointId : line.endPointId
  return {
    sketch: removeDetachedOperationPoints(constrained, [removedEndpointId]),
    createdEntityIds: point.entity ? [point.entity.id] : [],
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
    sketchConstraintEntityIds(constraint).every((entityId) => !removedIds.has(entityId)),
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

export function removeSketchExternalReference(
  sketch: SketchRecord,
  referenceId: SketchExternalReferenceId,
): SketchRecord {
  const reference = sketch.externalReferences?.find(({ id }) => id === referenceId)
  if (!reference) return sketch
  const projectedIds = new Set<string>(
    projectedExternalSketchEntities([reference]).map(({ id }) => id),
  )
  return sketchRecordSchema.parse({
    ...sketch,
    externalReferences: sketch.externalReferences?.filter(({ id }) => id !== referenceId),
    constraints: sketch.constraints.filter((constraint) =>
      sketchConstraintEntityIds(constraint).every((entityId) => !projectedIds.has(entityId)),
    ),
  })
}

type SketchBackedExternalReference = Exclude<SketchExternalReference, SketchExternalModelReference>
type SketchBackedExternalReferenceReplacement = Extract<
  SketchExternalReferenceReplacement,
  { sourceSketchId: SketchId }
>

function isSketchBackedExternalReferenceReplacement(
  replacement: SketchExternalReferenceReplacement,
): replacement is SketchBackedExternalReferenceReplacement {
  return "sourceSketchId" in replacement
}

function replaceExternalReferenceRecord(
  sketch: SketchRecord,
  referenceId: SketchExternalReferenceId,
  replacement: SketchExternalReference,
) {
  return sketchRecordSchema.parse({
    ...sketch,
    externalReferences: sketch.externalReferences?.map((candidate) =>
      candidate.id === referenceId ? replacement : candidate,
    ),
  })
}

function replaceSketchPointReference(
  sketch: SketchRecord,
  reference: SketchExternalPointReference,
  replacement: SketchBackedExternalReferenceReplacement,
) {
  if (replacement.kind !== undefined && replacement.kind !== "point") {
    throw new TypeError(`A point reference cannot be replaced with ${replacement.kind} geometry.`)
  }
  return replaceExternalReferenceRecord(sketch, reference.id, {
    ...reference,
    sourceSketchId: replacement.sourceSketchId,
    sourcePointId: replacement.sourcePointId,
  })
}

function replaceSketchLineReference(
  sketch: SketchRecord,
  reference: SketchExternalLineReference,
  replacement: SketchBackedExternalReferenceReplacement,
) {
  if (replacement.kind !== "line") throw new TypeError("A sketch reference kind mismatch.")
  return replaceExternalReferenceRecord(sketch, reference.id, {
    ...reference,
    sourceSketchId: replacement.sourceSketchId,
    sourceLineId: replacement.sourceLineId,
  })
}

function replaceSketchPiercePointReference(
  sketch: SketchRecord,
  reference: SketchExternalPiercePointReference,
  replacement: SketchExternalReferenceReplacement,
) {
  if (replacement.kind !== "pierce-point") throw new TypeError("A sketch reference kind mismatch.")
  return replaceExternalReferenceRecord(sketch, reference.id, {
    ...reference,
    sourceSketchId: replacement.sourceSketchId,
    sourceLineId: replacement.sourceLineId,
  })
}

function replaceSketchCurveReference(
  sketch: SketchRecord,
  reference: SketchExternalCurveReference,
  replacement: SketchBackedExternalReferenceReplacement,
) {
  if (replacement.kind !== "curve") throw new TypeError("A sketch reference kind mismatch.")
  if (
    replacement.sourceType !== reference.sourceType ||
    replacement.projectedType !== reference.projectedType
  ) {
    throw new TypeError("A sketch-curve repair must preserve its source and projected curve types.")
  }
  return replaceExternalReferenceRecord(sketch, reference.id, {
    ...reference,
    sourceSketchId: replacement.sourceSketchId,
    sourceEntityId: replacement.sourceEntityId,
  })
}

function replaceSketchBackedExternalReference(
  sketch: SketchRecord,
  reference: SketchBackedExternalReference,
  replacement: SketchExternalReferenceReplacement,
) {
  if (!isSketchBackedExternalReferenceReplacement(replacement)) {
    throw new TypeError("A sketch-backed reference cannot use model-backed replacement geometry.")
  }
  if (reference.kind === "point" || reference.kind === undefined) {
    return replaceSketchPointReference(sketch, reference, replacement)
  }
  if (reference.kind === "line") {
    return replaceSketchLineReference(sketch, reference, replacement)
  }
  if (reference.kind === "pierce-point") {
    return replaceSketchPiercePointReference(sketch, reference, replacement)
  }
  if (reference.kind !== "curve") throw new TypeError("A sketch reference kind mismatch.")
  return replaceSketchCurveReference(sketch, reference, replacement)
}

function modelReferenceGeometryClass(reference: SketchExternalModelReference) {
  if (reference.kind === "model-point") return "POINT"
  if (reference.kind === "model-line") return "LINE"
  if (reference.kind === "model-curve") {
    return reference.sourceType === "circle" || reference.sourceType === "arc"
      ? "CIRCLE"
      : "ELLIPSE"
  }
  return "PLANE"
}

function modelReferenceKindMismatch(
  reference: SketchExternalModelReference,
  replacement: SketchExternalReferenceReplacement,
): never {
  throw new TypeError(
    `A ${reference.kind} reference cannot be replaced with ${replacement.kind} geometry.`,
  )
}

function modelPointReferenceWithReplacement(
  reference: Extract<SketchExternalModelReference, { kind: "model-point" }>,
  replacement: SketchExternalReferenceReplacement,
): SketchExternalModelPointReference {
  if (replacement.kind !== "model-point") return modelReferenceKindMismatch(reference, replacement)
  return {
    schemaVersion: 0,
    id: reference.id,
    kind: reference.kind,
    reference: replacement.reference,
    projectedPointId: reference.projectedPointId,
  }
}

function modelLineReferenceWithReplacement(
  reference: Extract<SketchExternalModelReference, { kind: "model-line" }>,
  replacement: SketchExternalReferenceReplacement,
): SketchExternalModelLineReference {
  if (replacement.kind !== "model-line") return modelReferenceKindMismatch(reference, replacement)
  return {
    schemaVersion: 0,
    id: reference.id,
    kind: reference.kind,
    reference: replacement.reference,
    projectedLineId: reference.projectedLineId,
    projectedStartPointId: reference.projectedStartPointId,
    projectedEndPointId: reference.projectedEndPointId,
  }
}

function modelIntersectionReferenceWithReplacement(
  reference: Extract<SketchExternalModelReference, { kind: "model-intersection" }>,
  replacement: SketchExternalReferenceReplacement,
): SketchExternalModelIntersectionReference {
  if (replacement.kind !== "model-intersection")
    return modelReferenceKindMismatch(reference, replacement)
  return {
    schemaVersion: 0,
    id: reference.id,
    kind: reference.kind,
    reference: replacement.reference,
    projectedLineId: reference.projectedLineId,
    projectedStartPointId: reference.projectedStartPointId,
    projectedEndPointId: reference.projectedEndPointId,
  }
}

function modelCurveReferenceWithReplacement(
  reference: Extract<SketchExternalModelReference, { kind: "model-curve" }>,
  replacement: SketchExternalReferenceReplacement,
): SketchExternalModelCurveReference {
  if (replacement.kind !== "model-curve") {
    throw new TypeError(
      `A ${reference.kind} reference cannot be replaced with ${replacement.kind} geometry.`,
    )
  }
  if (
    replacement.sourceType !== reference.sourceType ||
    replacement.projectedType !== reference.projectedType
  ) {
    throw new TypeError("A model-curve repair must preserve its source and projected curve types.")
  }
  return {
    schemaVersion: 0,
    id: reference.id,
    kind: reference.kind,
    reference: replacement.reference,
    sourceType: reference.sourceType,
    projectedEntityId: reference.projectedEntityId,
    projectedType: reference.projectedType,
    projectedPointIds: reference.projectedPointIds,
  }
}

function modelReferenceWithReplacement(
  reference: SketchExternalModelReference,
  replacement: SketchExternalReferenceReplacement,
): SketchExternalModelReference {
  if (reference.kind === "model-point")
    return modelPointReferenceWithReplacement(reference, replacement)
  if (reference.kind === "model-line")
    return modelLineReferenceWithReplacement(reference, replacement)
  if (reference.kind === "model-intersection")
    return modelIntersectionReferenceWithReplacement(reference, replacement)
  return modelCurveReferenceWithReplacement(reference, replacement)
}

function replaceModelBackedExternalReference(
  sketch: SketchRecord,
  reference: SketchExternalModelReference,
  replacement: SketchExternalReferenceReplacement,
) {
  if (isSketchBackedExternalReferenceReplacement(replacement))
    throw new TypeError(
      `A ${reference.kind} reference cannot be replaced with ${replacement.kind} geometry.`,
    )
  const updated = modelReferenceWithReplacement(reference, replacement)
  if (
    !isOrphanedModelReference(reference) &&
    updated.reference.featureId !== reference.reference.featureId
  ) {
    throw new TypeError(
      "A sketch external reference repair must stay within the producing feature.",
    )
  }
  const expectedGeometryClass = modelReferenceGeometryClass(reference)
  if (updated.reference.signature.geometryClass !== expectedGeometryClass) {
    throw new TypeError(`A ${reference.kind} repair requires ${expectedGeometryClass} geometry.`)
  }
  return replaceExternalReferenceRecord(sketch, reference.id, updated)
}

/** Replace a broken external source while preserving projected identities and local constraints. */
export function replaceSketchExternalReference(
  sketch: SketchRecord,
  referenceId: SketchExternalReferenceId,
  replacement: SketchExternalReferenceReplacement,
): SketchRecord {
  const reference = sketch.externalReferences?.find(({ id }) => id === referenceId)
  if (!reference) {
    throw new TypeError("A sketch external reference repair must target an existing reference.")
  }
  return isSketchExternalModelReference(reference)
    ? replaceModelBackedExternalReference(sketch, reference, replacement)
    : replaceSketchBackedExternalReference(sketch, reference, replacement)
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
