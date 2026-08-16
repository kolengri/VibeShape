import {
  revisionSchema,
  type SketchConstraintId,
  type SketchEntityId,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  MAX_SKETCH_COORDINATE_MM,
  type SketchConstraint,
  type SketchEntity,
  type SketchRecord,
  sketchRecordSchema,
} from "@vibeshape/domain/sketch"
import {
  evaluateVariableDefinitions,
  resolveQuantityExpression,
  variableDefinitionsSchema,
} from "@vibeshape/domain/variables"
import { z } from "zod"
import {
  type FlatSketchSystemInput,
  type NativeSketchSolverModule,
  SOLVESPACE_CONSTRAINT_TYPE,
  SOLVESPACE_ENTITY_TYPE,
} from "./abi"
import { SKETCH_SOLVER_BUILD } from "./build-info"
import { detectSketchProfiles, type SketchProfileResult } from "./profiles"
import { solveSketchSystem } from "./solver"

const coordinateSchema = z
  .number()
  .finite()
  .min(-MAX_SKETCH_COORDINATE_MM)
  .max(MAX_SKETCH_COORDINATE_MM)
const radiusSchema = z.number().finite().positive().max(MAX_SKETCH_COORDINATE_MM)

const pointSolutionSchema = z
  .object({ entityId: sketchEntityIdSchema, x: coordinateSchema, y: coordinateSchema })
  .strict()
const circleSolutionSchema = z
  .object({ entityId: sketchEntityIdSchema, radius: radiusSchema })
  .strict()

export const sketchSolveContinuationSchema = z
  .object({
    schemaVersion: z.literal(0),
    sketchId: sketchIdSchema,
    sourceRevision: revisionSchema,
    points: z.array(pointSolutionSchema).max(4_990),
    circles: z.array(circleSolutionSchema).max(2_495),
  })
  .strict()
  .superRefine((continuation, context) => {
    for (const [path, values] of [
      ["points", continuation.points],
      ["circles", continuation.circles],
    ] as const) {
      const ids = new Set<string>()
      for (const [index, value] of values.entries()) {
        if (ids.has(value.entityId)) {
          context.addIssue({
            code: "custom",
            path: [path, index, "entityId"],
            message: "Sketch continuation entity IDs must be unique.",
          })
        }
        ids.add(value.entityId)
      }
    }
  })

export const sketchDragTargetSchema = z
  .object({ entityId: sketchEntityIdSchema, x: coordinateSchema, y: coordinateSchema })
  .strict()

const sketchCompilationInputSchema = z
  .object({
    revision: revisionSchema,
    sketch: sketchRecordSchema,
    variables: variableDefinitionsSchema.default([]),
    continuation: sketchSolveContinuationSchema.nullable().default(null),
    draggedPoints: z.array(sketchDragTargetSchema).max(128).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.continuation?.sketchId !== undefined) {
      if (input.continuation.sketchId !== input.sketch.id) {
        context.addIssue({
          code: "custom",
          path: ["continuation", "sketchId"],
          message: "Sketch continuation must match the solved sketch.",
        })
      }
      if (input.continuation.sourceRevision > input.revision) {
        context.addIssue({
          code: "custom",
          path: ["continuation", "sourceRevision"],
          message: "Sketch continuation cannot come from a future document revision.",
        })
      }
    }
    const draggedIds = new Set<string>()
    for (const [index, target] of input.draggedPoints.entries()) {
      if (draggedIds.has(target.entityId)) {
        context.addIssue({
          code: "custom",
          path: ["draggedPoints", index, "entityId"],
          message: "Dragged sketch point IDs must be unique.",
        })
      }
      draggedIds.add(target.entityId)
    }
  })

export type SketchSolveContinuation = Readonly<z.infer<typeof sketchSolveContinuationSchema>>
export type SketchDragTarget = Readonly<z.infer<typeof sketchDragTargetSchema>>
export type SketchCompilationInput = Readonly<z.input<typeof sketchCompilationInputSchema>>

export type SketchCompilationDiagnostic = Readonly<{
  code: "invalid-input" | "invalid-variables" | "invalid-dimension" | "invalid-continuation"
  message: string
  path: string
}>

type PointBinding = Readonly<{ xIndex: number; yIndex: number }>
type SketchBindings = Readonly<{
  pointParameters: ReadonlyMap<SketchEntityId, PointBinding>
  circleRadiusParameters: ReadonlyMap<SketchEntityId, number>
  constraintIdsByHandle: ReadonlyMap<number, SketchConstraintId>
}>

