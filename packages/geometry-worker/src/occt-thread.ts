import { type ThreadGeometryParameters, threadGeometryParametersSchema } from "@vibeshape/protocol"
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
function grooveOverrun(parameters: ThreadGeometryParameters) {
  const pad = Math.max(0.001, parameters.pitch * 0.001)
  return (parameters.depth + pad) / Math.sqrt(3) + pad
}
function createGroove(
  occt: OpenCascadeInstance,
  parameters: ThreadGeometryParameters,
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
  parameters: ThreadGeometryParameters,
  inverse = false,
): Shape3D {
  return transformedShape(occt, shape, (transform) => {
    const [x, y, z] = parameters.origin
    if (parameters.axis === "custom") {
      const normal = parameters.direction
      const a = threadPhaseDirection(normal)
      const b: Point = [
        normal[1] * a[2] - normal[2] * a[1],
        normal[2] * a[0] - normal[0] * a[2],
        normal[0] * a[1] - normal[1] * a[0],
      ]
      if (inverse)
        transform.SetValues(
          a[0],
          a[1],
          a[2],
          -(a[0] * x + a[1] * y + a[2] * z),
          b[0],
          b[1],
          b[2],
          -(b[0] * x + b[1] * y + b[2] * z),
          normal[0],
          normal[1],
          normal[2],
          -(normal[0] * x + normal[1] * y + normal[2] * z),
        )
      else
        transform.SetValues(
          a[0],
          b[0],
          normal[0],
          x,
          a[1],
          b[1],
          normal[1],
          y,
          a[2],
          b[2],
          normal[2],
          z,
        )
    } else if (inverse) {
      if (parameters.axis === "X") transform.SetValues(0, 1, 0, -y, 0, 0, 1, -z, 1, 0, 0, -x)
      else if (parameters.axis === "Y") transform.SetValues(0, 0, 1, -z, 1, 0, 0, -x, 0, 1, 0, -y)
      else transform.SetValues(1, 0, 0, -x, 0, 1, 0, -y, 0, 0, 1, -z)
    } else if (parameters.axis === "X") transform.SetValues(0, 0, 1, x, 1, 0, 0, y, 0, 1, 0, z)
    else if (parameters.axis === "Y") transform.SetValues(0, 1, 0, x, 0, 0, 1, y, 1, 0, 0, z)
    else transform.SetValues(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z)
  })
}
function threadPhaseDirection(normal: readonly [number, number, number]): Point {
  // The cyclic projected seed preserves the legacy X:+Y, Y:+Z, Z:+X phase convention.
  const seed: Point =
    Math.abs(normal[0]) >= 0.8 ? [0, 1, 0] : Math.abs(normal[1]) >= 0.8 ? [0, 0, 1] : [1, 0, 0]
  const projection = seed.reduce((sum, value, index) => sum + value * (normal[index] ?? 0), 0)
  const radial = seed.map((value, index) => value - projection * (normal[index] ?? 0)) as Point
  const norm = Math.hypot(...radial)
  return radial.map((value) => value / norm) as Point
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
function validateThreadEnvelope(parameters: ThreadGeometryParameters) {
  const radius =
    parameters.nominalDiameter / 2 +
    (parameters.kind === "external"
      ? -parameters.clearance
      : parameters.clearance + parameters.depth)
  const min = parameters.origin.map((coordinate) => coordinate - radius) as Point
  const max = parameters.origin.map((coordinate) => coordinate + radius) as Point
  if (parameters.axis === "custom") {
    for (const component of [0, 1, 2] as const) {
      const first = parameters.direction[component] * parameters.runIn
      const last = parameters.direction[component] * (parameters.length - parameters.runOut)
      min[component] += Math.min(first, last)
      max[component] += Math.max(first, last)
    }
  } else {
    const axis = parameters.axis === "X" ? 0 : parameters.axis === "Y" ? 1 : 2
    min[axis] = parameters.origin[axis] + parameters.runIn
    max[axis] = parameters.origin[axis] + parameters.length - parameters.runOut
  }
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
  parameters: ThreadGeometryParameters,
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
  copy: (
    occt: OpenCascadeInstance,
    source: Shape3D,
    parameters: ThreadGeometryParameters,
  ) => Shape3D
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
  parameters: ThreadGeometryParameters,
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
  grooves?: readonly Shape3D[] | undefined
  verifyResidual?: boolean
}
function cutThreadBand(
  occt: OpenCascadeInstance,
  parameters: ThreadGeometryParameters,
  band: ThreadBandContext,
  operations: ThreadOperations,
  own: Own,
): Shape3D {
  const cutters: Shape3D[] = []
  let individual: Shape3D | undefined
  for (let index = 0; index < parameters.starts; index += 1) {
    const groove = band.grooves?.[index] ?? own(operations.groove(occt, parameters, index))
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
  for (const groove of band.verifyResidual === false ? [] : cutters) {
    const residual = own(operations.boolean(occt, threaded, groove, "common"))
    validateGrooveRemoval(operations.inspect(occt, residual), band.baselineVolume)
  }
  return threaded
}
type ThreadSourceBandContext = {
  working: ThreadGeometryParameters
  workingBounds: Bounds
  sourceBand: Shape3D
  cleared: Shape3D
  allowance: Shape3D
  tolerance: number
}
function threadSegmentParameters(working: ThreadGeometryParameters, start: number, stop: number) {
  return {
    ...working,
    runIn: start,
    runOut: working.length - stop,
    // Keep a continuous helix at the shared cap plane.
    phase:
      working.phase +
      ((working.handedness === "right" ? 1 : -1) * 2 * Math.PI * (start - working.runIn)) /
        (working.pitch * working.starts),
  }
}
function threadSourceSegment(
  occt: OpenCascadeInstance,
  interval: { start: number; stop: number; single: boolean },
  context: ThreadSourceBandContext,
  operations: ThreadOperations,
  own: Own,
) {
  const source = interval.single
    ? context.sourceBand
    : own(
        operations.boolean(
          occt,
          context.sourceBand,
          own(operations.band(occt, context.workingBounds, interval.start, interval.stop)),
          "common",
        ),
      )
  validateBand(operations.inspect(occt, source))
  const cleared = interval.single
    ? context.cleared
    : own(operations.boolean(occt, source, context.allowance, "cut"))
  const metrics = operations.inspect(occt, cleared)
  validateBand(metrics)
  return {
    source,
    baselineVolume: metrics.volume,
    tolerance: interval.single ? context.tolerance : operations.tolerance(occt, source),
  }
}
function threadSourceBands(
  occt: OpenCascadeInstance,
  parameters: ThreadGeometryParameters,
  context: ThreadSourceBandContext,
  operations: ThreadOperations,
  own: Own,
) {
  const { working } = context
  const segmentCount =
    parameters.axis === "custom"
      ? Math.ceil(
          (parameters.length - parameters.runIn - parameters.runOut) / (16 * parameters.pitch),
        )
      : 1
  // Share one exact bounded swept surface: separate pipe approximations can leave a step at the interface.
  const grooves =
    segmentCount > 1 && parameters.starts === 1
      ? [own(operations.groove(occt, working, 0))]
      : undefined
  const threadedBands: Shape3D[] = []
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const start = parameters.runIn + segment * 16 * parameters.pitch
    const stop = Math.min(parameters.length - parameters.runOut, start + 16 * parameters.pitch)
    const segmentParameters =
      segmentCount === 1 ? working : threadSegmentParameters(working, start, stop)
    const band = threadSourceSegment(
      occt,
      { start, stop, single: segmentCount === 1 },
      context,
      operations,
      own,
    )
    threadedBands.push(
      cutThreadBand(
        occt,
        segmentParameters,
        {
          ...band,
          allowance: context.allowance,
          grooves,
          // Single-start v2 retains its same exact owned CUT; coincidence Common adds no independent proof.
          verifyResidual: parameters.axis !== "custom" || parameters.starts !== 1,
        },
        operations,
        own,
      ),
    )
  }
  return threadedBands.length === 1 ? threadedBands[0] : own(operations.fuse(occt, threadedBands))
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
      input: ThreadGeometryParameters,
    ): Shape3D {
      const parameters = threadGeometryParametersSchema.parse(input)
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
        const working: ThreadGeometryParameters = { ...parameters, axis: "Z", origin: [0, 0, 0] }
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
        const threaded = threadSourceBands(
          occt,
          parameters,
          {
            working,
            workingBounds,
            sourceBand,
            cleared,
            allowance,
            tolerance,
          },
          operations,
          own,
        )
        if (!threaded) throw new Error("Thread restoration requires a threaded band.")
        validateSolid(operations.inspect(occt, threaded))
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
