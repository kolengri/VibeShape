import { z } from "zod"
import type { SketchConstraintId, SketchEntityId } from "./identifiers"
import { sketchEntityIdSchema } from "./identifiers"
import {
  type SketchConstraint,
  type SketchEntity,
  type SketchRecord,
  sketchConstraintSchema,
  sketchRecordSchema,
} from "./sketch"
import {
  requireSketchPoint,
  type SketchAppendResult,
  type SketchConstraintDefinition,
  type SketchPoint2,
} from "./sketch-edit"
import { retainSketchSourceImport } from "./sketch-source-import"
import { lengthQuantitySchema } from "./units"

const positiveLength = lengthQuantitySchema.refine(
  ({ value }) => value > 0,
  "Corner treatment requires a positive length.",
)
export const sketchCornerTreatmentSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("fillet"),
        firstLineId: sketchEntityIdSchema,
        secondLineId: sketchEntityIdSchema,
        radius: positiveLength,
      })
      .strict(),
    z
      .object({
        kind: z.literal("chamfer"),
        firstLineId: sketchEntityIdSchema,
        secondLineId: sketchEntityIdSchema,
        firstDistance: positiveLength,
        secondDistance: positiveLength,
      })
      .strict(),
  ])
  .refine(
    ({ firstLineId, secondLineId }) => firstLineId !== secondLineId,
    "Corner treatment requires two distinct lines.",
  )
export type SketchCornerTreatment = z.infer<typeof sketchCornerTreatmentSchema>
type Line = Extract<SketchEntity, { type: "line" }>
type Point = Extract<SketchEntity, { type: "point" }>
const TOLERANCE = 1e-6

function selectedLine(sketch: SketchRecord, id: SketchEntityId): Line {
  const line = sketch.entities.find(
    (entity): entity is Line => entity.id === id && entity.type === "line",
  )
  if (!line || line.construction)
    throw new TypeError("Sketch corner treatment requires two authored non-construction lines.")
  return line
}
function distance(a: SketchPoint2, b: SketchPoint2) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function endpoint(sketch: SketchRecord, line: Line, start: boolean) {
  return requireSketchPoint(sketch, start ? line.startPointId : line.endPointId)
}
function isCornerBranch(
  sketch: SketchRecord,
  entity: SketchEntity,
  first: Line,
  second: Line,
  corners: readonly SketchPoint2[],
) {
  if (entity.construction || entity.id === first.id || entity.id === second.id) return false
  if (!("startPointId" in entity) || !("endPointId" in entity)) return false
  const endpoints = [
    requireSketchPoint(sketch, entity.startPointId),
    requireSketchPoint(sketch, entity.endPointId),
  ]
  return endpoints.some((point) => corners.some((corner) => distance(point, corner) <= TOLERANCE))
}

function cornerGeometry(sketch: SketchRecord, first: Line, second: Line) {
  const matches = [true, false].flatMap((a) =>
    [true, false].flatMap((b) => {
      const left = endpoint(sketch, first, a),
        right = endpoint(sketch, second, b)
      return distance(left, right) <= TOLERANCE
        ? [{ firstStart: a, secondStart: b, corner: left, otherCorner: right }]
        : []
    }),
  )
  const match = matches[0]
  if (matches.length !== 1 || !match)
    throw new RangeError("Sketch corner treatment requires exactly one shared endpoint.")
  const corners = [match.corner, match.otherCorner]
  if (sketch.entities.some((entity) => isCornerBranch(sketch, entity, first, second, corners)))
    throw new RangeError("Sketch corner treatment cannot modify a branched corner.")
  const firstFar = endpoint(sketch, first, !match.firstStart),
    secondFar = endpoint(sketch, second, !match.secondStart)
  const firstLength = distance(match.corner, firstFar),
    secondLength = distance(match.otherCorner, secondFar)
  if (Math.min(firstLength, secondLength) <= TOLERANCE)
    throw new RangeError("Sketch corner lines must be nondegenerate.")
  const u = {
    x: (firstFar.x - match.corner.x) / firstLength,
    y: (firstFar.y - match.corner.y) / firstLength,
  }
  const v = {
    x: (secondFar.x - match.otherCorner.x) / secondLength,
    y: (secondFar.y - match.otherCorner.y) / secondLength,
  }
  const cross = u.x * v.y - u.y * v.x
  const cosine = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))
  if (Math.abs(cross) <= 1e-8)
    throw new RangeError("Sketch corner treatment requires a non-collinear corner.")
  return { ...match, firstLength, secondLength, u, v, cross, angle: Math.acos(cosine) }
}