export type CompiledSketchSystem = Readonly<{
  sketch: SketchRecord
  revision: number
  system: FlatSketchSystemInput
  bindings: SketchBindings
}>

export type SketchCompilationResult =
  | { ok: true; compiled: CompiledSketchSystem }
  | { ok: false; diagnostic: SketchCompilationDiagnostic }

type EntityFields = Partial<{
  distance: number
  normal: number
  parameters: readonly number[]
  points: readonly number[]
  workplane: number
}>

type ConstraintFields = Partial<{
  entityA: number
  entityB: number
  entityC: number
  entityD: number
  other: number
  other2: number
  pointA: number
  pointB: number
  value: number
  workplane: number
}>

class ProductionSketchBuilder {
  readonly #parameterMetadata: number[] = []
  readonly #parameterValues: number[] = []
  readonly #entityRecords: number[] = []
  readonly #constraintRecords: number[] = []
  readonly #constraintValues: number[] = []
  readonly #entityHandles = new Map<SketchEntityId, number>()
  readonly #pointParameters = new Map<SketchEntityId, PointBinding>()
  readonly #circleRadiusParameters = new Map<SketchEntityId, number>()
  readonly #constraintIdsByHandle = new Map<number, SketchConstraintId>()
  #nextParameter = 11
  #nextEntity = 301
  #nextConstraint = 1
  #horizontalAxis = 0
  #verticalAxis = 0

