import { isString } from "is-what"
import { z } from "zod"
import { topologySignatureSchema } from "./geometry-worker"

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sha256Pattern = /^[0-9a-f]{64}$/
export const sketchWireIdSchema = z.string().regex(uuidV7Pattern)
const sketchEntityIdSchema = z.string().regex(uuidV7Pattern)
const sketchConstraintIdSchema = z.string().regex(uuidV7Pattern)
const sketchExternalReferenceIdSchema = z.string().regex(uuidV7Pattern)
const revisionSchema = z.number().int().nonnegative().safe()
const featureIdSchema = z.string().regex(uuidV7Pattern)
const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000)
const radiusSchema = z.number().finite().positive().max(1_000_000)
const expressionSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((expression) => expression.trim() === expression)

const supportVectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const topologyIntentWireSchema = z
  .object({
    nearPoint: supportVectorSchema.optional(),
    expectedDirection: supportVectorSchema.optional(),
  })
  .strict()
const topoRefWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    featureId: featureIdSchema,
    kind: z.enum(["vertex", "edge", "face"]),
    semanticRole: z.string().min(1).max(256).optional(),
    lineageToken: z.string().min(1).max(256).optional(),
    signature: topologySignatureSchema,
    intent: topologyIntentWireSchema.optional(),
  })
  .strict()
  .refine((reference) => reference.kind === reference.signature.kind, {
    message: "Topology reference kind must match its signature kind.",
  })
const vertexTopoRefWireSchema = topoRefWireSchema
  .safeExtend({
    kind: z.literal("vertex"),
    signature: topologySignatureSchema.safeExtend({ kind: z.literal("vertex") }),
  })
  .strict()
const edgeTopoRefWireSchema = topoRefWireSchema
  .safeExtend({
    kind: z.literal("edge"),
    signature: topologySignatureSchema.safeExtend({ kind: z.literal("edge") }),
  })
  .strict()
const planarFaceTopoRefWireSchema = topoRefWireSchema
  .safeExtend({
    kind: z.literal("face"),
    signature: topologySignatureSchema.safeExtend({
      kind: z.literal("face"),
      geometryClass: z.literal("PLANE"),
    }),
  })
  .strict()
const sketchFeatureFaceSupportWireSchema = z
  .object({
    kind: z.literal("feature-face"),
    reference: planarFaceTopoRefWireSchema,
  })
  .strict()
  .refine(({ reference }) => reference.signature.geometryClass === "PLANE", {
    message: "A sketch feature-face support must be planar.",
  })

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

