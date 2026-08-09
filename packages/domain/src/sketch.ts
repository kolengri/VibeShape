import { z } from "zod"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { angleQuantitySchema, lengthQuantitySchema } from "./units"

export const MAX_SKETCHES_PER_DOCUMENT = 256
// Reserve native ABI capacity for the immutable workplane and projected-distance axes.
export const MAX_SKETCH_ENTITIES = 4_990
export const MAX_SKETCH_CONSTRAINTS = 10_000
export const MAX_SKETCH_COORDINATE_MM = 1_000_000

const coordinateSchema = z
  .number()
  .finite()
  .min(-MAX_SKETCH_COORDINATE_MM)
  .max(MAX_SKETCH_COORDINATE_MM)
const radiusSchema = z.number().finite().positive().max(MAX_SKETCH_COORDINATE_MM)
const constructionSchema = z.boolean().default(false)

const sketchEntityEnvelopeSchema = z.object({
  schemaVersion: z.literal(0),
  id: sketchEntityIdSchema,
  construction: constructionSchema,
})

export const sketchPointEntitySchema = sketchEntityEnvelopeSchema
  .extend({
    type: z.literal("point"),
    x: coordinateSchema,
    y: coordinateSchema,
  })
  .strict()

export const sketchLineEntitySchema = sketchEntityEnvelopeSchema
  .extend({
    type: z.literal("line"),
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((line) => line.startPointId !== line.endPointId, {
    message: "A sketch line requires two distinct point entities.",
  })

export const sketchCircleEntitySchema = sketchEntityEnvelopeSchema
  .extend({
    type: z.literal("circle"),
    centerPointId: sketchEntityIdSchema,
    radius: radiusSchema,
  })
  .strict()

export const sketchArcEntitySchema = sketchEntityEnvelopeSchema
  .extend({
    type: z.literal("arc"),
    centerPointId: sketchEntityIdSchema,
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((arc) => new Set([arc.centerPointId, arc.startPointId, arc.endPointId]).size === 3, {
    message: "A sketch arc requires distinct center, start, and end point entities.",
  })

export const sketchEntitySchema = z.discriminatedUnion("type", [
  sketchPointEntitySchema,
  sketchLineEntitySchema,
  sketchCircleEntitySchema,
  sketchArcEntitySchema,
])

const sketchConstraintEnvelopeSchema = z.object({
  schemaVersion: z.literal(0),
  id: sketchConstraintIdSchema,
})

const pointPairSchema = sketchConstraintEnvelopeSchema
  .extend({
    firstPointId: sketchEntityIdSchema,
    secondPointId: sketchEntityIdSchema,
  })
  .refine((constraint) => constraint.firstPointId !== constraint.secondPointId, {
    message: "A sketch constraint requires two distinct point entities.",
  })

const entityPairSchema = sketchConstraintEnvelopeSchema
  .extend({
    firstEntityId: sketchEntityIdSchema,
    secondEntityId: sketchEntityIdSchema,
  })
  .refine((constraint) => constraint.firstEntityId !== constraint.secondEntityId, {
    message: "A sketch constraint requires two distinct entities.",
  })

const coincidenceConstraintSchema = pointPairSchema
  .extend({ type: z.literal("coincident") })
  .strict()
const horizontalConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({ type: z.literal("horizontal"), lineId: sketchEntityIdSchema })
  .strict()
const verticalConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({ type: z.literal("vertical"), lineId: sketchEntityIdSchema })
  .strict()
const parallelConstraintSchema = entityPairSchema.extend({ type: z.literal("parallel") }).strict()
const perpendicularConstraintSchema = entityPairSchema
  .extend({ type: z.literal("perpendicular") })
  .strict()
const equalConstraintSchema = entityPairSchema.extend({ type: z.literal("equal") }).strict()
const tangentConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("tangent"),
    arcId: sketchEntityIdSchema,
    lineId: sketchEntityIdSchema,
  })
  .strict()
const concentricConstraintSchema = entityPairSchema
  .extend({ type: z.literal("concentric") })
  .strict()
const pointOnLineConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("point-on-line"),
    pointId: sketchEntityIdSchema,
    lineId: sketchEntityIdSchema,
  })
  .strict()
const pointOnCurveConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("point-on-curve"),
    pointId: sketchEntityIdSchema,
    curveId: sketchEntityIdSchema,
  })
  .strict()
const fixedConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({ type: z.literal("fixed"), pointId: sketchEntityIdSchema })
  .strict()
const horizontalDistanceConstraintSchema = pointPairSchema
  .extend({ type: z.literal("horizontal-distance"), value: lengthQuantitySchema })
  .strict()
const verticalDistanceConstraintSchema = pointPairSchema
  .extend({ type: z.literal("vertical-distance"), value: lengthQuantitySchema })
  .strict()
const distanceConstraintSchema = pointPairSchema
  .extend({ type: z.literal("distance"), value: lengthQuantitySchema })
  .strict()
const angleConstraintSchema = entityPairSchema
  .extend({ type: z.literal("angle"), value: angleQuantitySchema })
  .strict()
const radiusConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("radius"),
    curveId: sketchEntityIdSchema,
    value: lengthQuantitySchema,
  })
  .strict()
const diameterConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("diameter"),
    curveId: sketchEntityIdSchema,
    value: lengthQuantitySchema,
  })
  .strict()

export const sketchConstraintSchema = z.discriminatedUnion("type", [
  coincidenceConstraintSchema,
  horizontalConstraintSchema,
  verticalConstraintSchema,
  parallelConstraintSchema,
  perpendicularConstraintSchema,
  equalConstraintSchema,
  tangentConstraintSchema,
  concentricConstraintSchema,
  pointOnLineConstraintSchema,
  pointOnCurveConstraintSchema,
  fixedConstraintSchema,
  horizontalDistanceConstraintSchema,
  verticalDistanceConstraintSchema,
  distanceConstraintSchema,
  angleConstraintSchema,
  radiusConstraintSchema,
  diameterConstraintSchema,
])

export type SketchEntity = Readonly<z.infer<typeof sketchEntitySchema>>
export type SketchConstraint = Readonly<z.infer<typeof sketchConstraintSchema>>

function entityIs(
  entities: ReadonlyMap<string, SketchEntity>,
  id: string,
  types: readonly SketchEntity["type"][],
) {
  const entity = entities.get(id)
  return entity !== undefined && types.includes(entity.type)
}

function validateEntityReferences(
  entity: SketchEntity,
  entities: ReadonlyMap<string, SketchEntity>,
) {
  switch (entity.type) {
    case "point":
      return true
    case "line":
      return (
        entityIs(entities, entity.startPointId, ["point"]) &&
        entityIs(entities, entity.endPointId, ["point"])
      )
    case "circle":
      return entityIs(entities, entity.centerPointId, ["point"])
    case "arc":
      return (
        entityIs(entities, entity.centerPointId, ["point"]) &&
        entityIs(entities, entity.startPointId, ["point"]) &&
        entityIs(entities, entity.endPointId, ["point"])
      )
  }
}

type NonEqualConstraintType = Exclude<SketchConstraint["type"], "equal">
type EntityReferenceRules = Readonly<Record<string, readonly SketchEntity["type"][]>>

const constraintEntityReferenceRules = {
  coincident: { firstPointId: ["point"], secondPointId: ["point"] },
  horizontal: { lineId: ["line"] },
  vertical: { lineId: ["line"] },
  parallel: { firstEntityId: ["line"], secondEntityId: ["line"] },
  perpendicular: { firstEntityId: ["line"], secondEntityId: ["line"] },
  tangent: { arcId: ["arc"], lineId: ["line"] },
  concentric: {
    firstEntityId: ["circle", "arc"],
    secondEntityId: ["circle", "arc"],
  },
  "point-on-line": { pointId: ["point"], lineId: ["line"] },
  "point-on-curve": { pointId: ["point"], curveId: ["circle", "arc"] },
  fixed: { pointId: ["point"] },
  "horizontal-distance": { firstPointId: ["point"], secondPointId: ["point"] },
  "vertical-distance": { firstPointId: ["point"], secondPointId: ["point"] },
  distance: { firstPointId: ["point"], secondPointId: ["point"] },
  angle: { firstEntityId: ["line"], secondEntityId: ["line"] },
  radius: { curveId: ["circle", "arc"] },
  diameter: { curveId: ["circle", "arc"] },
} as const satisfies Record<NonEqualConstraintType, EntityReferenceRules>