  constructor() {
    this.#addParameter(0, 1, 1)
    this.#addParameter(0, 1, 2)
    this.#addParameter(0, 1, 3)
    this.#addParameter(1, 1, 4)
    this.#addParameter(0, 1, 5)
    this.#addParameter(0, 1, 6)
    this.#addParameter(0, 1, 7)
    this.#addEntity(101, 1, SOLVESPACE_ENTITY_TYPE.pointIn3d, { parameters: [1, 2, 3] })
    this.#addEntity(102, 1, SOLVESPACE_ENTITY_TYPE.normalIn3d, {
      parameters: [4, 5, 6, 7],
    })
    this.#addEntity(200, 1, SOLVESPACE_ENTITY_TYPE.workplane, {
      normal: 102,
      points: [101],
    })
  }

  addPoint(id: SketchEntityId, x: number, y: number) {
    const xParameter = this.#addParameter(x)
    const yParameter = this.#addParameter(y)
    const entity = this.#nextEntity++
    this.#addEntity(entity, 2, SOLVESPACE_ENTITY_TYPE.pointIn2d, {
      parameters: [xParameter.handle, yParameter.handle],
      workplane: 200,
    })
    this.#entityHandles.set(id, entity)
    this.#pointParameters.set(id, { xIndex: xParameter.index, yIndex: yParameter.index })
  }

  addLine(entity: Extract<SketchEntity, { type: "line" }>) {
    const handle = this.#nextEntity++
    this.#addEntity(handle, 2, SOLVESPACE_ENTITY_TYPE.lineSegment, {
      points: [this.entity(entity.startPointId), this.entity(entity.endPointId)],
      workplane: 200,
    })
    this.#entityHandles.set(entity.id, handle)
  }

  addCircle(entity: Extract<SketchEntity, { type: "circle" }>, radius: number) {
    const radiusParameter = this.#addParameter(radius)
    const distanceHandle = this.#nextEntity++
    this.#addEntity(distanceHandle, 2, SOLVESPACE_ENTITY_TYPE.distance, {
      parameters: [radiusParameter.handle],
      workplane: 200,
    })
    const circleHandle = this.#nextEntity++
    this.#addEntity(circleHandle, 2, SOLVESPACE_ENTITY_TYPE.circle, {
      distance: distanceHandle,
      normal: 102,
      points: [this.entity(entity.centerPointId)],
      workplane: 200,
    })
    this.#entityHandles.set(entity.id, circleHandle)
    this.#circleRadiusParameters.set(entity.id, radiusParameter.index)
  }

  addArc(entity: Extract<SketchEntity, { type: "arc" }>) {
    const handle = this.#nextEntity++
    this.#addEntity(handle, 2, SOLVESPACE_ENTITY_TYPE.arcOfCircle, {
      normal: 102,
      points: [
        this.entity(entity.centerPointId),
        this.entity(entity.startPointId),
        this.entity(entity.endPointId),
      ],
      workplane: 200,
    })
    this.#entityHandles.set(entity.id, handle)
  }

  addConstraint(id: SketchConstraintId, type: number, fields: ConstraintFields = {}) {
    const {
      entityA = 0,
      entityB = 0,
      entityC = 0,
      entityD = 0,
      other = 0,
      other2 = 0,
      pointA = 0,
      pointB = 0,
      value = 0,
      workplane = 200,
    } = fields
    const handle = this.#nextConstraint++
    this.#constraintRecords.push(
      handle,
      2,
      type,
      workplane,
      pointA,
      pointB,
      entityA,
      entityB,
      entityC,
      entityD,
      other,
      other2,
    )
    this.#constraintValues.push(value)
    this.#constraintIdsByHandle.set(handle, id)
  }

  entity(id: SketchEntityId) {
    const handle = this.#entityHandles.get(id)
    if (!handle) throw new Error(`Sketch entity ${id} has not been compiled.`)
    return handle
  }

  pointParameters(id: SketchEntityId) {
    const parameters = this.#pointParameters.get(id)
    if (!parameters) throw new Error(`Sketch point ${id} has not been compiled.`)
    return parameters
  }

  projectedAxis(direction: "horizontal" | "vertical") {
    const current = direction === "horizontal" ? this.#horizontalAxis : this.#verticalAxis
    if (current) return current
    const startX = this.#addParameter(0, 1).handle
    const startY = this.#addParameter(0, 1).handle
    const endX = this.#addParameter(direction === "horizontal" ? 1 : 0, 1).handle
    const endY = this.#addParameter(direction === "vertical" ? 1 : 0, 1).handle
    const start = this.#nextEntity++
    const end = this.#nextEntity++
    const line = this.#nextEntity++
    this.#addEntity(start, 1, SOLVESPACE_ENTITY_TYPE.pointIn2d, {
      parameters: [startX, startY],
      workplane: 200,
    })
    this.#addEntity(end, 1, SOLVESPACE_ENTITY_TYPE.pointIn2d, {
      parameters: [endX, endY],
      workplane: 200,
    })
    this.#addEntity(line, 1, SOLVESPACE_ENTITY_TYPE.lineSegment, {
      points: [start, end],
      workplane: 200,
    })
    if (direction === "horizontal") this.#horizontalAxis = line
    else this.#verticalAxis = line
    return line
  }

  build(draggedPointIds: readonly SketchEntityId[]): CompiledSketchSystem["system"] {
    const draggedParameters: number[] = []
    for (const id of draggedPointIds) {
      const point = this.pointParameters(id)
      const xHandle = this.#parameterMetadata[point.xIndex * 2]
      const yHandle = this.#parameterMetadata[point.yIndex * 2]
      if (!xHandle || !yHandle) throw new Error(`Sketch point ${id} has invalid parameters.`)
      draggedParameters.push(xHandle, yHandle)
    }
    return {
      parameterMetadata: new Uint32Array(this.#parameterMetadata),
      parameterValues: new Float64Array(this.#parameterValues),
      entityRecords: new Uint32Array(this.#entityRecords),
      constraintRecords: new Uint32Array(this.#constraintRecords),
      constraintValues: new Float64Array(this.#constraintValues),
      draggedParameters: new Uint32Array(draggedParameters),
      solveGroup: 2,
      calculateFailedConstraints: true,
    }
  }

  bindings(): SketchBindings {
    return {
      pointParameters: this.#pointParameters,
      circleRadiusParameters: this.#circleRadiusParameters,
      constraintIdsByHandle: this.#constraintIdsByHandle,
    }
  }

  #addParameter(value: number, group = 2, handle = this.#nextParameter++) {
    const index = this.#parameterValues.length
    this.#parameterMetadata.push(handle, group)
    this.#parameterValues.push(value)
    return { handle, index }
  }

  #addEntity(handle: number, group: number, type: number, fields: EntityFields = {}) {
    const {
      distance = 0,
      normal = 0,
      parameters: sourceParameters = [],
      points: sourcePoints = [],
      workplane = 0,
    } = fields
    const points = [...sourcePoints, 0, 0, 0, 0].slice(0, 4)
    const parameters = [...sourceParameters, 0, 0, 0, 0].slice(0, 4)
    this.#entityRecords.push(
      handle,
      group,
      type,
      workplane,
      ...points,
      normal,
      distance,
      ...parameters,
    )
  }
}

function compilationFailure(
  code: SketchCompilationDiagnostic["code"],
  message: string,
  path = "",
): SketchCompilationResult {
  return { ok: false, diagnostic: { code, message, path } }
}

function initialPointValues(
  sketch: SketchRecord,
  continuation: SketchSolveContinuation | null,
  draggedPoints: readonly SketchDragTarget[],
) {
  const values = new Map(
    sketch.entities.flatMap((entity) =>
      entity.type === "point" ? [[entity.id, { x: entity.x, y: entity.y }] as const] : [],
    ),
  )
  for (const point of continuation?.points ?? []) {
    const entity = sketch.entities.find((candidate) => candidate.id === point.entityId)
    if (entity?.type !== "point") return null
    values.set(point.entityId, { x: point.x, y: point.y })
  }
  for (const target of draggedPoints) {
    const entity = sketch.entities.find((candidate) => candidate.id === target.entityId)
    if (entity?.type !== "point") return null
    values.set(target.entityId, { x: target.x, y: target.y })
  }
  return values
}

function initialCircleRadii(sketch: SketchRecord, continuation: SketchSolveContinuation | null) {
  const radii = new Map(
    sketch.entities.flatMap((entity) =>
      entity.type === "circle" ? [[entity.id, entity.radius] as const] : [],
    ),
  )
  for (const circle of continuation?.circles ?? []) {
    const entity = sketch.entities.find((candidate) => candidate.id === circle.entityId)
    if (entity?.type !== "circle") return null
    radii.set(circle.entityId, circle.radius)
  }
  return radii
}

function curveCenterPoint(sketch: SketchRecord, entityId: SketchEntityId) {
  const entity = sketch.entities.find((candidate) => candidate.id === entityId)
  if (entity?.type !== "circle" && entity?.type !== "arc") {
    throw new Error(`Sketch curve ${entityId} does not have a center point.`)
  }
  return entity.centerPointId
}

function resolveDimension(
  constraint: Extract<SketchConstraint, { value: unknown }>,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  if (!variables.ok) return null
  const resolved = resolveQuantityExpression(constraint.value, variables.valuesByName)
  return resolved.ok ? resolved.quantity : null
}

type PointConstraint = Extract<
  SketchConstraint,
  {
    type: "coincident" | "point-on-line" | "point-on-curve" | "midpoint" | "symmetric" | "fixed"
  }
>
type RelationshipConstraint = Extract<
  SketchConstraint,
  {
    type:
      | "horizontal"
      | "vertical"
      | "parallel"
      | "perpendicular"
      | "equal"
      | "tangent"
      | "concentric"
  }
>
type DimensionConstraint = Exclude<SketchConstraint, PointConstraint | RelationshipConstraint>

const pointConstraintTypes = new Set<SketchConstraint["type"]>([
  "coincident",
  "point-on-line",
  "point-on-curve",
  "midpoint",
  "symmetric",
  "fixed",
])
const relationshipConstraintTypes = new Set<SketchConstraint["type"]>([
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "equal",
  "tangent",
  "concentric",
])

function isPointConstraint(constraint: SketchConstraint): constraint is PointConstraint {
  return pointConstraintTypes.has(constraint.type)
}

function isRelationshipConstraint(
  constraint: SketchConstraint,
): constraint is RelationshipConstraint {
  return relationshipConstraintTypes.has(constraint.type)
}

function addPointConstraint(builder: ProductionSketchBuilder, constraint: PointConstraint) {
  switch (constraint.type) {
    case "coincident":
      builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.pointsCoincident, {
        pointA: builder.entity(constraint.firstPointId),
        pointB: builder.entity(constraint.secondPointId),
      })
      return
    case "point-on-line":
      builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.pointOnLine, {
        pointA: builder.entity(constraint.pointId),
        entityA: builder.entity(constraint.lineId),
      })
      return
    case "point-on-curve":
      builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.pointOnCircle, {
        pointA: builder.entity(constraint.pointId),
        entityA: builder.entity(constraint.curveId),
      })
      return
    case "midpoint":
      builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.atMidpoint, {
        pointA: builder.entity(constraint.pointId),
        entityA: builder.entity(constraint.lineId),
      })
      return
    case "symmetric":
      builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.symmetricLine, {
        pointA: builder.entity(constraint.firstPointId),
        pointB: builder.entity(constraint.secondPointId),
        entityA: builder.entity(constraint.lineId),
      })
      return
    case "fixed":
      builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.whereDragged, {
        pointA: builder.entity(constraint.pointId),
      })
  }
}