function remapLineReferences(
  constraint: SketchConstraint,
  ids: ReadonlyMap<string, SketchEntityId>,
): SketchConstraint {
  const fields = Object.fromEntries(
    Object.entries(constraint).map(([key, value]) => {
      if (typeof value === "string" && key !== "id") return [key, ids.get(value) ?? value]
      if (key === "linePairs" && Array.isArray(value))
        return [
          key,
          value.map((pair) => ({
            ...pair,
            sourceLineId: ids.get(pair.sourceLineId) ?? pair.sourceLineId,
            offsetLineId: ids.get(pair.offsetLineId) ?? pair.offsetLineId,
          })),
        ]
      return [key, value]
    }),
  )
  return sketchConstraintSchema.parse(fields)
}

type CornerInput = {
  treatment: SketchCornerTreatment
  createEntityId: () => SketchEntityId
  createConstraintId: () => SketchConstraintId
  solvedPoints?: ReadonlyMap<string, SketchPoint2>
}
function solvedSketch(sketch: SketchRecord, points: CornerInput["solvedPoints"]) {
  if (!points) return sketch
  return {
    ...sketch,
    entities: sketch.entities.map((entity) =>
      entity.type === "point" ? { ...entity, ...(points.get(entity.id) ?? entity) } : entity,
    ),
  }
}
function treatmentDistances(
  treatment: SketchCornerTreatment,
  geometry: ReturnType<typeof cornerGeometry>,
) {
  const distances =
    treatment.kind === "fillet"
      ? ([
          treatment.radius.value / Math.tan(geometry.angle / 2),
          treatment.radius.value / Math.tan(geometry.angle / 2),
        ] as const)
      : ([treatment.firstDistance.value, treatment.secondDistance.value] as const)
  if (
    Math.min(...distances) <= TOLERANCE ||
    distances[0] >= geometry.firstLength - TOLERANCE ||
    distances[1] >= geometry.secondLength - TOLERANCE
  )
    throw new RangeError("Corner treatment must fit strictly inside both selected lines.")
  return distances
}
function prepareCorner(sketch: SketchRecord, input: CornerInput) {
  const treatment = sketchCornerTreatmentSchema.parse(input.treatment)
  const working = solvedSketch(sketch, input.solvedPoints)
  const first = selectedLine(working, treatment.firstLineId),
    second = selectedLine(working, treatment.secondLineId)
  const geometry = cornerGeometry(working, first, second)
  const [firstDistance, secondDistance] = treatmentDistances(treatment, geometry)
  const createdEntityIds: SketchEntityId[] = []
  const createId = () => {
    const id = input.createEntityId()
    createdEntityIds.push(id)
    return id
  }
  const makePoint = (x: number, y: number, construction = false): Point => ({
    schemaVersion: 0,
    id: createId(),
    type: "point",
    x,
    y,
    construction,
  })
  const firstTrim = makePoint(
    geometry.corner.x + geometry.u.x * firstDistance,
    geometry.corner.y + geometry.u.y * firstDistance,
  )
  const secondTrim = makePoint(
    geometry.otherCorner.x + geometry.v.x * secondDistance,
    geometry.otherCorner.y + geometry.v.y * secondDistance,
  )
  const firstGuide: Line = { ...first, id: createId(), construction: true }
  const secondGuide: Line = { ...second, id: createId(), construction: true }
  const extras: SketchEntity[] = [firstTrim, secondTrim, firstGuide, secondGuide]
  const lineIds = new Map([
    [first.id, firstGuide.id],
    [second.id, secondGuide.id],
  ])
  const constraints = sketch.constraints.map((constraint) =>
    remapLineReferences(constraint, lineIds),
  )
  const add = (definition: SketchConstraintDefinition) =>
    constraints.push(
      sketchConstraintSchema.parse({
        ...definition,
        schemaVersion: 0,
        id: input.createConstraintId(),
      }),
    )
  add({ type: "point-on-line", pointId: firstTrim.id, lineId: firstGuide.id })
  add({ type: "point-on-line", pointId: secondTrim.id, lineId: secondGuide.id })
  return {
    working,
    treatment,
    geometry,
    first,
    second,
    firstTrim,
    secondTrim,
    extras,
    constraints,
    add,
    createId,
    makePoint,
    createdEntityIds,
  }
}
type Corner = ReturnType<typeof prepareCorner>
function preserveCornerCoincidence(sketch: SketchRecord, corner: Corner) {
  const { geometry, add } = corner
  if (geometry.corner.id === geometry.otherCorner.id) return
  const matched = sketch.constraints.some((constraint) => {
    if (constraint.type !== "coincident") return false
    const ids = new Set([constraint.firstPointId, constraint.secondPointId])
    return ids.has(geometry.corner.id) && ids.has(geometry.otherCorner.id)
  })
  if (!matched)
    add({
      type: "coincident",
      firstPointId: geometry.corner.id,
      secondPointId: geometry.otherCorner.id,
    })
}
function buildFillet(
  corner: Corner,
  treatment: Extract<SketchCornerTreatment, { kind: "fillet" }>,
) {
  const { geometry, firstTrim, secondTrim, makePoint, createId, extras, add, first, second } =
    corner
  const bisectorLength = Math.hypot(geometry.u.x + geometry.v.x, geometry.u.y + geometry.v.y)
  const centerDistance = treatment.radius.value / Math.sin(geometry.angle / 2)
  const center = makePoint(
    geometry.corner.x + ((geometry.u.x + geometry.v.x) / bisectorLength) * centerDistance,
    geometry.corner.y + ((geometry.u.y + geometry.v.y) / bisectorLength) * centerDistance,
    true,
  )
  const arcId = createId()
  extras.push(center, {
    schemaVersion: 0,
    id: arcId,
    type: "arc",
    centerPointId: center.id,
    startPointId: geometry.cross > 0 ? secondTrim.id : firstTrim.id,
    endPointId: geometry.cross > 0 ? firstTrim.id : secondTrim.id,
    construction: false,
  })
  add({ type: "radius", curveId: arcId, value: treatment.radius })
  add({ type: "tangent", arcId, lineId: first.id, at: geometry.cross > 0 ? "end" : "start" })
  add({ type: "tangent", arcId, lineId: second.id, at: geometry.cross > 0 ? "start" : "end" })
}
function buildChamfer(
  corner: Corner,
  treatment: Extract<SketchCornerTreatment, { kind: "chamfer" }>,
) {
  const { extras, createId, firstTrim, secondTrim, geometry, add } = corner
  extras.push({
    schemaVersion: 0,
    id: createId(),
    type: "line",
    startPointId: firstTrim.id,
    endPointId: secondTrim.id,
    construction: false,
  })
  add({
    type: "distance",
    firstPointId: geometry.corner.id,
    secondPointId: firstTrim.id,
    value: treatment.firstDistance,
  })
  add({
    type: "distance",
    firstPointId: geometry.otherCorner.id,
    secondPointId: secondTrim.id,
    value: treatment.secondDistance,
  })
}
function trimLine(line: Line, trimPoint: Point, start: boolean): Line {
  return { ...line, ...(start ? { startPointId: trimPoint.id } : { endPointId: trimPoint.id }) }
}
function replacedEntity(entity: SketchEntity, corner: Corner): SketchEntity {
  const { first, second, firstTrim, secondTrim, geometry } = corner
  if (entity.id === first.id) return trimLine(first, firstTrim, geometry.firstStart)
  if (entity.id === second.id) return trimLine(second, secondTrim, geometry.secondStart)
  if (entity.type !== "point") return entity
  const targetIds = new Set([
    first.startPointId,
    first.endPointId,
    second.startPointId,
    second.endPointId,
  ])
  const point = targetIds.has(entity.id) ? requireSketchPoint(corner.working, entity.id) : entity
  const isCorner = entity.id === geometry.corner.id || entity.id === geometry.otherCorner.id
  return isCorner ? { ...point, construction: true } : point
}
/** Preserve the virtual sharp corner and its dimensions as construction intent. */
export function treatSketchCorner(sketch: SketchRecord, input: CornerInput): SketchAppendResult {
  const corner = prepareCorner(sketch, input)
  preserveCornerCoincidence(sketch, corner)
  if (corner.treatment.kind === "fillet") buildFillet(corner, corner.treatment)
  else buildChamfer(corner, corner.treatment)
  const entities = [
    ...sketch.entities.map((entity) => replacedEntity(entity, corner)),
    ...corner.extras,
  ]
  return {
    createdEntityIds: corner.createdEntityIds,
    sketch: sketchRecordSchema.parse(
      retainSketchSourceImport({ ...sketch, entities, constraints: corner.constraints }),
    ),
  }
}
