import { z } from "zod"
import { type SketchEntityId, type SketchId, sketchEntityIdSchema } from "./identifiers"
import { type SketchEntity, type SketchRecord, sketchRecordSchema } from "./sketch"
import { createEmptySketch } from "./sketch-edit"

export const PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM = 1e-7
export const PLANAR_IMPORT_NATIVE_ENTITY_LIMIT = 4_990
const coordinate = z.number().finite().min(-100_000).max(100_000)
export const planarImportPointSchema = z.tuple([coordinate, coordinate])
export type PlanarImportPoint = z.infer<typeof planarImportPointSchema>
const radius = z.number().finite().gt(PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM).max(100_000)
const conic = {
  center: planarImportPointSchema,
  primaryAxis: planarImportPointSchema,
  secondaryAxis: planarImportPointSchema,
}
const arc = {
  startAngle: z.number().finite(),
  sweep: z
    .number()
    .finite()
    .positive()
    .lt(Math.PI * 2),
}
export const preparedPlanarCurveSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("line"),
      start: planarImportPointSchema,
      end: planarImportPointSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("cubic-bezier"),
      start: planarImportPointSchema,
      control1: planarImportPointSchema,
      control2: planarImportPointSchema,
      end: planarImportPointSchema,
    })
    .strict(),
  z.object({ type: z.literal("circle"), center: planarImportPointSchema, radius }).strict(),
  z.object({ type: z.literal("arc"), center: planarImportPointSchema, radius, ...arc }).strict(),
  z.object({ type: z.literal("ellipse"), ...conic }).strict(),
  z.object({ type: z.literal("elliptical-arc"), ...conic, ...arc }).strict(),
])
export type PreparedPlanarCurve = z.infer<typeof preparedPlanarCurveSchema>
const sourceSegmentSchema = z
  .object({
    sourceOrdinal: z.number().int().nonnegative().max(9_999),
    sourceDirection: z.union([z.literal(1), z.literal(-1)]),
    curve: preparedPlanarCurveSchema,
  })
  .strict()
const sourcePathSchema = z
  .object({
    sourceOrdinal: z.number().int().nonnegative().max(9_999),
    inspectionId: z.string().min(1).max(128),
    label: z.string().min(1).max(256).optional(),
    layer: z.string().min(1).max(256).optional(),
    closed: z.boolean(),
    segments: z.array(sourceSegmentSchema).min(1).max(1_663),
  })
  .strict()
const preparedPlanarImportDataSchema = z
  .object({
    schemaVersion: z.literal(0),
    format: z.enum(["svg", "dxf"]),
    units: z
      .object({
        coordinateUnit: z.literal("mm"),
        sourceUnit: z.string().min(1).max(64),
        millimetersPerUnit: z.number().finite().positive(),
        policy: z.enum(["declared", "selected"]),
      })
      .strict(),
    paths: z.array(sourcePathSchema).min(1).max(1_663),
  })
  .strict()
  .superRefine((prepared, context) => {
    let entityCount = 3
    let parameterCount = 7
    let constraintCount = 0
    for (const [pathIndex, path] of prepared.paths.entries()) {
      if (path.sourceOrdinal !== pathIndex)
        context.addIssue({
          code: "custom",
          message: "Prepared paths must retain their complete ordered source ordinals.",
        })
      for (const [segmentIndex, segment] of path.segments.entries()) {
        if (segment.sourceOrdinal !== segmentIndex)
          context.addIssue({
            code: "custom",
            message: "Prepared curves must retain their complete ordered source ordinals.",
          })
        const costs = nativeCurveCost(segment.curve)
        entityCount += costs.entities
        parameterCount += costs.parameters
        constraintCount += costs.constraints
        validatePreparedCurve(segment.curve, context)
      }
      validatePreparedPath(path, context)
    }
    if (
      entityCount >= PLANAR_IMPORT_NATIVE_ENTITY_LIMIT ||
      parameterCount > 10_000 ||
      constraintCount > 10_000
    )
      context.addIssue({
        code: "custom",
        message:
          "Imported curves exceed the conservative native sketch capacity before identity allocation.",
      })
  })
const unknownArray = z.custom<unknown[]>(Array.isArray, "A planar import requires an array.")
const budgetEnvelope = z.object({ paths: unknownArray }).passthrough()
const pathBudgetEnvelope = z.object({ segments: unknownArray }).passthrough()

/** Inspect collection lengths before deep validation or native/UUID work. */
export function assertPlanarImportBudget(value: unknown): void {
  const envelope = budgetEnvelope.parse(value)
  if (envelope.paths.length > 1_662)
    throw new RangeError("Imported paths exceed the conservative native sketch capacity.")
  let count = 0
  for (const path of envelope.paths) {
    count += pathBudgetEnvelope.parse(path).segments.length
    if (count > 1_662)
      throw new RangeError(
        "Imported curves exceed the conservative native sketch capacity before preparation.",
      )
  }
}