function addRelationshipConstraint(
  builder: ProductionSketchBuilder,
  sketch: SketchRecord,
  constraint: RelationshipConstraint,
) {
  if (isOrientationConstraint(constraint)) {
    builder.addConstraint(constraint.id, orientationConstraintNativeTypes[constraint.type], {
      entityA: builder.entity(constraint.lineId),
    })
    return
  }
  if (isLinePairConstraint(constraint)) {
    builder.addConstraint(constraint.id, linePairConstraintNativeTypes[constraint.type], {
      entityA: builder.entity(constraint.firstEntityId),
      entityB: builder.entity(constraint.secondEntityId),
    })
    return
  }
  if (constraint.type === "equal") {
    const first = sketch.entities.find((entity) => entity.id === constraint.firstEntityId)
    builder.addConstraint(
      constraint.id,
      first?.type === "line"
        ? SOLVESPACE_CONSTRAINT_TYPE.equalLengthLines
        : SOLVESPACE_CONSTRAINT_TYPE.equalRadius,
      {
        entityA: builder.entity(constraint.firstEntityId),
        entityB: builder.entity(constraint.secondEntityId),
      },
    )
    return
  }
  if (constraint.type === "tangent") {
    builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.arcLineTangent, {
      entityA: builder.entity(constraint.arcId),
      entityB: builder.entity(constraint.lineId),
    })
    return
  }
  builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.pointsCoincident, {
    pointA: builder.entity(curveCenterPoint(sketch, constraint.firstEntityId)),
    pointB: builder.entity(curveCenterPoint(sketch, constraint.secondEntityId)),
  })
}