const ellipseEntitySchema = z
  .object({
    ...entityEnvelope,
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
  )

const ellipticalArcEntitySchema = z
  .object({
    ...entityEnvelope,
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
  )

const sketchEntitySchema = z.discriminatedUnion("type", [
  pointEntitySchema,
  lineEntitySchema,
  circleEntitySchema,
  arcEntitySchema,
  ellipseEntitySchema,
  ellipticalArcEntitySchema,
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
const drivingSketchConstraintSchema = z.discriminatedUnion("type", [
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
    .object({
      ...constraintEnvelope,
      type: z.literal("point-on-ellipse"),
      pointId: sketchEntityIdSchema,
      ellipseId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("point-on-elliptical-arc"),
      pointId: sketchEntityIdSchema,
      ellipticalArcId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("ellipse-quadrant"),
      pointId: sketchEntityIdSchema,
      ellipseId: sketchEntityIdSchema,
      axis: z.enum(["primary", "secondary"]),
      side: z.enum(["negative", "positive"]),
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("midpoint"),
      pointId: sketchEntityIdSchema,
      lineId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("arc-midpoint"),
      pointId: sketchEntityIdSchema,
      arcId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("symmetric"),
      ...pointPair,
      lineId: sketchEntityIdSchema,
    })
    .strict(),
  z
    .object({ ...constraintEnvelope, type: z.literal("fixed"), pointId: sketchEntityIdSchema })
    .strict(),
  z
    .object({ ...constraintEnvelope, type: z.literal("horizontal-points"), ...pointPair })
    .strict()
    .refine((constraint) => constraint.firstPointId !== constraint.secondPointId),
  z
    .object({ ...constraintEnvelope, type: z.literal("vertical-points"), ...pointPair })
    .strict()
    .refine((constraint) => constraint.firstPointId !== constraint.secondPointId),
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
      type: z.literal("offset"),
      linePairs: z
        .array(
          z
            .object({
              sourceLineId: sketchEntityIdSchema,
              offsetLineId: sketchEntityIdSchema,
              distanceScale: z.union([z.literal(-1), z.literal(1)]),
            })
            .strict()
            .refine((pair) => pair.sourceLineId !== pair.offsetLineId),
        )
        .min(1)
        .max(4_990),
      endpointPairs: z
        .array(
          z
            .object({
              sourcePointId: sketchEntityIdSchema,
              offsetPointId: sketchEntityIdSchema,
            })
            .strict()
            .refine((pair) => pair.sourcePointId !== pair.offsetPointId),
        )
        .max(2),
      value: lengthQuantitySchema,
    })
    .strict()
    .refine((constraint) => constraint.value.value !== 0)
    .refine(
      (constraint) =>
        new Set(constraint.linePairs.map(({ sourceLineId }) => sourceLineId)).size ===
          constraint.linePairs.length &&
        new Set(constraint.linePairs.map(({ offsetLineId }) => offsetLineId)).size ===
          constraint.linePairs.length,
    )
    .refine(
      (constraint) =>
        constraint.endpointPairs.length === 0 || constraint.endpointPairs.length === 2,
    )
    .refine(
      (constraint) =>
        new Set(constraint.endpointPairs.map(({ sourcePointId }) => sourcePointId)).size ===
          constraint.endpointPairs.length &&
        new Set(constraint.endpointPairs.map(({ offsetPointId }) => offsetPointId)).size ===
          constraint.endpointPairs.length,
    ),
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
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("primary-axis-diameter"),
      curveId: sketchEntityIdSchema,
      value: lengthQuantitySchema,
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("secondary-axis-diameter"),
      curveId: sketchEntityIdSchema,
      value: lengthQuantitySchema,
    })
    .strict(),
])

const referenceDimensionSchema = z.union([
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("horizontal-distance"),
      ...pointPair,
      mode: z.literal("reference"),
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("vertical-distance"),
      ...pointPair,
      mode: z.literal("reference"),
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("distance"),
      ...pointPair,
      mode: z.literal("reference"),
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("angle"),
      ...entityPair,
      mode: z.literal("reference"),
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("radius"),
      curveId: sketchEntityIdSchema,
      mode: z.literal("reference"),
    })
    .strict(),
  z
    .object({
      ...constraintEnvelope,
      type: z.literal("diameter"),
      curveId: sketchEntityIdSchema,
      mode: z.literal("reference"),
    })
    .strict(),
])

const sketchConstraintSchema = z.union([drivingSketchConstraintSchema, referenceDimensionSchema])

const externalPointReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("point").optional(),
    sourceSketchId: sketchWireIdSchema,
    sourcePointId: sketchEntityIdSchema,
    projectedPointId: sketchEntityIdSchema,
  })
  .strict()

const externalLineReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("line"),
    sourceSketchId: sketchWireIdSchema,
    sourceLineId: sketchEntityIdSchema,
    projectedLineId: sketchEntityIdSchema,
    projectedStartPointId: sketchEntityIdSchema,
    projectedEndPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((reference) => reference.projectedStartPointId !== reference.projectedEndPointId)

const externalPiercePointReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("pierce-point"),
    sourceSketchId: sketchWireIdSchema,
    sourceLineId: sketchEntityIdSchema,
    projectedPointId: sketchEntityIdSchema,
  })
  .strict()

