import { isAnyObject, isArray, isString } from "is-what"
import type { SketchConstraintId, SketchEntityId } from "./identifiers"
import {
  MAX_SKETCH_ENTITIES,
  type SketchConstraint,
  type SketchEntity,
  type SketchRecord,
  sketchConstraintSchema,
  sketchRecordSchema,
} from "./sketch"
import {
  requireSketchPoint,
  type SketchAppendResult,
  type SketchPoint2,
  sketchConstraintEntityIds,
  sketchSourcePointIds,
} from "./sketch-edit"

type EntityIdFactory = () => SketchEntityId
type ConstraintIdFactory = () => SketchConstraintId
type SketchCurveEntity = Exclude<SketchEntity, { type: "point" }>

const PATTERN_EPSILON = 1e-9
export const MAX_SKETCH_PATTERN_INSTANCES = 100
export const MAX_SKETCH_PATTERN_PREVIEW_INSTANCES = 10

export type SketchPatternTransform = Readonly<{
  rotationRadians: number
  translation: SketchPoint2
}>

export type LinearSketchPatternDirection = Readonly<{
  angleRadians: number
  count: number
  spacing: number
}>

export type LinearSketchPatternDefinition = Readonly<{
  first: LinearSketchPatternDirection
  second: LinearSketchPatternDirection | null
}>

export type CircularSketchPatternDefinition = Readonly<{
  angleRadians: number
  center: SketchPoint2
  closed: boolean
  count: number
}>

function selectedEntities(sketch: SketchRecord, entityIds: readonly SketchEntityId[]) {
  const selectedIds = new Set<string>(entityIds)
  const entities = sketch.entities.filter(({ id }) => selectedIds.has(id))
  if (entities.length !== selectedIds.size) {
    throw new TypeError("A sketch pattern cannot reference missing source entities.")
  }
  if (entities.length === 0) {
    throw new RangeError("A sketch pattern requires at least one selected entity.")
  }
  return entities
}

function transformedPoint(point: SketchPoint2, transform: SketchPatternTransform) {
  const cosine = Math.cos(transform.rotationRadians)
  const sine = Math.sin(transform.rotationRadians)
  return {
    x: normalizedPatternCoordinate(point.x * cosine - point.y * sine + transform.translation.x),
    y: normalizedPatternCoordinate(point.x * sine + point.y * cosine + transform.translation.y),
  }
}

function mappedPointId(ids: ReadonlyMap<SketchEntityId, SketchEntityId>, id: SketchEntityId) {
  const mapped = ids.get(id)
  if (!mapped) throw new TypeError("Sketch pattern point identity allocation failed.")
  return mapped
}

function clonedCurve(
  curve: SketchCurveEntity,
  pointIds: ReadonlyMap<SketchEntityId, SketchEntityId>,
  id: SketchEntityId,
): SketchCurveEntity {
  switch (curve.type) {
    case "line":
      return {
        ...curve,
        id,
        startPointId: mappedPointId(pointIds, curve.startPointId),
        endPointId: mappedPointId(pointIds, curve.endPointId),
      }
    case "circle":
      return { ...curve, id, centerPointId: mappedPointId(pointIds, curve.centerPointId) }
    case "arc":
      return {
        ...curve,
        id,
        centerPointId: mappedPointId(pointIds, curve.centerPointId),
        startPointId: mappedPointId(pointIds, curve.startPointId),
        endPointId: mappedPointId(pointIds, curve.endPointId),
      }
  }
}

function quarterTurns(rotation: number) {
  const turns = rotation / (Math.PI / 2)
  const nearest = Math.round(turns)
  return Math.abs(turns - nearest) <= PATTERN_EPSILON ? nearest : null
}

function rotatedOrientationConstraint(
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

const rotationIncompatibleConstraintTypes = new Set<SketchConstraint["type"]>([
  "horizontal-distance",
  "vertical-distance",
])

function patternConstraint(
  constraint: SketchConstraint,
  rotation: number,
): SketchConstraint | null {
  if (constraint.type === "fixed") return null
  if (constraint.type === "horizontal" || constraint.type === "vertical") {
    return rotatedOrientationConstraint(constraint, rotation)
  }
  if (
    Math.abs(rotation) > PATTERN_EPSILON &&
    rotationIncompatibleConstraintTypes.has(constraint.type)
  ) {
    return null
  }
  return constraint
}

function remapEntityIds(value: unknown, ids: ReadonlyMap<SketchEntityId, SketchEntityId>): unknown {
  if (isArray(value)) return value.map((entry) => remapEntityIds(entry, ids))
  if (!isAnyObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key !== "id" && key.endsWith("Id") && isString(entry)) {
        return [key, ids.get(entry as SketchEntityId) ?? entry]
      }
      return [key, remapEntityIds(entry, ids)]
    }),
  )
}

