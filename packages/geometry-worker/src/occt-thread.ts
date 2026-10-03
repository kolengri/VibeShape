import { type ThreadContentParameters, threadContentParametersSchema } from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { gp_Trsf, OpenCascadeInstance, TopoDS_Wire } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { createOcctBox, createOcctCylinder } from "./occt-shapes"

type Deletable = { delete(): void }
type Point = [number, number, number]
type Bounds = { min: Point; max: Point }
type Metrics = { valid: boolean; solidCount: number; volume: number }
type Own = <T extends Deletable>(resource: T) => T

function release(resources: readonly Deletable[]): unknown[] {
  const failures: unknown[] = []
  for (const resource of [...new Set(resources)].reverse()) {
    try {
      resource.delete()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}
/** Transfers a result only after all acquired temporary wrappers were released successfully. */
function nativeResult<T extends Deletable>(build: (own: Own) => T): T {
  const owned: Deletable[] = []
  const own: Own = (resource) => {
    owned.push(resource)
    return resource
  }
  let result: T
  try {
    result = build(own)
  } catch (error) {
    const failures = release(owned)
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        "Thread failed while releasing native resources.",
      )
    throw error
  }
  const failures = release(owned.filter((resource) => resource !== result))
  if (failures.length) {
    const resultFailures = release([result])
    throw new AggregateError(
      [...failures, ...resultFailures],
      "Thread could not release every temporary native resource.",
    )
  }
  return result
}

function createHelix(
  occt: OpenCascadeInstance,
  radius: number,
  phase: number,
  start: number,
  stop: number,
  lead: number,
  sign: number,
): TopoDS_Wire {
  return nativeResult((own) => {
    const axis = own(new occt.gp_Ax3_1())
    const cylinder = own(new occt.gp_Cylinder_2(axis, radius))
    const faceBuilder = own(
      new occt.BRepBuilderAPI_MakeFace_10(cylinder, 0, 2 * Math.PI, start, stop),
    )
    const face = own(faceBuilder.Face())
    const surface = own(occt.BRep_Tool.Surface_2(face))
    const first = own(new occt.gp_Pnt2d_3(phase, start))
    const last = own(
      new occt.gp_Pnt2d_3(phase + (sign * 2 * Math.PI * (stop - start)) / lead, stop),
    )
    const segment = own(new occt.GCE2d_MakeSegment_1(first, last))
    const trimmed = own(segment.Value())
    // get() is borrowed; the new handle retains it, so only handles are released.
    const curve = own(new occt.Handle_Geom2d_Curve_2(trimmed.get()))
    const edgeBuilder = own(new occt.BRepBuilderAPI_MakeEdge_30(curve, surface))
    const edge = own(edgeBuilder.Edge())
    const wireBuilder = own(new occt.BRepBuilderAPI_MakeWire_2(edge))
    const wire = own(wireBuilder.Wire())
    if (!occt.BRepLib.BuildCurves3d_2(wire))
      throw new Error("OCCT could not construct the thread helix in 3D.")
    return wire
  })
}
function createTriangle(
  occt: OpenCascadeInstance,
  radius: number,
  depth: number,
  phase: number,
  start: number,
  external: boolean,
  pad: number,
): TopoDS_Wire {
  return nativeResult((own) => {
    const sign = external ? -1 : 1
    const tipRadius = radius + sign * depth
    const baseRadius = radius - sign * pad
    const halfWidth = (depth + pad) / Math.sqrt(3)
    const point = (r: number, z: number) =>
      own(new occt.gp_Pnt_3(r * Math.cos(phase), r * Math.sin(phase), z))
    const points = [
      point(tipRadius, start),
      point(baseRadius, start - halfWidth),
      point(baseRadius, start + halfWidth),
    ] as const
    const builder = own(new occt.BRepBuilderAPI_MakeWire_1())
    for (const [first, last] of [
      [points[0], points[1]],
      [points[1], points[2]],
      [points[2], points[0]],
    ] as const) {
      const edgeBuilder = own(new occt.BRepBuilderAPI_MakeEdge_3(first, last))
      builder.Add_1(own(edgeBuilder.Edge()))
    }
    if (!builder.IsDone()) throw new Error("OCCT could not construct the thread groove profile.")
    return own(builder.Wire())
  })
}
function grooveOverrun(parameters: ThreadContentParameters) {
  const pad = Math.max(0.001, parameters.pitch * 0.001)
  return (parameters.depth + pad) / Math.sqrt(3) + pad
}
function createGroove(
  occt: OpenCascadeInstance,
  parameters: ThreadContentParameters,
  index: number,
): Shape3D {
  return nativeResult((own) => {
    const radius =
      parameters.nominalDiameter / 2 +
      (parameters.kind === "external" ? -parameters.clearance : parameters.clearance)
    const pad = Math.max(0.001, parameters.pitch * 0.001)
    if (radius <= pad)
      throw new Error("Thread radius is too small for a non-self-intersecting groove cutter.")
    // Keep end profiles strictly beyond the clip planes; tangent caps destabilize native Booleans.
    const overrun = grooveOverrun(parameters)
    const start = parameters.runIn - overrun
    const stop = parameters.length - parameters.runOut + overrun
    const lead = parameters.pitch * parameters.starts
    const sign = parameters.handedness === "right" ? 1 : -1
    // Keep the swept PCurve in one canonical periodic frame; apply authored phase by rigid rotation.
    const startPhase = -(sign * 2 * Math.PI * overrun) / lead
    const spine = own(createHelix(occt, radius, startPhase, start, stop, lead, sign))
    const profile = own(
      createTriangle(
        occt,
        radius,
        parameters.depth,
        startPhase,
        start,
        parameters.kind === "external",
        pad,
      ),
    )
    const builder = own(new occt.BRepOffsetAPI_MakePipeShell(spine))
    builder.SetTolerance(1e-6, 1e-6, 1e-5)
    builder.SetMode_1(true)
    builder.Add_1(profile, false, false)
    const progress = own(new occt.Message_ProgressRange_1())
    builder.Build(progress)
    if (!builder.IsDone() || !builder.MakeSolid())
      throw new Error("OCCT could not construct a solid helical groove cutter.")
    const groove = own(adoptOcctShape(builder.Shape(), castOcctShape))
    const angle = parameters.phase + (2 * Math.PI * index) / parameters.starts
    return own(
      transformedShape(occt, groove, (transform) => {
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        transform.SetValues(cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1, 0)
      }),
    )
  })
}
function nativeBoolean(
  occt: OpenCascadeInstance,
  source: Shape3D,
  operands: readonly Shape3D[],
  kind: "cut" | "common" | "fuse",
): Shape3D {
  return nativeResult((own) => {
    const progress = own(new occt.Message_ProgressRange_1())
    const argumentsList = own(new occt.TopTools_ListOfShape_1())
    own(argumentsList.Append_1(source.wrapped))
    const tools = own(new occt.TopTools_ListOfShape_1())
    for (const tool of operands) own(tools.Append_1(tool.wrapped))
    const Builder =
      kind === "cut"
        ? occt.BRepAlgoAPI_Cut_1
        : kind === "common"
          ? occt.BRepAlgoAPI_Common_1
          : occt.BRepAlgoAPI_Fuse_1
    // Operand-taking constructors build before flags can be set and may mutate their operands.
    const builder = own(new Builder())
    builder.SetArguments(argumentsList)
    builder.SetTools(tools)
    // Boolean operands remain owned and reusable until the complete operation succeeds.
    builder.SetNonDestructive(true)
    builder.SetToFillHistory(false)
    builder.Build(progress)
    if (!builder.IsDone()) throw new Error("OCCT thread Boolean operation did not complete.")
    return own(adoptOcctShape(builder.Shape(), castOcctShape))
  })
}
function booleanShape(
  occt: OpenCascadeInstance,
  source: Shape3D,
  tool: Shape3D,
  kind: "cut" | "common",
): Shape3D {
  return nativeBoolean(occt, source, [tool], kind)
}
function fuseBodies(occt: OpenCascadeInstance, bodies: readonly Shape3D[]): Shape3D {
  const [first, ...remaining] = bodies
  if (!first) throw new Error("Thread restoration requires at least one body.")
  return nativeBoolean(occt, first, remaining, "fuse")
}
function transformedShape(
  occt: OpenCascadeInstance,
  shape: Shape3D,
  configure: (transform: gp_Trsf) => void,
): Shape3D {
  return nativeResult((own) => {
    const transform = own(new occt.gp_Trsf_1())
    configure(transform)
    const builder = own(new occt.BRepBuilderAPI_Transform_2(shape.wrapped, transform, true))
    if (!builder.IsDone()) throw new Error("OCCT thread tool placement did not complete.")
    return own(adoptOcctShape(builder.Shape(), castOcctShape))
  })
}
function orientTool(
  occt: OpenCascadeInstance,
  shape: Shape3D,
  parameters: ThreadContentParameters,
  inverse = false,
): Shape3D {
  return transformedShape(occt, shape, (transform) => {
    const [x, y, z] = parameters.origin
    if (inverse) {
      if (parameters.axis === "X") transform.SetValues(0, 1, 0, -y, 0, 0, 1, -z, 1, 0, 0, -x)
      else if (parameters.axis === "Y") transform.SetValues(0, 0, 1, -z, 1, 0, 0, -x, 0, 1, 0, -y)
      else transform.SetValues(1, 0, 0, -x, 0, 1, 0, -y, 0, 0, 1, -z)
    } else if (parameters.axis === "X") transform.SetValues(0, 0, 1, x, 1, 0, 0, y, 0, 1, 0, z)
    else if (parameters.axis === "Y") transform.SetValues(0, 1, 0, x, 0, 0, 1, y, 1, 0, 0, z)
    else transform.SetValues(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z)
  })
}
function bounds(occt: OpenCascadeInstance, shape: Shape3D): Bounds {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    if (box.IsVoid() || box.IsOpen()) throw new Error("Thread body bounds are not finite.")
    const values = [
      { current: 0 },
      { current: 0 },
      { current: 0 },
      { current: 0 },
      { current: 0 },
      { current: 0 },
    ] as const
    Reflect.apply(box.Get, box, values)
    return {
      min: [values[0].current, values[1].current, values[2].current],
      max: [values[3].current, values[4].current, values[5].current],
    }
  } finally {
    box.delete()
  }
}
function validateSolid(metrics: Metrics) {
  if (
    !metrics.valid ||
    metrics.solidCount !== 1 ||
    !Number.isFinite(metrics.volume) ||
    metrics.volume <= 0
  )
    throw new Error("Modeled thread requires one valid positive-volume solid.")
}
function validatePartition(metrics: Metrics) {
  if (
    !metrics.valid ||
    !Number.isFinite(metrics.volume) ||
    metrics.volume < 0 ||
    metrics.solidCount < 0 ||
    (metrics.solidCount === 0 ? metrics.volume !== 0 : metrics.volume <= 0)
  )
    throw new Error("Thread partitions must contain valid finite-volume solids.")
}
function validateBand(metrics: Metrics) {
  validatePartition(metrics)
  if (metrics.solidCount === 0)
    throw new Error("Thread does not intersect target material inside the authored band.")
}
function validateHelicalRemoval(result: Metrics, baselineVolume: number, tolerance: number) {
  validatePartition(result)
  if (baselineVolume - result.volume <= tolerance)
    throw new Error(
      "A helical thread start does not remove effective material from the target body.",
    )
}
function volumeTolerance(occt: OpenCascadeInstance, shape: Shape3D): number {
  const properties = new occt.GProp_GProps_1()
  try {
    occt.BRepGProp.SurfaceProperties_1(shape.wrapped, properties, false, false)
    // Independent Boolean boundaries can differ by one linear confusion on either result.
    const tolerance = 2 * occt.Precision.Confusion() * properties.Mass()
    if (!Number.isFinite(tolerance) || tolerance <= 0)
      throw new Error("Thread could not establish a finite native material tolerance.")
    return tolerance
  } finally {
    properties.delete()
  }
}
function validateGrooveRemoval(residual: Metrics, bandVolume: number) {
  validatePartition(residual)
  if (residual.volume > bandVolume * 1e-10)
    throw new Error("OCCT thread retains material inside an intended helical groove.")
}
function validateBounds(value: Bounds) {
  if (
    ![...value.min, ...value.max].every(
      (coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) <= 100_000,
    )
  )
    throw new Error("Modeled thread exceeds the 100,000 mm workspace.")
}
function validateThreadEnvelope(parameters: ThreadContentParameters) {
  const radius =
    parameters.nominalDiameter / 2 +
    (parameters.kind === "external"
      ? -parameters.clearance
      : parameters.clearance + parameters.depth)
  const min = parameters.origin.map((coordinate) => coordinate - radius) as Point
  const max = parameters.origin.map((coordinate) => coordinate + radius) as Point
  const axis = parameters.axis === "X" ? 0 : parameters.axis === "Y" ? 1 : 2
  min[axis] = parameters.origin[axis] + parameters.runIn
  max[axis] = parameters.origin[axis] + parameters.length - parameters.runOut
  validateBounds({ min, max })
}
function createBandSlab(
  occt: OpenCascadeInstance,
  sourceBounds: Bounds,
  start: number,
  stop: number,
): Shape3D {
  // Cover the entire radial source extent, including protrusions outside the nominal thread radius.
  const min: Point = [sourceBounds.min[0] - 1e-5, sourceBounds.min[1] - 1e-5, start]
  const max: Point = [sourceBounds.max[0] + 1e-5, sourceBounds.max[1] + 1e-5, stop]
  const dimensions = max.map((value, component) => value - (min[component] ?? 0)) as Point
  const center = min.map((value, component) => value + (dimensions[component] ?? 0) / 2) as Point
  return createOcctBox(occt, dimensions, true, center)
}
function externalAllowanceTool(
  occt: OpenCascadeInstance,
  parameters: ThreadContentParameters,
  sourceBounds: Bounds,
): Shape3D {
  return nativeResult((own) => {
    // One pitch exceeds both swept profile overruns under the authored depth bound.
    const start = parameters.runIn - parameters.pitch
    const stop = parameters.length - parameters.runOut + parameters.pitch
    const slab = own(createBandSlab(occt, sourceBounds, start, stop))
    const inner = own(
      createOcctCylinder(
        occt,
        parameters.nominalDiameter / 2 - parameters.clearance,
        stop - start,
        [0, 0, start],
      ),
    )
    const placed = own(orientTool(occt, inner, parameters))
    return own(booleanShape(occt, slab, placed, "cut"))
  })
}
type ThreadOperations = {
  copy: (occt: OpenCascadeInstance, source: Shape3D, parameters: ThreadContentParameters) => Shape3D
  groove: typeof createGroove
  boolean: typeof booleanShape
  cut: (occt: OpenCascadeInstance, source: Shape3D, tools: readonly Shape3D[]) => Shape3D
  fuse: typeof fuseBodies
  band: typeof createBandSlab
  tolerance: typeof volumeTolerance
  place: typeof orientTool
  allowance: typeof externalAllowanceTool
  cylinder: typeof createOcctCylinder
  inspect: typeof inspectOcctBody
  bounds: typeof bounds
}
function independentThreadCopy(
  occt: OpenCascadeInstance,
  source: Shape3D,
  parameters: ThreadContentParameters,
  operations: ThreadOperations,
  own: Own,
): Shape3D {
  const copied = operations.copy(occt, source, parameters)
  if (copied === source) throw new Error("Thread must own an independent source copy.")
  const body = own(copied)
  if (body.wrapped.IsPartner(source.wrapped))
    throw new Error("Thread must own an independent source copy.")
  return body
}
type ThreadBandContext = {
  source: Shape3D
  allowance: Shape3D
  baselineVolume: number
  tolerance: number
}
function cutThreadBand(
  occt: OpenCascadeInstance,
  parameters: ThreadContentParameters,
  band: ThreadBandContext,
  operations: ThreadOperations,
  own: Own,
): Shape3D {
  const cutters: Shape3D[] = []
  let individual: Shape3D | undefined
  for (let index = 0; index < parameters.starts; index += 1) {
    const groove = own(operations.groove(occt, parameters, index))
    validateSolid(operations.inspect(occt, groove))
    validateBounds(operations.bounds(occt, groove))
    // Reuse original band topology: a previously cleared cylindrical face can misclassify a start.
    individual = own(operations.cut(occt, band.source, [band.allowance, groove]))
    validateHelicalRemoval(
      operations.inspect(occt, individual),
      band.baselineVolume,
      band.tolerance,
    )
    cutters.push(groove)
  }
  // A single start already has exactly the final operands; retain that owned result instead of recutting.
  const threaded =
    parameters.starts === 1 && individual
      ? individual
      : own(operations.cut(occt, band.source, [band.allowance, ...cutters]))
  const metrics = operations.inspect(occt, threaded)
  validateBand(metrics)
  if (metrics.volume >= band.baselineVolume - band.tolerance)
    throw new Error("Thread does not intersect the target body or remove effective material.")
  for (const groove of cutters) {
    const residual = own(operations.boolean(occt, threaded, groove, "common"))
    validateGrooveRemoval(operations.inspect(occt, residual), band.baselineVolume)
  }
  return threaded
}
export function createOcctThreadOperations(overrides: Partial<ThreadOperations> = {}) {
  const operations: ThreadOperations = {
    copy: (occt, source, parameters) => orientTool(occt, source, parameters, true),
    groove: createGroove,
    boolean: booleanShape,
    cut: (occt, source, tools) => nativeBoolean(occt, source, tools, "cut"),
    fuse: fuseBodies,
    band: createBandSlab,
    tolerance: volumeTolerance,
    place: orientTool,
    allowance: externalAllowanceTool,
    cylinder: createOcctCylinder,
    inspect: inspectOcctBody,
    bounds,
    ...overrides,
  }
  return {
    threadShape(
      occt: OpenCascadeInstance,
      source: Shape3D,
      input: ThreadContentParameters,
    ): Shape3D {
      const parameters = threadContentParametersSchema.parse(input)
      validateThreadEnvelope(parameters)
      const sourceBounds = operations.bounds(occt, source)
      validateBounds(sourceBounds)
      const sourceMetrics = operations.inspect(occt, source)
      validateSolid(sourceMetrics)
      return nativeResult((register) => {
        const own: Own = (resource) => {
          if (Object.is(resource, source))
            throw new Error("Thread must not acquire ownership of its cached source.")
          return register(resource)
        }
        const body = independentThreadCopy(occt, source, parameters, operations, own)
        // Boolean operations use one canonical local frame; only the final owned copy returns to world.
        const working: ThreadContentParameters = { ...parameters, axis: "Z", origin: [0, 0, 0] }
        const workingBounds = operations.bounds(occt, body)
        const toolStart = parameters.runIn - parameters.pitch
        const toolLength = parameters.length - parameters.runOut + parameters.pitch - toolStart
        const radius =
          parameters.nominalDiameter / 2 +
          (parameters.kind === "external" ? -parameters.clearance : parameters.clearance)
        const clip = own(
          operations.band(
            occt,
            workingBounds,
            parameters.runIn,
            parameters.length - parameters.runOut,
          ),
        )
        const sourceBand = own(operations.boolean(occt, body, clip, "common"))
        const sourceBandMetrics = operations.inspect(occt, sourceBand)
        validateBand(sourceBandMetrics)
        const tolerance = operations.tolerance(occt, sourceBand)
        const outside = own(operations.boolean(occt, body, clip, "cut"))
        const outsideMetrics = operations.inspect(occt, outside)
        validatePartition(outsideMetrics)
        const allowance =
          parameters.kind === "external"
            ? own(operations.allowance(occt, working, workingBounds))
            : own(
                operations.place(
                  occt,
                  own(operations.cylinder(occt, radius, toolLength, [0, 0, toolStart])),
                  working,
                ),
              )
        const cleared = own(operations.boolean(occt, sourceBand, allowance, "cut"))
        const bandMetrics = operations.inspect(occt, cleared)
        validateBand(bandMetrics)
        if (bandMetrics.volume > sourceBandMetrics.volume + tolerance)
          throw new Error("Thread clearance increased target material volume.")
        // Clip the source, not the tools: coincident cutter caps can lose a start in native Booleans.
        const threaded = cutThreadBand(
          occt,
          working,
          { source: sourceBand, allowance, baselineVolume: bandMetrics.volume, tolerance },
          operations,
          own,
        )
        // Outside may contain several solids; restore every part without selecting or discarding any.
        const result =
          outsideMetrics.solidCount === 0
            ? threaded
            : own(operations.fuse(occt, [outside, threaded]))
        validateSolid(operations.inspect(occt, result))
        const world = own(operations.place(occt, result, parameters))
        validateSolid(operations.inspect(occt, world))
        validateBounds(operations.bounds(occt, world))
        return world
      })
    },
  }
}
export const { threadShape: threadOcctShape } = createOcctThreadOperations()
