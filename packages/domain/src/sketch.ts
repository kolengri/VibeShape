import { isString } from "is-what"
import { z } from "zod"
import {
  type SketchEntityId,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
} from "./identifiers"
import { planarFaceTopoRefSchema } from "./topology"
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

export const sketchFeatureFaceSupportSchema = z
  .object({
    kind: z.literal("feature-face"),
    reference: planarFaceTopoRefSchema,
  })
  .strict()

/**
 * A read-only point projected from an earlier sketch. Its coordinates
 * are resolved at solve time; only stable source and projected identities persist.
 */
export const sketchExternalPointReferenceSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    sourceSketchId: sketchIdSchema,
    sourcePointId: sketchEntityIdSchema,
    projectedPointId: sketchEntityIdSchema,
  })
  .strict()

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

export const sketchEllipseEntitySchema = sketchEntityEnvelopeSchema
  .extend({
    type: z.literal("ellipse"),
    centerPointId: sketchEntityIdSchema,
    primaryAxisPointId: sketchEntityIdSchema,
    secondaryAxisPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine(
    (ellipse) =>
      new Set([ellipse.centerPointId, ellipse.primaryAxisPointId, ellipse.secondaryAxisPointId])
        .size === 3,
    { message: "A sketch ellipse requires distinct center and axis point entities." },
  )

export const sketchEllipticalArcEntitySchema = sketchEntityEnvelopeSchema
  .extend({
    type: z.literal("elliptical-arc"),
    centerPointId: sketchEntityIdSchema,
    primaryAxisPointId: sketchEntityIdSchema,
    secondaryAxisPointId: sketchEntityIdSchema,
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine(
    (arc) =>
      new Set([arc.centerPointId, arc.primaryAxisPointId, arc.secondaryAxisPointId]).size === 3 &&
      arc.startPointId !== arc.endPointId &&
      arc.startPointId !== arc.centerPointId &&
      arc.endPointId !== arc.centerPointId,
    {
      message:
        "A sketch elliptical arc requires distinct axes, distinct endpoints, and endpoints away from the center.",
    },
  )

export const sketchEntitySchema = z.discriminatedUnion("type", [
  sketchPointEntitySchema,
  sketchLineEntitySchema,
  sketchCircleEntitySchema,
  sketchArcEntitySchema,
  sketchEllipseEntitySchema,
  sketchEllipticalArcEntitySchema,
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
const midpointConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("midpoint"),
    pointId: sketchEntityIdSchema,
    lineId: sketchEntityIdSchema,
  })
  .strict()
const symmetricConstraintSchema = pointPairSchema
  .extend({ type: z.literal("symmetric"), lineId: sketchEntityIdSchema })
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
const offsetLinePairSchema = z
  .object({
    sourceLineId: sketchEntityIdSchema,
    offsetLineId: sketchEntityIdSchema,
    distanceScale: z.union([z.literal(-1), z.literal(1)]),
  })
  .strict()
  .refine((pair) => pair.sourceLineId !== pair.offsetLineId, {
    message: "A sketch offset pair requires distinct source and offset lines.",
  })
const offsetEndpointPairSchema = z
  .object({
    sourcePointId: sketchEntityIdSchema,
    offsetPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((pair) => pair.sourcePointId !== pair.offsetPointId, {
    message: "A sketch offset endpoint pair requires distinct points.",
  })
const offsetConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("offset"),
    linePairs: z.array(offsetLinePairSchema).min(1).max(MAX_SKETCH_ENTITIES),
    endpointPairs: z.array(offsetEndpointPairSchema).max(2),
    value: lengthQuantitySchema,
  })
  .strict()
  .refine((constraint) => constraint.value.value !== 0, {
    message: "A sketch offset requires a nonzero distance.",
  })
  .refine(
    (constraint) =>
      new Set(constraint.linePairs.map(({ sourceLineId }) => sourceLineId)).size ===
        constraint.linePairs.length &&
      new Set(constraint.linePairs.map(({ offsetLineId }) => offsetLineId)).size ===
        constraint.linePairs.length,
    {
      message: "A sketch offset cannot repeat source or offset lines.",
    },
  )
  .refine(
    (constraint) => constraint.endpointPairs.length === 0 || constraint.endpointPairs.length === 2,
    { message: "An open sketch offset requires both endpoint pairs." },
  )
  .refine(
    (constraint) =>
      new Set(constraint.endpointPairs.map(({ sourcePointId }) => sourcePointId)).size ===
        constraint.endpointPairs.length &&
      new Set(constraint.endpointPairs.map(({ offsetPointId }) => offsetPointId)).size ===
        constraint.endpointPairs.length,
    { message: "A sketch offset cannot repeat source or offset endpoint points." },
  )
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
const primaryAxisDiameterConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("primary-axis-diameter"),
    curveId: sketchEntityIdSchema,
    value: lengthQuantitySchema,
  })
  .strict()
const secondaryAxisDiameterConstraintSchema = sketchConstraintEnvelopeSchema
  .extend({
    type: z.literal("secondary-axis-diameter"),
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
  midpointConstraintSchema,
  symmetricConstraintSchema,
  fixedConstraintSchema,
  horizontalDistanceConstraintSchema,
  verticalDistanceConstraintSchema,
  distanceConstraintSchema,
  offsetConstraintSchema,
  angleConstraintSchema,
  radiusConstraintSchema,
  diameterConstraintSchema,
  primaryAxisDiameterConstraintSchema,
  secondaryAxisDiameterConstraintSchema,
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
  return entityPointReferenceIds(entity).every((id) => entityIs(entities, id, ["point"]))
}

function entityPointReferenceIds(entity: SketchEntity): readonly SketchEntityId[] {
  switch (entity.type) {
    case "point":
      return []
    case "line":
      return [entity.startPointId, entity.endPointId]
    case "circle":
      return [entity.centerPointId]
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId]
    case "ellipse":
      return [entity.centerPointId, entity.primaryAxisPointId, entity.secondaryAxisPointId]
    case "elliptical-arc":
      return [
        entity.centerPointId,
        entity.primaryAxisPointId,
        entity.secondaryAxisPointId,
        entity.startPointId,
        entity.endPointId,
      ]
  }
}

type RuleValidatedConstraintType = Exclude<SketchConstraint["type"], "equal" | "offset">
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
  midpoint: { pointId: ["point"], lineId: ["line"] },
  symmetric: {
    firstPointId: ["point"],
    secondPointId: ["point"],
    lineId: ["line"],
  },
  fixed: { pointId: ["point"] },
  "horizontal-distance": { firstPointId: ["point"], secondPointId: ["point"] },
  "vertical-distance": { firstPointId: ["point"], secondPointId: ["point"] },
  distance: { firstPointId: ["point"], secondPointId: ["point"] },
  angle: { firstEntityId: ["line"], secondEntityId: ["line"] },
  radius: { curveId: ["circle", "arc"] },
  diameter: { curveId: ["circle", "arc"] },
  "primary-axis-diameter": { curveId: ["ellipse", "elliptical-arc"] },
  "secondary-axis-diameter": { curveId: ["ellipse", "elliptical-arc"] },
} as const satisfies Record<RuleValidatedConstraintType, EntityReferenceRules>

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
  if (constraint.type === "offset") {
    return (
      constraint.linePairs.every(
        ({ sourceLineId, offsetLineId }) =>
          entityIs(entities, sourceLineId, ["line"]) && entityIs(entities, offsetLineId, ["line"]),
      ) &&
      constraint.endpointPairs.every(
        ({ sourcePointId, offsetPointId }) =>
          entityIs(entities, sourcePointId, ["point"]) &&
          entityIs(entities, offsetPointId, ["point"]),
      )
    )
  }
  const constraintRecord = constraint as unknown as Readonly<Record<string, unknown>>
  const rules: EntityReferenceRules = constraintEntityReferenceRules[constraint.type]
  return Object.entries(rules).every(([field, entityTypes]) => {
    const entityId = constraintRecord[field]
    return isString(entityId) && entityIs(entities, entityId, entityTypes)
  })
}