type OrientationConstraint = Extract<RelationshipConstraint, { type: "horizontal" | "vertical" }>
type LinePairConstraint = Extract<RelationshipConstraint, { type: "parallel" | "perpendicular" }>

const orientationConstraintTypes = new Set<SketchConstraint["type"]>(["horizontal", "vertical"])
const linePairConstraintTypes = new Set<SketchConstraint["type"]>(["parallel", "perpendicular"])
const orientationConstraintNativeTypes = {
  horizontal: SOLVESPACE_CONSTRAINT_TYPE.horizontal,
  vertical: SOLVESPACE_CONSTRAINT_TYPE.vertical,
} as const satisfies Record<OrientationConstraint["type"], number>
const linePairConstraintNativeTypes = {
  parallel: SOLVESPACE_CONSTRAINT_TYPE.parallel,
  perpendicular: SOLVESPACE_CONSTRAINT_TYPE.perpendicular,
} as const satisfies Record<LinePairConstraint["type"], number>

function isOrientationConstraint(
  constraint: RelationshipConstraint,
): constraint is OrientationConstraint {
  return orientationConstraintTypes.has(constraint.type)
}

function isLinePairConstraint(
  constraint: RelationshipConstraint,
): constraint is LinePairConstraint {
  return linePairConstraintTypes.has(constraint.type)
}

type DistanceConstraint = Extract<
  DimensionConstraint,
  { type: "horizontal-distance" | "vertical-distance" | "distance" }
>
type RadialConstraint = Extract<DimensionConstraint, { type: "radius" | "diameter" }>
type OffsetConstraint = Extract<DimensionConstraint, { type: "offset" }>

function addDistanceConstraint(
  builder: ProductionSketchBuilder,
  constraint: DistanceConstraint,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  const value = resolveDimension(constraint, variables)
  if (value?.dimension !== "length") return false
  const type =
    constraint.type === "distance"
      ? SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance
      : SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance
  builder.addConstraint(constraint.id, type, {
    pointA: builder.entity(constraint.firstPointId),
    pointB: builder.entity(constraint.secondPointId),
    entityA:
      constraint.type === "distance"
        ? 0
        : builder.projectedAxis(
            constraint.type === "horizontal-distance" ? "horizontal" : "vertical",
          ),
    value: value.value,
  })
  return true
}

function addAngleConstraint(
  builder: ProductionSketchBuilder,
  constraint: Extract<DimensionConstraint, { type: "angle" }>,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  const value = resolveDimension(constraint, variables)
  if (value?.dimension !== "angle") return false
  builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.angle, {
    entityA: builder.entity(constraint.firstEntityId),
    entityB: builder.entity(constraint.secondEntityId),
    value: (value.value * 180) / Math.PI,
  })
  return true
}