function clonedConstraint(
  constraint: SketchConstraint,
  rotation: number,
  entityIds: ReadonlyMap<SketchEntityId, SketchEntityId>,
  createConstraintId: ConstraintIdFactory,
) {
  const transformed = patternConstraint(constraint, rotation)
  if (!transformed) return null
  const remapped = remapEntityIds(transformed, entityIds)
  if (!isAnyObject(remapped)) {
    throw new TypeError("Sketch pattern constraint remapping produced an invalid value.")
  }
  return sketchConstraintSchema.parse({
    ...remapped,
    id: createConstraintId(),
  })
}

function validateTransforms(transforms: readonly SketchPatternTransform[]) {
  if (transforms.length === 0 || transforms.length >= MAX_SKETCH_PATTERN_INSTANCES) {
    throw new RangeError(
      `A sketch pattern requires between 2 and ${MAX_SKETCH_PATTERN_INSTANCES} total instances.`,
    )
  }
  for (const transform of transforms) {
    const values = [transform.rotationRadians, transform.translation.x, transform.translation.y]
    if (values.some((value) => !Number.isFinite(value))) {
      throw new RangeError("Sketch pattern transforms must be finite.")
    }
    if (
      Math.abs(
        Math.atan2(Math.sin(transform.rotationRadians), Math.cos(transform.rotationRadians)),
      ) <= PATTERN_EPSILON &&
      Math.hypot(transform.translation.x, transform.translation.y) <= PATTERN_EPSILON
    ) {
      throw new RangeError("A sketch pattern cannot duplicate the seed in place.")
    }
  }
}

export function patternSketchEntities(
  sketch: SketchRecord,
  input: Readonly<{
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    entityIds: readonly SketchEntityId[]
    transforms: readonly SketchPatternTransform[]
  }>,
): SketchAppendResult {
  validateTransforms(input.transforms)
  const sources = selectedEntities(sketch, input.entityIds)
  const sourcePoints = sketchSourcePointIds(sources)
  const sourceCurves = sources.filter(
    (entity): entity is SketchCurveEntity => entity.type !== "point",
  )
  const sourceIds = new Set<string>([...sourcePoints, ...sourceCurves.map(({ id }) => id)])
  const internalConstraints = sketch.constraints.filter((constraint) =>
    sketchConstraintEntityIds(constraint).every((id) => sourceIds.has(id)),
  )
  const entityCountPerOccurrence = sourcePoints.length + sourceCurves.length
  if (
    sketch.entities.length + entityCountPerOccurrence * input.transforms.length >
    MAX_SKETCH_ENTITIES
  ) {
    throw new RangeError("The sketch pattern would exceed the sketch entity limit.")
  }

  const additions: SketchEntity[] = []
  const constraints: SketchConstraint[] = []
  for (const transform of input.transforms) {
    const ids = new Map<SketchEntityId, SketchEntityId>()
    for (const pointId of sourcePoints) ids.set(pointId, input.createEntityId())
    for (const curve of sourceCurves) ids.set(curve.id, input.createEntityId())
    for (const pointId of sourcePoints) {
      const point = requireSketchPoint(sketch, pointId)
      additions.push({
        ...point,
        ...transformedPoint(point, transform),
        id: mappedPointId(ids, point.id),
      })
    }
    for (const curve of sourceCurves) {
      additions.push(clonedCurve(curve, ids, mappedPointId(ids, curve.id)))
    }
    for (const constraint of internalConstraints) {
      const clone = clonedConstraint(
        constraint,
        transform.rotationRadians,
        ids,
        input.createConstraintId,
      )
      if (clone) constraints.push(clone)
    }
  }

  return {
    createdEntityIds: additions.map(({ id }) => id),
    sketch: sketchRecordSchema.parse({
      ...sketch,
      constraints: [...sketch.constraints, ...constraints],
      entities: [...sketch.entities, ...additions],
    }),
  }
}

function validateDirection(direction: LinearSketchPatternDirection) {
  if (!Number.isInteger(direction.count) || direction.count < 2) {
    throw new RangeError("A linear sketch pattern direction requires at least two instances.")
  }
  if (
    !Number.isFinite(direction.spacing) ||
    direction.spacing <= PATTERN_EPSILON ||
    !Number.isFinite(direction.angleRadians)
  ) {
    throw new RangeError("A linear sketch pattern direction requires finite positive spacing.")
  }
}

function directionVector(direction: LinearSketchPatternDirection) {
  const x = Math.cos(direction.angleRadians) * direction.spacing
  const y = Math.sin(direction.angleRadians) * direction.spacing
  return {
    x: Math.abs(x) <= PATTERN_EPSILON ? 0 : x,
    y: Math.abs(y) <= PATTERN_EPSILON ? 0 : y,
  }
}