const externalCurveTypeWireSchema = z.enum(["circle", "arc", "ellipse", "elliptical-arc"])
const projectedCurvePointCount = {
  arc: 3,
  circle: 1,
  ellipse: 3,
  "elliptical-arc": 5,
} as const satisfies Record<z.infer<typeof externalCurveTypeWireSchema>, number>

function validateProjectedCurveWireIdentities(
  reference: {
    projectedEntityId: string
    projectedPointIds: readonly string[]
    projectedType: z.infer<typeof externalCurveTypeWireSchema>
  },
  context: z.RefinementCtx,
) {
  if (reference.projectedPointIds.length !== projectedCurvePointCount[reference.projectedType]) {
    context.addIssue({
      code: "custom",
      path: ["projectedPointIds"],
      message: "Projected curve point IDs must match the projected curve type.",
    })
  }
  if (new Set(reference.projectedPointIds).size !== reference.projectedPointIds.length) {
    context.addIssue({
      code: "custom",
      path: ["projectedPointIds"],
      message: "Projected curve point IDs must be unique.",
    })
  }
  if (reference.projectedPointIds.includes(reference.projectedEntityId)) {
    context.addIssue({
      code: "custom",
      path: ["projectedEntityId"],
      message: "The projected curve ID must differ from every projected point ID.",
    })
  }
}

const externalCurveReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("curve"),
    sourceSketchId: sketchWireIdSchema,
    sourceEntityId: sketchEntityIdSchema,
    sourceType: externalCurveTypeWireSchema,
    projectedEntityId: sketchEntityIdSchema,
    projectedType: externalCurveTypeWireSchema,
    projectedPointIds: z.array(sketchEntityIdSchema).min(1).max(5),
  })
  .strict()
  .superRefine(validateProjectedCurveWireIdentities)

const externalModelPointReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-point"),
    reference: vertexTopoRefWireSchema,
    projectedPointId: sketchEntityIdSchema,
  })
  .strict()

const externalModelLineReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-line"),
    reference: edgeTopoRefWireSchema,
    projectedLineId: sketchEntityIdSchema,
    projectedStartPointId: sketchEntityIdSchema,
    projectedEndPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((reference) => reference.projectedStartPointId !== reference.projectedEndPointId)

const externalModelCurveReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-curve"),
    reference: edgeTopoRefWireSchema,
    sourceType: externalCurveTypeWireSchema,
    projectedEntityId: sketchEntityIdSchema,
    projectedType: externalCurveTypeWireSchema,
    projectedPointIds: z.array(sketchEntityIdSchema).min(1).max(5),
  })
  .strict()
  .superRefine((reference, context) => {
    validateProjectedCurveWireIdentities(reference, context)
    const expectedGeometryClass =
      reference.sourceType === "circle" || reference.sourceType === "arc" ? "CIRCLE" : "ELLIPSE"
    if (reference.reference.signature.geometryClass !== expectedGeometryClass) {
      context.addIssue({
        code: "custom",
        path: ["reference", "signature", "geometryClass"],
        message: "Model curve source type must match topology geometry.",
      })
    }
  })

const externalModelIntersectionReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-intersection"),
    reference: planarFaceTopoRefWireSchema,
    projectedLineId: sketchEntityIdSchema,
    projectedStartPointId: sketchEntityIdSchema,
    projectedEndPointId: sketchEntityIdSchema,
  })
  .strict()
  .refine((reference) => reference.projectedStartPointId !== reference.projectedEndPointId)

const deletedFeatureSourceWireSchema = z
  .object({
    kind: z.literal("deleted-feature"),
    featureId: featureIdSchema,
  })
  .strict()

function validateOrphanedModelReference(
  reference: {
    orphanedSource: { featureId: string }
    reference: { featureId: string }
  },
  context: z.RefinementCtx,
) {
  if (reference.orphanedSource.featureId === reference.reference.featureId) return
  context.addIssue({
    code: "custom",
    path: ["orphanedSource", "featureId"],
    message: "An orphaned source must identify the deleted topology producer.",
  })
}

const orphanedExternalModelPointReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-point"),
    reference: vertexTopoRefWireSchema,
    projectedPointId: sketchEntityIdSchema,
    orphanedSource: deletedFeatureSourceWireSchema,
  })
  .strict()
  .superRefine(validateOrphanedModelReference)

const orphanedExternalModelLineReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-line"),
    reference: edgeTopoRefWireSchema,
    projectedLineId: sketchEntityIdSchema,
    projectedStartPointId: sketchEntityIdSchema,
    projectedEndPointId: sketchEntityIdSchema,
    orphanedSource: deletedFeatureSourceWireSchema,
  })
  .strict()
  .superRefine((reference, context) => {
    validateOrphanedModelReference(reference, context)
    if (reference.projectedStartPointId === reference.projectedEndPointId)
      context.addIssue({
        code: "custom",
        path: ["projectedEndPointId"],
        message: "A projected model line requires distinct endpoint IDs.",
      })
  })

const orphanedExternalModelCurveReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-curve"),
    reference: edgeTopoRefWireSchema,
    sourceType: externalCurveTypeWireSchema,
    projectedEntityId: sketchEntityIdSchema,
    projectedType: externalCurveTypeWireSchema,
    projectedPointIds: z.array(sketchEntityIdSchema).min(1).max(5),
    orphanedSource: deletedFeatureSourceWireSchema,
  })
  .strict()
  .superRefine((reference, context) => {
    validateProjectedCurveWireIdentities(reference, context)
    validateOrphanedModelReference(reference, context)
    const expectedGeometryClass =
      reference.sourceType === "circle" || reference.sourceType === "arc" ? "CIRCLE" : "ELLIPSE"
    if (reference.reference.signature.geometryClass !== expectedGeometryClass) {
      context.addIssue({
        code: "custom",
        path: ["reference", "signature", "geometryClass"],
        message: "Model curve source type must match topology geometry.",
      })
    }
  })

const orphanedExternalModelIntersectionReferenceWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: sketchExternalReferenceIdSchema,
    kind: z.literal("model-intersection"),
    reference: planarFaceTopoRefWireSchema,
    projectedLineId: sketchEntityIdSchema,
    projectedStartPointId: sketchEntityIdSchema,
    projectedEndPointId: sketchEntityIdSchema,
    orphanedSource: deletedFeatureSourceWireSchema,
  })
  .strict()
  .superRefine((reference, context) => {
    validateOrphanedModelReference(reference, context)
    if (reference.projectedStartPointId === reference.projectedEndPointId)
      context.addIssue({
        code: "custom",
        path: ["projectedEndPointId"],
        message: "A projected model intersection requires distinct endpoint IDs.",
      })
  })

const externalReferenceWireSchema = z.union([
  externalPointReferenceWireSchema,
  externalLineReferenceWireSchema,
  externalPiercePointReferenceWireSchema,
  externalCurveReferenceWireSchema,
  externalModelPointReferenceWireSchema,
  externalModelLineReferenceWireSchema,
  externalModelCurveReferenceWireSchema,
  externalModelIntersectionReferenceWireSchema,
  orphanedExternalModelPointReferenceWireSchema,
  orphanedExternalModelLineReferenceWireSchema,
  orphanedExternalModelCurveReferenceWireSchema,
  orphanedExternalModelIntersectionReferenceWireSchema,
])

type WireEntity = z.infer<typeof sketchEntitySchema>

function entityIs(entities: ReadonlyMap<string, WireEntity>, id: string, types: readonly string[]) {
  const entity = entities.get(id)
  return entity !== undefined && types.includes(entity.type)
}

function validEntityReferences(entity: WireEntity, entities: ReadonlyMap<string, WireEntity>) {
  return wireEntityPointReferenceIds(entity).every((id) => entityIs(entities, id, ["point"]))
}