function addOffsetConstraint(
  builder: ProductionSketchBuilder,
  sketch: SketchRecord,
  constraint: OffsetConstraint,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  const value = resolveDimension(constraint, variables)
  if (value?.dimension !== "length" || value.value === 0) return false
  for (const pair of constraint.linePairs) {
    const offsetLine = sketch.entities.find(({ id }) => id === pair.offsetLineId)
    if (offsetLine?.type !== "line") return false
    builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.parallel, {
      entityA: builder.entity(pair.sourceLineId),
      entityB: builder.entity(pair.offsetLineId),
    })
    builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.pointLineDistance, {
      pointA: builder.entity(offsetLine.startPointId),
      entityA: builder.entity(pair.sourceLineId),
      // SolveSpace's signed point-to-line convention is opposite to the sketch cross product.
      value: -value.value * pair.distanceScale,
    })
  }
  for (const pair of constraint.endpointPairs) {
    builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance, {
      pointA: builder.entity(pair.sourcePointId),
      pointB: builder.entity(pair.offsetPointId),
      value: Math.abs(value.value),
    })
  }
  return true
}

function addRadialConstraint(
  builder: ProductionSketchBuilder,
  constraint: RadialConstraint,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  const value = resolveDimension(constraint, variables)
  if (value?.dimension !== "length") return false
  builder.addConstraint(constraint.id, SOLVESPACE_CONSTRAINT_TYPE.diameter, {
    entityA: builder.entity(constraint.curveId),
    value: constraint.type === "radius" ? value.value * 2 : value.value,
    workplane: 0,
  })
  return true
}

function addDimensionConstraint(
  builder: ProductionSketchBuilder,
  sketch: SketchRecord,
  constraint: DimensionConstraint,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  if (
    constraint.type === "horizontal-distance" ||
    constraint.type === "vertical-distance" ||
    constraint.type === "distance"
  ) {
    return addDistanceConstraint(builder, constraint, variables)
  }
  if (constraint.type === "offset") {
    return addOffsetConstraint(builder, sketch, constraint, variables)
  }
  if (constraint.type === "angle") return addAngleConstraint(builder, constraint, variables)
  return addRadialConstraint(builder, constraint, variables)
}

function addConstraint(
  builder: ProductionSketchBuilder,
  sketch: SketchRecord,
  constraint: SketchConstraint,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  if (isPointConstraint(constraint)) {
    addPointConstraint(builder, constraint)
    return true
  }
  if (isRelationshipConstraint(constraint)) {
    addRelationshipConstraint(builder, sketch, constraint)
    return true
  }
  return addDimensionConstraint(builder, sketch, constraint, variables)
}

function addSketchEntities(
  builder: ProductionSketchBuilder,
  sketch: SketchRecord,
  pointValues: ReadonlyMap<SketchEntityId, { x: number; y: number }>,
  circleRadii: ReadonlyMap<SketchEntityId, number>,
) {
  for (const entity of sketch.entities) {
    if (entity.type !== "point") continue
    const point = pointValues.get(entity.id)
    if (!point) throw new Error(`Sketch point ${entity.id} is missing initial values.`)
    builder.addPoint(entity.id, point.x, point.y)
  }
  for (const entity of sketch.entities) {
    if (entity.type === "line") builder.addLine(entity)
    if (entity.type === "circle") {
      const radius = circleRadii.get(entity.id)
      if (!radius) throw new Error(`Sketch circle ${entity.id} is missing an initial radius.`)
      builder.addCircle(entity, radius)
    }
    if (entity.type === "arc") builder.addArc(entity)
  }
}

function addSketchConstraints(
  builder: ProductionSketchBuilder,
  sketch: SketchRecord,
  variables: ReturnType<typeof evaluateVariableDefinitions>,
) {
  for (const [index, constraint] of sketch.constraints.entries()) {
    if (!addConstraint(builder, sketch, constraint, variables)) return index
  }
  return null
}

