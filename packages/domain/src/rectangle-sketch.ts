import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import {
  type SketchConstraint,
  type SketchEntity,
  type SketchRecord,
  sketchRecordSchema,
} from "./sketch"
import type { LengthQuantity } from "./units"

export type RectangleSketchDefinition = Readonly<{
  height: LengthQuantity
  heightConstraintId: SketchConstraintId
  plane: SketchRecord["plane"]
  width: LengthQuantity
  widthConstraintId: SketchConstraintId
}>

type RectangleSketchInput = Readonly<{
  createConstraintId: () => SketchConstraintId
  createEntityId: () => SketchEntityId
  height: LengthQuantity
  id: SketchId
  label: string
  plane: SketchRecord["plane"]
  width: LengthQuantity
}>

function assertPositiveDimensions(width: LengthQuantity, height: LengthQuantity) {
  if (width.value <= 0 || height.value <= 0) {
    throw new RangeError("Rectangle sketch dimensions must be positive.")
  }
}

export function createRectangleSketch(input: RectangleSketchInput): SketchRecord {
  assertPositiveDimensions(input.width, input.height)
  const pointA = input.createEntityId()
  const pointB = input.createEntityId()
  const pointC = input.createEntityId()
  const pointD = input.createEntityId()
  const lineA = input.createEntityId()
  const lineB = input.createEntityId()
  const lineC = input.createEntityId()
  const lineD = input.createEntityId()

  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: input.id,
    label: input.label,
    plane: input.plane,
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      {
        schemaVersion: 0,
        id: pointB,
        type: "point",
        x: input.width.value,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: pointC,
        type: "point",
        x: input.width.value,
        y: input.height.value,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: pointD,
        type: "point",
        x: 0,
        y: input.height.value,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: lineA,
        type: "line",
        startPointId: pointA,
        endPointId: pointB,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: lineB,
        type: "line",
        startPointId: pointB,
        endPointId: pointC,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: lineC,
        type: "line",
        startPointId: pointC,
        endPointId: pointD,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: lineD,
        type: "line",
        startPointId: pointD,
        endPointId: pointA,
        construction: false,
      },
    ],
    constraints: [
      { schemaVersion: 0, id: input.createConstraintId(), type: "fixed", pointId: pointA },
      { schemaVersion: 0, id: input.createConstraintId(), type: "horizontal", lineId: lineA },
      { schemaVersion: 0, id: input.createConstraintId(), type: "vertical", lineId: lineB },
      { schemaVersion: 0, id: input.createConstraintId(), type: "horizontal", lineId: lineC },
      { schemaVersion: 0, id: input.createConstraintId(), type: "vertical", lineId: lineD },
      {
        schemaVersion: 0,
        id: input.createConstraintId(),
        type: "horizontal-distance",
        firstPointId: pointA,
        secondPointId: pointB,
        value: input.width,
      },
      {
        schemaVersion: 0,
        id: input.createConstraintId(),
        type: "vertical-distance",
        firstPointId: pointB,
        secondPointId: pointC,
        value: input.height,
      },
    ],
  })
}

function lineForPoints(
  lines: readonly Extract<SketchEntity, { type: "line" }>[],
  firstPointId: SketchEntityId,
  secondPointId: SketchEntityId,
) {
  return lines.find(
    (line) =>
      (line.startPointId === firstPointId && line.endPointId === secondPointId) ||
      (line.startPointId === secondPointId && line.endPointId === firstPointId),
  )
}

function hasRectangleCycle(
  points: readonly Extract<SketchEntity, { type: "point" }>[],
  lines: readonly Extract<SketchEntity, { type: "line" }>[],
) {
  const degreeByPointId = new Map(points.map((point) => [point.id, 0]))
  for (const line of lines) {
    const startDegree = degreeByPointId.get(line.startPointId)
    const endDegree = degreeByPointId.get(line.endPointId)
    if (startDegree === undefined || endDegree === undefined) return false
    degreeByPointId.set(line.startPointId, startDegree + 1)
    degreeByPointId.set(line.endPointId, endDegree + 1)
  }
  return [...degreeByPointId.values()].every((degree) => degree === 2)
}

function uniqueConstraint<Type extends SketchConstraint["type"]>(
  constraints: readonly SketchConstraint[],
  type: Type,
): Extract<SketchConstraint, { type: Type }> | null {
  const matches = constraints.filter(
    (constraint): constraint is Extract<SketchConstraint, { type: Type }> =>
      constraint.type === type,
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export function rectangleSketchDefinition(sketch: SketchRecord): RectangleSketchDefinition | null {
  const points = sketch.entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
  )
  const lines = sketch.entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line",
  )
  if (
    points.length !== 4 ||
    lines.length !== 4 ||
    sketch.entities.length !== 8 ||
    sketch.constraints.length !== 7 ||
    !hasRectangleCycle(points, lines)
  ) {
    return null
  }

  const fixed = uniqueConstraint(sketch.constraints, "fixed")
  const width = uniqueConstraint(sketch.constraints, "horizontal-distance")
  const height = uniqueConstraint(sketch.constraints, "vertical-distance")
  const horizontal = sketch.constraints.filter(
    (constraint): constraint is Extract<SketchConstraint, { type: "horizontal" }> =>
      constraint.type === "horizontal",
  )
  const vertical = sketch.constraints.filter(
    (constraint): constraint is Extract<SketchConstraint, { type: "vertical" }> =>
      constraint.type === "vertical",
  )
  if (!fixed || !width || !height || horizontal.length !== 2 || vertical.length !== 2) return null

  const widthLine = lineForPoints(lines, width.firstPointId, width.secondPointId)
  const heightLine = lineForPoints(lines, height.firstPointId, height.secondPointId)
  if (
    fixed.pointId !== width.firstPointId ||
    height.firstPointId !== width.secondPointId ||
    !widthLine ||
    !heightLine ||
    !horizontal.some(({ lineId }) => lineId === widthLine.id) ||
    !vertical.some(({ lineId }) => lineId === heightLine.id)
  ) {
    return null
  }

  return {
    width: width.value,
    widthConstraintId: width.id,
    height: height.value,
    heightConstraintId: height.id,
    plane: sketch.plane,
  }
}

export function updateRectangleSketch(
  sketch: SketchRecord,
  input: Readonly<{
    height: LengthQuantity
    plane: SketchRecord["plane"]
    width: LengthQuantity
  }>,
): SketchRecord {
  assertPositiveDimensions(input.width, input.height)
  const definition = rectangleSketchDefinition(sketch)
  if (!definition) throw new TypeError("The sketch is not a supported rectangular sketch.")
  return sketchRecordSchema.parse({
    ...sketch,
    plane: input.plane,
    constraints: sketch.constraints.map((constraint) => {
      if (constraint.id === definition.widthConstraintId) {
        return { ...constraint, value: input.width }
      }
      if (constraint.id === definition.heightConstraintId) {
        return { ...constraint, value: input.height }
      }
      return constraint
    }),
  })
}