function validateEqualConstraintReferences(
  constraint: Extract<SketchConstraint, { type: "equal" }>,
  entities: ReadonlyMap<string, SketchEntity>,
) {
  const first = entities.get(constraint.firstEntityId)
  const second = entities.get(constraint.secondEntityId)
  if (!first || !second) return false
  if (first.type === "line" || second.type === "line") {
    return first.type === "line" && second.type === "line"
  }
  const roundTypes: readonly SketchEntity["type"][] = ["circle", "arc"]
  return roundTypes.includes(first.type) && roundTypes.includes(second.type)
}

function validateConstraintReferences(
  constraint: SketchConstraint,
  entities: ReadonlyMap<string, SketchEntity>,
) {
  if (constraint.type === "equal") {
    return validateEqualConstraintReferences(constraint, entities)
  }
  const constraintRecord = constraint as unknown as Readonly<Record<string, unknown>>
  const rules: EntityReferenceRules = constraintEntityReferenceRules[constraint.type]
  return Object.entries(rules).every(([field, entityTypes]) => {
    const entityId = constraintRecord[field]
    return typeof entityId === "string" && entityIs(entities, entityId, entityTypes)
  })
}

export const sketchRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchIdSchema,
    label: z
      .string()
      .min(1)
      .max(120)
      .refine((label) => label.trim() === label, "Sketch labels must be normalized."),
    plane: z.enum(["xy", "xz", "yz"]),
    entities: z.array(sketchEntitySchema).max(MAX_SKETCH_ENTITIES),
    constraints: z.array(sketchConstraintSchema).max(MAX_SKETCH_CONSTRAINTS),
  })
  .strict()
  .superRefine((sketch, context) => {
    const entities = new Map<string, SketchEntity>()
    for (const [index, entity] of sketch.entities.entries()) {
      if (entities.has(entity.id)) {
        context.addIssue({
          code: "custom",
          path: ["entities", index, "id"],
          message: "Sketch entity IDs must be unique.",
        })
      }
      entities.set(entity.id, entity)
    }
    for (const [index, entity] of sketch.entities.entries()) {
      if (!validateEntityReferences(entity, entities)) {
        context.addIssue({
          code: "custom",
          path: ["entities", index],
          message: "A sketch entity reference has an incompatible or missing target.",
        })
      }
    }

    const constraintIds = new Set<string>()
    for (const [index, constraint] of sketch.constraints.entries()) {
      if (constraintIds.has(constraint.id)) {
        context.addIssue({
          code: "custom",
          path: ["constraints", index, "id"],
          message: "Sketch constraint IDs must be unique.",
        })
      }
      constraintIds.add(constraint.id)
      if (!validateConstraintReferences(constraint, entities)) {
        context.addIssue({
          code: "custom",
          path: ["constraints", index],
          message: "A sketch constraint reference has an incompatible or missing target.",
        })
      }
    }
  })

const structuralSketchRecordsSchema = z.array(sketchRecordSchema).max(MAX_SKETCHES_PER_DOCUMENT)

export const sketchRecordsSchema = structuralSketchRecordsSchema.superRefine(
  (sketches, context) => {
    const ids = new Set<string>()
    for (const [index, sketch] of sketches.entries()) {
      if (ids.has(sketch.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Sketch IDs must be unique within a document.",
        })
      }
      ids.add(sketch.id)
    }
  },
)

export type SketchRecord = Readonly<z.infer<typeof sketchRecordSchema>>