export function compileSketchSystem(inputValue: SketchCompilationInput): SketchCompilationResult {
  const input = sketchCompilationInputSchema.safeParse(inputValue)
  if (!input.success) {
    const issue = input.error.issues[0]
    return compilationFailure(
      issue?.path[0] === "continuation" ? "invalid-continuation" : "invalid-input",
      issue?.message ?? "Sketch compilation input is invalid.",
      issue?.path.map(String).join(".") ?? "",
    )
  }
  const variables = evaluateVariableDefinitions(input.data.variables)
  if (!variables.ok) {
    return compilationFailure("invalid-variables", variables.diagnostic.message, "variables")
  }
  const pointValues = initialPointValues(
    input.data.sketch,
    input.data.continuation,
    input.data.draggedPoints,
  )
  const circleRadii = initialCircleRadii(input.data.sketch, input.data.continuation)
  if (!pointValues || !circleRadii) {
    return compilationFailure(
      "invalid-continuation",
      "Sketch continuation references an incompatible or missing entity.",
      "continuation",
    )
  }

  const builder = new ProductionSketchBuilder()
  addSketchEntities(builder, input.data.sketch, pointValues, circleRadii)
  const invalidConstraintIndex = addSketchConstraints(builder, input.data.sketch, variables)
  if (invalidConstraintIndex !== null) {
    return compilationFailure(
      "invalid-dimension",
      "A sketch dimension expression did not resolve to the required dimension.",
      `sketch.constraints.${invalidConstraintIndex}.value`,
    )
  }

  return {
    ok: true,
    compiled: {
      sketch: input.data.sketch,
      revision: input.data.revision,
      system: builder.build(input.data.draggedPoints.map((target) => target.entityId)),
      bindings: builder.bindings(),
    },
  }
}

export type SolvedSketch = Readonly<{
  schemaVersion: 0
  sketchId: SketchRecord["id"]
  sourceRevision: number
  status: "fully-constrained" | "under-constrained" | "over-constrained" | "failed"
  degreesOfFreedom: number
  maximumResidual: number
  points: readonly z.infer<typeof pointSolutionSchema>[]
  circles: readonly z.infer<typeof circleSolutionSchema>[]
  failedConstraintIds: readonly SketchConstraintId[]
  profileResult: SketchProfileResult
  heapCapacityBytes: number
  solverBuild: typeof SKETCH_SOLVER_BUILD
}>

export type SolveSketchRecordResult =
  | { ok: true; solution: SolvedSketch }
  | { ok: false; diagnostic: SketchCompilationDiagnostic }

function profileResultForSolve(
  status: SolvedSketch["status"],
  sketch: SketchRecord,
  solution: Pick<SolvedSketch, "points" | "circles">,
): SketchProfileResult {
  if (status === "fully-constrained" || status === "under-constrained") {
    return detectSketchProfiles(sketch, solution)
  }
  return {
    schemaVersion: 0,
    profiles: [],
    loops: [],
    diagnostics: [
      {
        code: "invalid-solution",
        message: "Profiles are unavailable until the sketch has a valid solver result.",
        entityIds: [],
      },
    ],
  }
}

export function solveSketchRecord(
  module: NativeSketchSolverModule,
  input: SketchCompilationInput,
): SolveSketchRecordResult {
  const compilation = compileSketchSystem(input)
  if (!compilation.ok) return compilation
  const { bindings, revision, sketch, system } = compilation.compiled
  const result = solveSketchSystem(module, system)
  const points = [...bindings.pointParameters].map(([entityId, binding]) =>
    pointSolutionSchema.parse({
      entityId,
      x: result.parameterValues[binding.xIndex],
      y: result.parameterValues[binding.yIndex],
    }),
  )
  const circles = [...bindings.circleRadiusParameters].map(([entityId, index]) =>
    circleSolutionSchema.parse({ entityId, radius: result.parameterValues[index] }),
  )
  const failedConstraintIds = [
    ...new Set(
      [...result.failedConstraintHandles].flatMap((handle) => {
        const constraintId = bindings.constraintIdsByHandle.get(handle)
        return constraintId ? [constraintId] : []
      }),
    ),
  ]
  return {
    ok: true,
    solution: {
      schemaVersion: 0,
      sketchId: sketch.id,
      sourceRevision: revision,
      status: result.status,
      degreesOfFreedom: result.degreesOfFreedom,
      maximumResidual: result.maximumResidual,
      points,
      circles,
      failedConstraintIds,
      profileResult: profileResultForSolve(result.status, sketch, { points, circles }),
      heapCapacityBytes: result.heapCapacityBytes,
      solverBuild: SKETCH_SOLVER_BUILD,
    },
  }
}