function wireEntityPointReferenceIds(entity: WireEntity): readonly string[] {
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

type SketchWireConstraint = z.infer<typeof sketchConstraintSchema>

type WireEntityReferenceRules = Readonly<Record<string, readonly WireEntity["type"][]>>

const wireConstraintEntityReferenceRules = {
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
  "point-on-ellipse": { pointId: ["point"], ellipseId: ["ellipse"] },
  "point-on-elliptical-arc": { pointId: ["point"], ellipticalArcId: ["elliptical-arc"] },
  "ellipse-quadrant": { pointId: ["point"], ellipseId: ["ellipse"] },
  midpoint: { pointId: ["point"], lineId: ["line"] },
  "arc-midpoint": { pointId: ["point"], arcId: ["arc"] },
  symmetric: {
    firstPointId: ["point"],
    secondPointId: ["point"],
    lineId: ["line"],
  },
  fixed: { pointId: ["point"] },
  "horizontal-distance": { firstPointId: ["point"], secondPointId: ["point"] },
  "vertical-distance": { firstPointId: ["point"], secondPointId: ["point"] },
  "horizontal-points": { firstPointId: ["point"], secondPointId: ["point"] },
  "vertical-points": { firstPointId: ["point"], secondPointId: ["point"] },
  distance: { firstPointId: ["point"], secondPointId: ["point"] },
  angle: { firstEntityId: ["line"], secondEntityId: ["line"] },
  radius: { curveId: ["circle", "arc"] },
  diameter: { curveId: ["circle", "arc"] },
  "primary-axis-diameter": { curveId: ["ellipse", "elliptical-arc"] },
  "secondary-axis-diameter": { curveId: ["ellipse", "elliptical-arc"] },
} as const satisfies Record<
  Exclude<SketchWireConstraint["type"], "equal" | "offset">,
  WireEntityReferenceRules
>

type SketchWireStructure = Readonly<{
  constraints: readonly SketchWireConstraint[]
  entities: readonly WireEntity[]
  externalReferences?: readonly z.infer<typeof externalReferenceWireSchema>[] | undefined
}>

function indexWireEntities(sketch: SketchWireStructure, context: z.RefinementCtx) {
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
  return entities
}

function validateWireEntityTable(
  sketch: SketchWireStructure,
  entities: ReadonlyMap<string, WireEntity>,
  context: z.RefinementCtx,
) {
  for (const [index, entity] of sketch.entities.entries()) {
    if (validEntityReferences(entity, entities)) continue
    context.addIssue({
      code: "custom",
      path: ["entities", index],
      message: "Sketch entity references must target compatible entities.",
    })
  }
}

function offsetTargetsAreValid(
  constraint: Extract<SketchWireConstraint, { type: "offset" }>,
  entities: ReadonlyMap<string, WireEntity>,
) {
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

function equalTargetsAreValid(
  constraint: Extract<SketchWireConstraint, { type: "equal" }>,
  entities: ReadonlyMap<string, WireEntity>,
) {
  const first = entities.get(constraint.firstEntityId)
  const second = entities.get(constraint.secondEntityId)
  if (!first || !second) return false
  if (first.type === "line" || second.type === "line") {
    return first.type === "line" && second.type === "line"
  }
  const roundTypes: readonly WireEntity["type"][] = ["circle", "arc"]
  return roundTypes.includes(first.type) && roundTypes.includes(second.type)
}

function wireConstraintReferencesAreValid(
  constraint: SketchWireConstraint,
  entities: ReadonlyMap<string, WireEntity>,
) {
  if (constraint.type === "offset") return offsetTargetsAreValid(constraint, entities)
  if (constraint.type === "equal") return equalTargetsAreValid(constraint, entities)
  const constraintRecord = constraint as unknown as Readonly<Record<string, unknown>>
  const rules: WireEntityReferenceRules = wireConstraintEntityReferenceRules[constraint.type]
  return Object.entries(rules).every(([field, entityTypes]) => {
    const entityId = constraintRecord[field]
    return isString(entityId) && entityIs(entities, entityId, entityTypes)
  })
}

type WireExternalReference = NonNullable<SketchWireStructure["externalReferences"]>[number]

function wireProjectedPoint(id: string): Extract<WireEntity, { type: "point" }> {
  return { schemaVersion: 0, id, type: "point", construction: true, x: 0, y: 0 }
}

function wireProjectedCurveEntity(
  reference: Extract<WireExternalReference, { kind: "curve" | "model-curve" }>,
): WireEntity | null {
  const [centerPointId, firstPointId, secondPointId, startPointId, endPointId] =
    reference.projectedPointIds
  if (!centerPointId) return null
  const base = { schemaVersion: 0 as const, id: reference.projectedEntityId, construction: true }
  if (reference.projectedType === "circle") {
    return { ...base, type: "circle", centerPointId, radius: 1 }
  }
  if (!firstPointId || !secondPointId) return null
  if (reference.projectedType === "arc") {
    return {
      ...base,
      type: "arc",
      centerPointId,
      startPointId: firstPointId,
      endPointId: secondPointId,
    }
  }
  if (reference.projectedType === "ellipse") {
    return {
      ...base,
      type: "ellipse",
      centerPointId,
      primaryAxisPointId: firstPointId,
      secondaryAxisPointId: secondPointId,
    }
  }
  return startPointId && endPointId
    ? {
        ...base,
        type: "elliptical-arc",
        centerPointId,
        primaryAxisPointId: firstPointId,
        secondaryAxisPointId: secondPointId,
        startPointId,
        endPointId,
      }
    : null
}

function wireProjectedExternalEntities(reference: WireExternalReference): readonly WireEntity[] {
  if (
    reference.kind === "line" ||
    reference.kind === "model-line" ||
    reference.kind === "model-intersection"
  ) {
    return [
      wireProjectedPoint(reference.projectedStartPointId),
      wireProjectedPoint(reference.projectedEndPointId),
      {
        schemaVersion: 0,
        id: reference.projectedLineId,
        type: "line",
        construction: true,
        startPointId: reference.projectedStartPointId,
        endPointId: reference.projectedEndPointId,
      },
    ]
  }
  if (reference.kind !== "curve" && reference.kind !== "model-curve") {
    return [wireProjectedPoint(reference.projectedPointId)]
  }
  const points = reference.projectedPointIds.map(wireProjectedPoint)
  const curve = wireProjectedCurveEntity(reference)
  return curve ? [...points, curve] : []
}

function wireProjectedExternalGeometry(sketch: SketchWireStructure) {
  return (sketch.externalReferences ?? []).flatMap(wireProjectedExternalEntities)
}

function nativeWireConstraintContribution(constraint: z.infer<typeof sketchConstraintSchema>) {
  if ("mode" in constraint && constraint.mode === "reference") return 0
  if (constraint.type === "offset") {
    return constraint.linePairs.length * 2 + constraint.endpointPairs.length
  }
  if (constraint.type === "arc-midpoint") return 2
  if (constraint.type === "ellipse-quadrant") return 6
  if (constraint.type === "point-on-ellipse") return 5
  return constraint.type === "point-on-elliptical-arc" ? 6 : 1
}

function nativeWireConstraintCount(sketch: SketchWireStructure) {
  const authored = sketch.constraints.reduce(
    (count, constraint) => count + nativeWireConstraintContribution(constraint),
    0,
  )
  const internal = sketch.entities.reduce((count, entity) => {
    if (entity.type === "ellipse") return count + 1
    return entity.type === "elliptical-arc" ? count + 11 : count
  }, 0)
  const external = wireProjectedExternalGeometry(sketch).reduce((count, entity) => {
    if (entity.type === "point" || entity.type === "circle" || entity.type === "ellipse") {
      return count + 1
    }
    return entity.type === "elliptical-arc" ? count + 11 : count
  }, 0)
  return authored + internal + external
}

const nativeWireEntityCapacity = {
  arc: { entities: 1, parameters: 0 },
  circle: { entities: 2, parameters: 1 },
  ellipse: { entities: 2, parameters: 0 },
  "elliptical-arc": { entities: 10, parameters: 8 },
  line: { entities: 1, parameters: 0 },
  point: { entities: 1, parameters: 2 },
} as const satisfies Record<WireEntity["type"], Readonly<{ entities: number; parameters: number }>>

function nativeWireCapacity(sketch: SketchWireStructure) {
  const authored = sketch.entities.reduce(
    (capacity, entity) => ({
      entities: capacity.entities + nativeWireEntityCapacity[entity.type].entities,
      parameters: capacity.parameters + nativeWireEntityCapacity[entity.type].parameters,
    }),
    { entities: 3, parameters: 7 },
  )
  const projectionCount =
    Number(
      sketch.constraints.some(
        ({ type }) => type === "horizontal-distance" || type === "horizontal-points",
      ),
    ) +
    Number(
      sketch.constraints.some(
        ({ type }) => type === "vertical-distance" || type === "vertical-points",
      ),
    )
  const auxiliaryArcMidpointLineCount =
    sketch.constraints.filter(({ type }) => type === "arc-midpoint").length * 2
  const auxiliaryEllipseQuadrantCount = sketch.constraints.filter(
    ({ type }) => type === "ellipse-quadrant",
  ).length
  const auxiliaryEllipseLocusCount = sketch.constraints.filter(
    ({ type }) => type === "point-on-ellipse" || type === "point-on-elliptical-arc",
  ).length
  return {
    entities:
      authored.entities +
      wireProjectedExternalGeometry(sketch).reduce(
        (count, entity) => count + nativeWireEntityCapacity[entity.type].entities,
        0,
      ) +
      projectionCount * 3 +
      auxiliaryArcMidpointLineCount +
      auxiliaryEllipseQuadrantCount * 4 +
      auxiliaryEllipseLocusCount * 4,
    parameters:
      authored.parameters +
      wireProjectedExternalGeometry(sketch).reduce(
        (count, entity) => count + nativeWireEntityCapacity[entity.type].parameters,
        0,
      ) +
      projectionCount * 4 +
      auxiliaryEllipseQuadrantCount * 4 +
      auxiliaryEllipseLocusCount * 4,
  }
}

function wireConstraintEntitiesWithExternalGeometry(
  sketch: SketchWireStructure,
  entities: ReadonlyMap<string, WireEntity>,
) {
  const constraintEntities = new Map(entities)
  for (const entity of wireProjectedExternalGeometry(sketch))
    constraintEntities.set(entity.id, entity)
  return constraintEntities
}

function validateWireExternalReferenceIds(sketch: SketchWireStructure, context: z.RefinementCtx) {
  const entityIds = new Set(sketch.entities.map((entity) => entity.id))
  const referenceIds = new Set<string>()
  const projectedEntityIds = new Set<string>()
  for (const [index, reference] of (sketch.externalReferences ?? []).entries()) {
    if (referenceIds.has(reference.id)) {
      context.addIssue({
        code: "custom",
        path: ["externalReferences", index, "id"],
        message: "External sketch reference IDs must be unique.",
      })
    }
    const projectedIds = wireProjectedExternalEntities(reference).map(({ id }) => id)
    for (const projectedId of projectedIds) {
      if (projectedEntityIds.has(projectedId) || entityIds.has(projectedId)) {
        context.addIssue({
          code: "custom",
          path: ["externalReferences", index],
          message:
            "Projected external geometry IDs must be unique and cannot collide with sketch entities.",
        })
      }
      projectedEntityIds.add(projectedId)
    }
    referenceIds.add(reference.id)
  }
}

function validateWireConstraintTable(
  sketch: SketchWireStructure,
  entities: ReadonlyMap<string, WireEntity>,
  context: z.RefinementCtx,
) {
  const constraintEntities = wireConstraintEntitiesWithExternalGeometry(sketch, entities)
  validateWireExternalReferenceIds(sketch, context)
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
    if (wireConstraintReferencesAreValid(constraint, constraintEntities)) continue
    context.addIssue({
      code: "custom",
      path: ["constraints", index],
      message: "Sketch constraints must reference compatible entities.",
    })
  }
  if (nativeWireConstraintCount(sketch) <= 10_000) return
  context.addIssue({
    code: "custom",
    path: ["constraints"],
    message: "Sketch constraints exceed the native solver safety limit.",
  })
}

function validateNativeWireCapacity(sketch: SketchWireStructure, context: z.RefinementCtx) {
  const capacity = nativeWireCapacity(sketch)
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
    support: sketchFeatureFaceSupportWireSchema.optional(),
    entities: z.array(sketchEntitySchema).max(4_990),
    constraints: z.array(sketchConstraintSchema).max(10_000),
    externalReferences: z.array(externalReferenceWireSchema).max(4_990).optional(),
  })
  .strict()
  .superRefine((sketch, context) => {
    const entities = indexWireEntities(sketch, context)
    validateWireEntityTable(sketch, entities, context)
    validateWireConstraintTable(sketch, entities, context)
    validateNativeWireCapacity(sketch, context)
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

const profileBoundsWireSchema = z
  .object({
    minX: coordinateSchema,
    minY: coordinateSchema,
    maxX: coordinateSchema,
    maxY: coordinateSchema,
  })
  .strict()
  .refine((bounds) => bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY)

const profileLoopSegmentWireSchema = z
  .object({
    entityId: sketchEntityIdSchema,
    type: z.enum(["line", "arc", "circle", "ellipse", "elliptical-arc"]),
    reversed: z.boolean(),
  })
  .strict()

const profileLoopWireSchema = z
  .object({
    loopIndex: revisionSchema,
    parentLoopIndex: revisionSchema.nullable(),
    depth: revisionSchema,
    signedArea: z.number().finite().positive(),
    perimeter: z.number().finite().positive(),
    bounds: profileBoundsWireSchema,
    sourceEntityIds: z.array(sketchEntityIdSchema).min(1).max(2_000),
    segments: z.array(profileLoopSegmentWireSchema).min(1).max(2_000),
  })
  .strict()

const profileWireSchema = z
  .object({
    profileIndex: revisionSchema,
    outerLoopIndex: revisionSchema,
    holeLoopIndices: z.array(revisionSchema).max(2_000),
    area: z.number().finite().positive(),
    perimeter: z.number().finite().positive(),
    bounds: profileBoundsWireSchema,
  })
  .strict()

const profileDiagnosticWireSchema = z
  .object({
    code: z.enum([
      "invalid-solution",
      "profile-budget-exceeded",
      "degenerate-entity",
      "duplicate-entity",
      "intersecting-entities",
      "open-chain",
    ]),
    message: z
      .string()
      .min(1)
      .max(300)
      .refine((message) => message.trim() === message),
    entityIds: z.array(sketchEntityIdSchema).max(64),
  })
  .strict()

export const sketchProfileResultWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    profiles: z.array(profileWireSchema).max(2_000),
    loops: z.array(profileLoopWireSchema).max(2_000),
    diagnostics: z.array(profileDiagnosticWireSchema).max(2_000),
  })
  .strict()
  .refine(
    (result) =>
      result.loops.every(
        (loop, index) =>
          loop.loopIndex === index &&
          (loop.parentLoopIndex === null || loop.parentLoopIndex < loop.loopIndex),
      ),
    { message: "Profile loop indices and parents must follow deterministic output order." },
  )
  .refine(
    (result) =>
      result.profiles.every(
        (profile, index) =>
          profile.profileIndex === index &&
          profile.outerLoopIndex < result.loops.length &&
          profile.holeLoopIndices.every((loopIndex) => loopIndex < result.loops.length),
      ),
    { message: "Profile indices must reference loops in the same result." },
  )

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
    profileResult: sketchProfileResultWireSchema,
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
export type SketchProfileResultWire = z.infer<typeof sketchProfileResultWireSchema>
export type SolvedSketchWire = z.infer<typeof solvedSketchWireSchema>