function linearPatternInstanceCount(definition: LinearSketchPatternDefinition) {
  validateDirection(definition.first)
  if (definition.second) validateDirection(definition.second)
  const count = definition.first.count * (definition.second?.count ?? 1)
  if (count > MAX_SKETCH_PATTERN_INSTANCES) {
    throw new RangeError(
      `A linear sketch pattern supports at most ${MAX_SKETCH_PATTERN_INSTANCES} total instances.`,
    )
  }
  return count
}

function appendLinearPatternTransform(
  transforms: SketchPatternTransform[],
  positions: SketchPoint2[],
  translation: SketchPoint2,
) {
  const overlaps = positions.some(
    (position) =>
      Math.hypot(position.x - translation.x, position.y - translation.y) <= PATTERN_EPSILON,
  )
  if (overlaps) {
    throw new RangeError("Linear sketch pattern directions cannot create overlapping instances.")
  }
  positions.push(translation)
  transforms.push({ rotationRadians: 0, translation })
}

function linearPatternTranslation(
  first: SketchPoint2,
  second: SketchPoint2 | null,
  firstIndex: number,
  secondIndex: number,
) {
  return {
    x: first.x * firstIndex + (second?.x ?? 0) * secondIndex,
    y: first.y * firstIndex + (second?.y ?? 0) * secondIndex,
  }
}

export function linearSketchPatternTransforms(
  definition: LinearSketchPatternDefinition,
): readonly SketchPatternTransform[] {
  linearPatternInstanceCount(definition)
  const first = directionVector(definition.first)
  const second = definition.second ? directionVector(definition.second) : null
  const transforms: SketchPatternTransform[] = []
  const positions: SketchPoint2[] = [{ x: 0, y: 0 }]
  for (let secondIndex = 0; secondIndex < (definition.second?.count ?? 1); secondIndex += 1) {
    for (let firstIndex = 0; firstIndex < definition.first.count; firstIndex += 1) {
      if (firstIndex === 0 && secondIndex === 0) continue
      appendLinearPatternTransform(
        transforms,
        positions,
        linearPatternTranslation(first, second, firstIndex, secondIndex),
      )
    }
  }
  return transforms
}

export function linearPatternSketchEntities(
  sketch: SketchRecord,
  input: Readonly<{
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    definition: LinearSketchPatternDefinition
    entityIds: readonly SketchEntityId[]
  }>,
) {
  return patternSketchEntities(sketch, {
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    entityIds: input.entityIds,
    transforms: linearSketchPatternTransforms(input.definition),
  })
}

function validateCircularPattern(definition: CircularSketchPatternDefinition) {
  if (
    !Number.isInteger(definition.count) ||
    definition.count < 2 ||
    definition.count > MAX_SKETCH_PATTERN_INSTANCES
  ) {
    throw new RangeError(
      `A circular sketch pattern requires between 2 and ${MAX_SKETCH_PATTERN_INSTANCES} total instances.`,
    )
  }
  const values = [definition.angleRadians, definition.center.x, definition.center.y]
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("A circular sketch pattern requires finite center and angle values.")
  }
  const angle = Math.abs(definition.angleRadians)
  if (definition.closed) {
    if (Math.abs(angle - Math.PI * 2) > PATTERN_EPSILON) {
      throw new RangeError("A closed circular sketch pattern must span one full turn.")
    }
    return
  }
  if (angle <= PATTERN_EPSILON || angle >= Math.PI * 2 - PATTERN_EPSILON) {
    throw new RangeError("An open circular sketch pattern angle must be between 0 and 360 degrees.")
  }
}

function normalizedPatternCoordinate(value: number) {
  return Math.abs(value) <= PATTERN_EPSILON ? 0 : value
}

function circularPatternTransform(center: SketchPoint2, rotationRadians: number) {
  const cosine = Math.cos(rotationRadians)
  const sine = Math.sin(rotationRadians)
  return {
    rotationRadians,
    translation: {
      x: normalizedPatternCoordinate(center.x - (center.x * cosine - center.y * sine)),
      y: normalizedPatternCoordinate(center.y - (center.x * sine + center.y * cosine)),
    },
  }
}

export function circularSketchPatternTransforms(
  definition: CircularSketchPatternDefinition,
): readonly SketchPatternTransform[] {
  validateCircularPattern(definition)
  const divisor = definition.closed ? definition.count : definition.count - 1
  return Array.from({ length: definition.count - 1 }, (_, index) =>
    circularPatternTransform(definition.center, (definition.angleRadians * (index + 1)) / divisor),
  )
}

export function circularPatternSketchEntities(
  sketch: SketchRecord,
  input: Readonly<{
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    definition: CircularSketchPatternDefinition
    entityIds: readonly SketchEntityId[]
  }>,
) {
  return patternSketchEntities(sketch, {
    createConstraintId: input.createConstraintId,
    createEntityId: input.createEntityId,
    entityIds: input.entityIds,
    transforms: circularSketchPatternTransforms(input.definition),
  })
}
