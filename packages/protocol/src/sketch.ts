import { z } from "zod"

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sha256Pattern = /^[0-9a-f]{64}$/
export const sketchWireIdSchema = z.string().regex(uuidV7Pattern)
const sketchEntityIdSchema = z.string().regex(uuidV7Pattern)
const sketchConstraintIdSchema = z.string().regex(uuidV7Pattern)
const revisionSchema = z.number().int().nonnegative().safe()
const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000)
const radiusSchema = z.number().finite().positive().max(1_000_000)
const expressionSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((expression) => expression.trim() === expression)

const lengthFactors = { um: 0.001, mm: 1, cm: 10, m: 1_000, in: 25.4, ft: 304.8 } as const
const lengthQuantitySchema = z
  .object({
    schemaVersion: z.literal(0),
    dimension: z.literal("length"),
    value: z.number().finite(),
    unit: z.literal("mm"),
    source: z
      .object({
        value: z.number().finite(),
        unit: z.enum(["um", "mm", "cm", "m", "in", "ft"]),
        expression: expressionSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (quantity) => quantity.value === quantity.source.value * lengthFactors[quantity.source.unit],
  )

const angleQuantitySchema = z
  .object({
    schemaVersion: z.literal(0),
    dimension: z.literal("angle"),
    value: z.number().finite(),
    unit: z.literal("rad"),
    source: z
      .object({
        value: z.number().finite(),
        unit: z.enum(["rad", "deg"]),
        expression: expressionSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (quantity) =>
      quantity.value ===
      (quantity.source.unit === "rad"
        ? quantity.source.value
        : (quantity.source.value * Math.PI) / 180),
  )

const entityEnvelope = {
  schemaVersion: z.literal(0),
  id: sketchEntityIdSchema,
  construction: z.boolean().default(false),
}

const pointEntitySchema = z
  .object({ ...entityEnvelope, type: z.literal("point"), x: coordinateSchema, y: coordinateSchema })
  .strict()
const lineEntitySchema = z
  .object({
    ...entityEnvelope,
    type: z.literal("line"),
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((line) => line.startPointId !== line.endPointId)
const circleEntitySchema = z
  .object({
    ...entityEnvelope,
    type: z.literal("circle"),
    centerPointId: sketchEntityIdSchema,
    radius: radiusSchema,
  })
  .strict()
const arcEntitySchema = z
  .object({
    ...entityEnvelope,
    type: z.literal("arc"),
    centerPointId: sketchEntityIdSchema,
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((arc) => new Set([arc.centerPointId, arc.startPointId, arc.endPointId]).size === 3)

const sketchEntitySchema = z.discriminatedUnion("type", [
  pointEntitySchema,
  lineEntitySchema,
  circleEntitySchema,
  arcEntitySchema,
])

const constraintEnvelope = { schemaVersion: z.literal(0), id: sketchConstraintIdSchema }
const pointPair = {
  firstPointId: sketchEntityIdSchema,
  secondPointId: sketchEntityIdSchema,
}
const entityPair = {
  firstEntityId: sketchEntityIdSchema,
  secondEntityId: sketchEntityIdSchema,
}
const sketchConstraintSchema = z.discriminatedUnion("type", [
  z.object({ ...constraintEnvelope, type: z.literal("coincident"), ...pointPair }).strict(),
  z
    .object({ ...constraintEnvelope, type: z.literal("horizontal"), lineId: sketchEntityIdSchema })
    .strict(),
  z
    .object({ ...constraintEnvelope, type: z.literal("vertical"), lineId: sketchEntityIdSchema })
    .strict(),
  z.object({ ...constraintEnvelope, type: z.literal("parallel"), ...entityPair }).strict(),
  z.object({ ...constraintEnvelope, type: z.literal("perpendicular"), ...entityPair }).strict(),
  z.object({ ...constraintEnvelope, type: z.literal("equal"), ...entityPair }).strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("tangent"),
      arcId: sketchEntityIdSchema,
      lineId: sketchEntityIdSchema,
    })
    .strict(),
  z.object({ ...constraintEnvelope, type: z.literal("concentric"), ...entityPair }).strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("point-on-line"),
      pointId: sketchEntityIdSchema,
      lineId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("point-on-curve"),
      pointId: sketchEntityIdSchema,
      curveId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({ ...constraintEnvelope, type: z.literal("fixed"), pointId: sketchEntityIdSchema })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("horizontal-distance"),
      ...pointPair,
      value: lengthQuantitySchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("vertical-distance"),
      ...pointPair,
      value: lengthQuantitySchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("distance"),
      ...pointPair,
      value: lengthQuantitySchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("angle"),
      ...entityPair,
      value: angleQuantitySchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("radius"),
      curveId: sketchEntityIdSchema,
      value: lengthQuantitySchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("diameter"),
      curveId: sketchEntityIdSchema,
      value: lengthQuantitySchema,
    })
    .strict(),
])

type WireEntity = z.infer<typeof sketchEntitySchema>

function entityIs(entities: ReadonlyMap<string, WireEntity>, id: string, types: readonly string[]) {
  const entity = entities.get(id)
  return entity !== undefined && types.includes(entity.type)
}

function validEntityReferences(entity: WireEntity, entities: ReadonlyMap<string, WireEntity>) {
  if (entity.type === "point") return true
  if (entity.type === "line") {
    return (
      entityIs(entities, entity.startPointId, ["point"]) &&
      entityIs(entities, entity.endPointId, ["point"])
    )
  }
  if (entity.type === "circle") return entityIs(entities, entity.centerPointId, ["point"])
  return (
    entityIs(entities, entity.centerPointId, ["point"]) &&
    entityIs(entities, entity.startPointId, ["point"]) &&
    entityIs(entities, entity.endPointId, ["point"])
  )
}

type SketchWireConstraint = z.infer<typeof sketchConstraintSchema>

const constraintReferenceFields = {
  coincident: ["firstPointId", "secondPointId"],
  horizontal: ["lineId"],
  vertical: ["lineId"],
  parallel: ["firstEntityId", "secondEntityId"],
  perpendicular: ["firstEntityId", "secondEntityId"],
  equal: ["firstEntityId", "secondEntityId"],
  tangent: ["arcId", "lineId"],
  concentric: ["firstEntityId", "secondEntityId"],
  "point-on-line": ["pointId", "lineId"],
  "point-on-curve": ["pointId", "curveId"],
  fixed: ["pointId"],
  "horizontal-distance": ["firstPointId", "secondPointId"],
  "vertical-distance": ["firstPointId", "secondPointId"],
  distance: ["firstPointId", "secondPointId"],
  angle: ["firstEntityId", "secondEntityId"],
  radius: ["curveId"],
  diameter: ["curveId"],
} as const satisfies Record<SketchWireConstraint["type"], readonly string[]>

function constraintReferences(constraint: SketchWireConstraint) {
  const constraintRecord = constraint as unknown as Readonly<Record<string, unknown>>
  return constraintReferenceFields[constraint.type].map((field) => {
    const reference = constraintRecord[field]
    if (typeof reference !== "string") {
      throw new Error(`Sketch constraint reference ${field} is not a string.`)
    }
    return reference
  })
}

export const sketchWireRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchWireIdSchema,
    label: z
      .string()
      .min(1)
      .max(120)
      .refine((label) => label.trim() === label),
    plane: z.enum(["xy", "xz", "yz"]),
    entities: z.array(sketchEntitySchema).max(4_990),
    constraints: z.array(sketchConstraintSchema).max(10_000),
  })
  .strict()
  .superRefine((sketch, context) => {
    const entities = new Map<string, WireEntity>()
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
      if (!validEntityReferences(entity, entities)) {
        context.addIssue({
          code: "custom",
          path: ["entities", index],
          message: "Sketch entity references must target compatible entities.",
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
      if (constraintReferences(constraint).some((id) => !entities.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["constraints", index],
          message: "Sketch constraints must reference existing entities.",
        })
      }
    }
  })

const pointSolutionSchema = z
  .object({ entityId: sketchEntityIdSchema, x: coordinateSchema, y: coordinateSchema })
  .strict()
const circleSolutionSchema = z
  .object({ entityId: sketchEntityIdSchema, radius: radiusSchema })
  .strict()

export const sketchSolveContinuationWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    sketchId: sketchWireIdSchema,
    sourceRevision: revisionSchema,
    points: z.array(pointSolutionSchema).max(4_990),
    circles: z.array(circleSolutionSchema).max(2_495),
  })
  .strict()

export const sketchDragTargetWireSchema = pointSolutionSchema

export const solvedSketchWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    sketchId: sketchWireIdSchema,
    sourceRevision: revisionSchema,
    status: z.enum(["fully-constrained", "under-constrained", "over-constrained", "failed"]),
    degreesOfFreedom: z.number().int(),
    maximumResidual: z.number().finite().nonnegative(),
    points: z.array(pointSolutionSchema).max(4_990),
    circles: z.array(circleSolutionSchema).max(2_495),
    failedConstraintIds: z.array(sketchConstraintIdSchema).max(10_000),
    heapCapacityBytes: revisionSchema,
    solverBuild: z
      .object({
        schemaVersion: z.literal(0),
        solver: z.literal("SolveSpace"),
        solverVersion: z.literal("3.2"),
        sourceRevision: z.literal("27b6a080c8b669421bd4d444650c3b8eddec5687"),
        abiVersion: z.literal(1),
        moduleSha256: z.string().regex(sha256Pattern),
        wasmSha256: z.string().regex(sha256Pattern),
      })
      .strict(),
  })
  .strict()

export type SketchWireRecord = z.infer<typeof sketchWireRecordSchema>
export type SolvedSketchWire = z.infer<typeof solvedSketchWireSchema>