type SketchStructure = Readonly<{
  constraints: readonly SketchConstraint[]
  entities: readonly SketchEntity[]
  externalReferences?: readonly SketchExternalPointReference[] | undefined
}>

function indexSketchEntities(sketch: SketchStructure, context: z.RefinementCtx) {
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
  return entities
}

function validateSketchEntityTable(
  sketch: SketchStructure,
  entities: ReadonlyMap<string, SketchEntity>,
  context: z.RefinementCtx,
) {
  for (const [index, entity] of sketch.entities.entries()) {
    if (validateEntityReferences(entity, entities)) continue
    context.addIssue({
      code: "custom",
      path: ["entities", index],
      message: "A sketch entity reference has an incompatible or missing target.",
    })
  }
}

function nativeConstraintCount(structure: SketchStructure) {
  const authored = structure.constraints.reduce(
    (count, constraint) =>
      count +
      (constraint.type === "offset"
        ? constraint.linePairs.length * 2 + constraint.endpointPairs.length
        : 1),
    0,
  )
  const internal = structure.entities.reduce((count, entity) => {
    if (entity.type === "ellipse") return count + 1
    return entity.type === "elliptical-arc" ? count + 11 : count
  }, 0)
  return authored + internal
}

const nativeEntityCapacity = {
  arc: { entities: 1, parameters: 0 },
  circle: { entities: 2, parameters: 1 },
  ellipse: { entities: 2, parameters: 0 },
  "elliptical-arc": { entities: 10, parameters: 8 },
  line: { entities: 1, parameters: 0 },
  point: { entities: 1, parameters: 2 },
} as const satisfies Record<
  SketchEntity["type"],
  Readonly<{ entities: number; parameters: number }>