export const preparedPlanarImportSchema = z.preprocess((value, context) => {
  try {
    assertPlanarImportBudget(value)
    return value
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "The planar import budget is invalid.",
    })
    return z.NEVER
  }
}, preparedPlanarImportDataSchema)
export type PreparedPlanarImport = z.infer<typeof preparedPlanarImportSchema>

function nativeCurveCost(curve: PreparedPlanarCurve) {
  switch (curve.type) {
    case "line":
      return { entities: 3, parameters: 4, constraints: 0 }
    case "cubic-bezier":
      return { entities: 5, parameters: 8, constraints: 0 }
    case "circle":
      return { entities: 3, parameters: 3, constraints: 0 }
    case "arc":
      return { entities: 4, parameters: 6, constraints: 0 }
    case "ellipse":
      return { entities: 5, parameters: 6, constraints: 1 }
    case "elliptical-arc":
      return { entities: 15, parameters: 18, constraints: 11 }
  }
}

function distance(a: PlanarImportPoint, b: PlanarImportPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
function plus(a: PlanarImportPoint, b: PlanarImportPoint): PlanarImportPoint {
  return [a[0] + b[0], a[1] + b[1]]
}

function validatePreparedCurve(curve: PreparedPlanarCurve, context: z.RefinementCtx) {
  if (
    curve.type === "line" &&
    distance(curve.start, curve.end) <= PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM
  )
    context.addIssue({ code: "custom", message: "An imported line has negligible extent." })
  if ("center" in curve) validateConicWorld(curve, context)
  if (curve.type === "ellipse" || curve.type === "elliptical-arc") validateConicAxes(curve, context)
}

function validateConicWorld(
  curve: Exclude<PreparedPlanarCurve, { type: "line" | "cubic-bezier" }>,
  context: z.RefinementCtx,
) {
  if (
    planarImportConicExtrema(curve).some(
      (point) => !planarImportPointSchema.safeParse(point).success,
    )
  )
    context.addIssue({
      code: "custom",
      message: "A conic exceeds the finite millimeter world bounds.",
    })
  if (
    "sweep" in curve &&
    distance(
      planarImportCurvePoint(curve, curve.startAngle),
      planarImportCurvePoint(curve, curve.startAngle + curve.sweep),
    ) <= PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM
  )
    context.addIssue({
      code: "custom",
      message: "An imported arc has indistinguishable endpoints at the sketch topology tolerance.",
    })
}

function validateConicAxes(
  curve: Extract<PreparedPlanarCurve, { primaryAxis: unknown }>,
  context: z.RefinementCtx,
) {
  const first = Math.hypot(...curve.primaryAxis)
  const second = Math.hypot(...curve.secondaryAxis)
  const cosine =
    (curve.primaryAxis[0] * curve.secondaryAxis[0] +
      curve.primaryAxis[1] * curve.secondaryAxis[1]) /
    (first * second)
  if (
    Math.min(first, second) <= PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM ||
    Math.min(first, second) / Math.max(first, second) <= 1e-12 ||
    !Number.isFinite(cosine) ||
    Math.abs(cosine) > 1e-12
  )
    context.addIssue({
      code: "custom",
      message: "Prepared conics require nonzero orthogonal axes.",
    })
  for (const point of [
    plus(curve.center, curve.primaryAxis),
    plus(curve.center, curve.secondaryAxis),
  ]) {
    if (!planarImportPointSchema.safeParse(point).success)
      context.addIssue({
        code: "custom",
        message: "A conic defining point exceeds the finite millimeter world bounds.",
      })
  }
}

function sourceEndpoints(
  segment: z.infer<typeof sourceSegmentSchema>,
): [PlanarImportPoint, PlanarImportPoint] | undefined {
  const curve = segment.curve
  let points: [PlanarImportPoint, PlanarImportPoint]
  if (curve.type === "line" || curve.type === "cubic-bezier") points = [curve.start, curve.end]
  else if ("sweep" in curve)
    points = [
      planarImportCurvePoint(curve, curve.startAngle),
      planarImportCurvePoint(curve, curve.startAngle + curve.sweep),
    ]
  else return undefined
  return segment.sourceDirection === 1 ? points : [points[1], points[0]]
}

function validatePreparedPath(path: z.infer<typeof sourcePathSchema>, context: z.RefinementCtx) {
  if (
    path.segments.length === 1 &&
    (path.segments[0]?.curve.type === "circle" || path.segments[0]?.curve.type === "ellipse")
  )
    return
  const endpoints = path.segments.map(sourceEndpoints)
  if (endpoints.some((points) => !points)) {
    context.addIssue({
      code: "custom",
      message: "A full conic must retain a separate source path.",
    })
    return
  }
  const joins = path.closed ? endpoints.length : endpoints.length - 1
  for (let index = 0; index < joins; index++) {
    const first = endpoints[index]
    const second = endpoints[(index + 1) % endpoints.length]
    if (!endpointsJoin(first, second)) {
      context.addIssue({
        code: "custom",
        message: "An imported path has disconnected endpoints at the sketch topology tolerance.",
      })
      return
    }
  }
}

function endpointsJoin(
  first: [PlanarImportPoint, PlanarImportPoint] | undefined,
  second: [PlanarImportPoint, PlanarImportPoint] | undefined,
): boolean {
  return (
    first !== undefined &&
    second !== undefined &&
    distance(first[1], second[0]) <= PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM
  )
}

export function planarImportCurvePoint(
  curve: Exclude<PreparedPlanarCurve, { type: "line" | "cubic-bezier" }>,
  parameter: number,
): PlanarImportPoint {
  const primary: PlanarImportPoint = "radius" in curve ? [curve.radius, 0] : curve.primaryAxis
  const secondary: PlanarImportPoint = "radius" in curve ? [0, curve.radius] : curve.secondaryAxis
  return [
    curve.center[0] + primary[0] * Math.cos(parameter) + secondary[0] * Math.sin(parameter),
    curve.center[1] + primary[1] * Math.cos(parameter) + secondary[1] * Math.sin(parameter),
  ]
}

/** Analytical extrema include both endpoints and every included conic coordinate extremum. */
export function planarImportConicExtrema(
  curve: Exclude<PreparedPlanarCurve, { type: "line" | "cubic-bezier" }>,
): PlanarImportPoint[] {
  const turn = Math.PI * 2
  const primary: PlanarImportPoint = "radius" in curve ? [curve.radius, 0] : curve.primaryAxis
  const secondary: PlanarImportPoint = "radius" in curve ? [0, curve.radius] : curve.secondaryAxis
  const start = "startAngle" in curve ? curve.startAngle : 0
  const sweep = "sweep" in curve ? curve.sweep : turn
  const angles = [start, start + sweep]
  for (const axis of [0, 1] as const) {
    const extremum = Math.atan2(secondary[axis], primary[axis])
    for (const angle of [extremum, extremum + Math.PI]) {
      const delta = (((angle - start) % turn) + turn) % turn
      if (delta <= sweep + 1e-12) angles.push(angle)
    }
  }
  return angles.map((angle) => planarImportCurvePoint(curve, angle))
}

type PathCapture = {
  sourcePathOrdinal: number
  inspectionId: string
  label?: string
  layer?: string
  closed: boolean
  pointIds: SketchEntityId[]
  curves: {
    sourceCurveOrdinal: number
    curveId: SketchEntityId
    pointIds: SketchEntityId[]
    sourceDirection: 1 | -1
  }[]
}
export type PlanarImportAuthoring = {
  sketch: SketchRecord
  paths: PathCapture[]
  createdEntityIds: SketchEntityId[]
}
type CurveFields<T = Exclude<SketchEntity, { type: "point" }>> = T extends unknown
  ? Omit<T, "schemaVersion" | "id" | "construction">
  : never

class PathEntityBuilder {
  readonly entities: SketchEntity[] = []
  private readonly junctions: { point: PlanarImportPoint; id: SketchEntityId }[] = []
  constructor(private readonly allocate: () => SketchEntityId) {}

  private point(
    point: PlanarImportPoint,
    junction = false,
    exclude: readonly SketchEntityId[] = [],
  ): SketchEntityId {
    if (junction) {
      const candidates = this.junctions.filter(
        (entry) =>
          distance(entry.point, point) <= PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM &&
          !exclude.includes(entry.id),
      )
      if (candidates.length > 1)
        throw new RangeError("An imported endpoint has ambiguous nearby authored junctions.")
      if (candidates[0]) return candidates[0].id
    }
    const id = this.allocate()
    this.entities.push({
      schemaVersion: 0,
      id,
      type: "point",
      x: point[0],
      y: point[1],
      construction: false,
    })
    if (
      junction &&
      !this.junctions.some(
        (entry) => distance(entry.point, point) <= PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM,
      )
    )
      this.junctions.push({ point, id })
    return id
  }

  private append(curve: CurveFields): SketchEntityId {
    const id = this.allocate()
    this.entities.push({ schemaVersion: 0, id, construction: false, ...curve })
    return id
  }

  create(curve: PreparedPlanarCurve): { curveId: SketchEntityId; pointIds: SketchEntityId[] } {
    if (curve.type === "line") {
      const startPointId = this.point(curve.start, true)
      const endPointId = this.point(curve.end, true)
      return {
        curveId: this.append({ type: "line", startPointId, endPointId }),
        pointIds: [startPointId, endPointId],
      }
    }
    if (curve.type === "cubic-bezier") {
      const startPointId = this.point(curve.start, true)
      const control1PointId = this.point(curve.control1)
      const control2PointId = this.point(curve.control2)
      const endPointId = this.point(curve.end, true, [startPointId])
      return {
        curveId: this.append({
          type: "cubic-bezier",
          startPointId,
          control1PointId,
          control2PointId,
          endPointId,
        }),
        pointIds: [startPointId, control1PointId, control2PointId, endPointId],
      }
    }
    return this.createConic(curve)
  }

  private createConic(curve: Exclude<PreparedPlanarCurve, { type: "line" | "cubic-bezier" }>) {
    const centerPointId = this.point(curve.center)
    if (curve.type === "circle")
      return {
        curveId: this.append({ type: "circle", centerPointId, radius: curve.radius }),
        pointIds: [centerPointId],
      }
    if (curve.type === "arc") {
      const startPointId = this.point(planarImportCurvePoint(curve, curve.startAngle), true)
      const endPointId = this.point(
        planarImportCurvePoint(curve, curve.startAngle + curve.sweep),
        true,
      )
      if (startPointId === endPointId)
        throw new RangeError(
          "An imported arc has indistinguishable endpoints at the sketch topology tolerance.",
        )
      return {
        curveId: this.append({ type: "arc", centerPointId, startPointId, endPointId }),
        pointIds: [centerPointId, startPointId, endPointId],
      }
    }
    const primaryAxisPointId = this.point(plus(curve.center, curve.primaryAxis))
    const secondaryAxisPointId = this.point(plus(curve.center, curve.secondaryAxis))
    const pointIds = [centerPointId, primaryAxisPointId, secondaryAxisPointId]
    if (curve.type === "ellipse")
      return {
        curveId: this.append({
          type: "ellipse",
          centerPointId,
          primaryAxisPointId,
          secondaryAxisPointId,
        }),
        pointIds,
      }
    const startPointId = this.point(planarImportCurvePoint(curve, curve.startAngle), true)
    const endPointId = this.point(
      planarImportCurvePoint(curve, curve.startAngle + curve.sweep),
      true,
    )
    if (startPointId === endPointId)
      throw new RangeError(
        "An imported elliptical arc has indistinguishable endpoints at the sketch topology tolerance.",
      )
    return {
      curveId: this.append({
        type: "elliptical-arc",
        centerPointId,
        primaryAxisPointId,
        secondaryAxisPointId,
        startPointId,
        endPointId,
      }),
      pointIds: [...pointIds, startPointId, endPointId],
    }
  }
}

/** The caller captures these allocated identities in its ordinary sketch/source command. */
export function authorPreparedPlanarImport(
  value: unknown,
  input: {
    id: SketchId
    label: string
    plane: SketchRecord["plane"]
    createEntityId: () => SketchEntityId
  },
): PlanarImportAuthoring {
  const prepared = preparedPlanarImportSchema.parse(value)
  const empty = createEmptySketch(input)
  const used = new Set<string>()
  const allocate = () => {
    const id = sketchEntityIdSchema.parse(input.createEntityId())
    if (used.has(id))
      throw new RangeError("Imported sketch identity allocation produced a duplicate UUID.")
    used.add(id)
    return id
  }
  const entities: SketchEntity[] = []
  const paths = prepared.paths.map((path): PathCapture => {
    const builder = new PathEntityBuilder(allocate)
    const curves = path.segments.map((segment) => ({
      sourceCurveOrdinal: segment.sourceOrdinal,
      sourceDirection: segment.sourceDirection,
      ...builder.create(segment.curve),
    }))
    entities.push(...builder.entities)
    return {
      sourcePathOrdinal: path.sourceOrdinal,
      inspectionId: path.inspectionId,
      ...(path.label ? { label: path.label } : {}),
      ...(path.layer ? { layer: path.layer } : {}),
      closed: path.closed,
      curves,
      pointIds: builder.entities
        .filter((entity) => entity.type === "point")
        .map((entity) => entity.id),
    }
  })
  return {
    sketch: sketchRecordSchema.parse({ ...empty, entities }),
    paths,
    createdEntityIds: entities.map((entity) => entity.id),
  }
}