>

function nativeSketchCapacity(structure: SketchStructure) {
  const authored = structure.entities.reduce(
    (capacity, entity) => ({
      entities: capacity.entities + nativeEntityCapacity[entity.type].entities,
      parameters: capacity.parameters + nativeEntityCapacity[entity.type].parameters,
    }),
    { entities: 3, parameters: 7 },
  )
  const projectionCount =
    Number(structure.constraints.some(({ type }) => type === "horizontal-distance")) +
    Number(structure.constraints.some(({ type }) => type === "vertical-distance"))
  return {
    entities: authored.entities + (structure.externalReferences?.length ?? 0) + projectionCount * 3,
    parameters:
      authored.parameters + (structure.externalReferences?.length ?? 0) * 2 + projectionCount * 4,
  }
}

function constraintEntitiesWithExternalPoints(
  sketch: SketchStructure,
  entities: ReadonlyMap<string, SketchEntity>,
  context: z.RefinementCtx,
) {
  const constraintEntities = new Map(entities)
  for (const reference of sketch.externalReferences ?? []) {
    if (constraintEntities.has(reference.projectedPointId)) {
      context.addIssue({
        code: "custom",
        path: ["externalReferences"],
        message: "Projected external point IDs cannot collide with sketch entity IDs.",
      })
      continue
    }
    constraintEntities.set(reference.projectedPointId, {
      schemaVersion: 0,
      id: reference.projectedPointId,
      type: "point",
      x: 0,
      y: 0,
      construction: true,
    })
  }
  return constraintEntities
}

function validateExternalReferenceIds(sketch: SketchStructure, context: z.RefinementCtx) {
  const externalReferenceIds = new Set<string>()
  const projectedPointIds = new Set<string>()
  for (const [index, reference] of (sketch.externalReferences ?? []).entries()) {
    if (externalReferenceIds.has(reference.id)) {
      context.addIssue({
        code: "custom",
        path: ["externalReferences", index, "id"],
        message: "External sketch reference IDs must be unique.",
      })
    }
    if (projectedPointIds.has(reference.projectedPointId)) {
      context.addIssue({
        code: "custom",
        path: ["externalReferences", index, "projectedPointId"],
        message: "Projected external point IDs must be unique.",
      })
    }
    externalReferenceIds.add(reference.id)
    projectedPointIds.add(reference.projectedPointId)
  }
}

function validateSketchConstraintTable(
  sketch: SketchStructure,
  entities: ReadonlyMap<string, SketchEntity>,
  context: z.RefinementCtx,
) {
  const constraintEntities = constraintEntitiesWithExternalPoints(sketch, entities, context)
  validateExternalReferenceIds(sketch, context)
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
    if (validateConstraintReferences(constraint, constraintEntities)) continue
    context.addIssue({
      code: "custom",
      path: ["constraints", index],
      message: "A sketch constraint reference has an incompatible or missing target.",
    })
  }
  if (nativeConstraintCount(sketch) <= MAX_SKETCH_CONSTRAINTS) return
  context.addIssue({
    code: "custom",
    path: ["constraints"],
    message: "Sketch constraints exceed the native solver safety limit.",
  })
}

function validateNativeSketchCapacity(sketch: SketchStructure, context: z.RefinementCtx) {
  const capacity = nativeSketchCapacity(sketch)
  if (capacity.entities > 5_000) {
    context.addIssue({
      code: "custom",
      path: ["entities"],
      message: "Sketch entities exceed the native solver safety limit.",
    })
  }
  if (capacity.parameters > 10_000) {
    context.addIssue({
      code: "custom",
      path: ["entities"],
      message: "Sketch parameters exceed the native solver safety limit.",
    })
  }
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
    support: sketchFeatureFaceSupportSchema.optional(),
    entities: z.array(sketchEntitySchema).max(MAX_SKETCH_ENTITIES),
    constraints: z.array(sketchConstraintSchema).max(MAX_SKETCH_CONSTRAINTS),
    externalReferences: z
      .array(sketchExternalPointReferenceSchema)
      .max(MAX_SKETCH_ENTITIES)
      .optional(),
  })
  .strict()
  .superRefine((sketch, context) => {
    const entities = indexSketchEntities(sketch, context)
    validateSketchEntityTable(sketch, entities, context)
    validateSketchConstraintTable(sketch, entities, context)
    validateNativeSketchCapacity(sketch, context)
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
export type SketchFeatureFaceSupport = Readonly<z.infer<typeof sketchFeatureFaceSupportSchema>>
export type SketchExternalPointReference = Readonly<
  z.infer<typeof sketchExternalPointReferenceSchema>
>
