import {
  type FdmFeatureContentParameters,
  fdmFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import {
  assembleWire,
  type Edge,
  type Face,
  makeFace,
  makeLine,
  makeThreePointArc,
  type Shape3D,
} from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { placeOcctShape } from "./occt-placement"
import { createOcctBox, createOcctCylinder } from "./occt-shapes"

type Point = [number, number, number]
type Point2 = readonly [number, number]
type Frame = {
  origin: readonly number[]
  xAxis: readonly number[]
  yAxis: readonly number[]
  normal: readonly number[]
}
type Own = <T extends Shape3D>(shape: T) => T
function dot(a: readonly number[], b: readonly number[]) {
  return a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0)
}
function add(a: readonly number[], b: readonly number[], scale = 1): Point {
  return [
    (a[0] ?? 0) + (b[0] ?? 0) * scale,
    (a[1] ?? 0) + (b[1] ?? 0) * scale,
    (a[2] ?? 0) + (b[2] ?? 0) * scale,
  ]
}
function subtract(a: readonly number[], b: readonly number[]): Point {
  return add(a, b, -1)
}
function world(frame: Frame, x: number, y: number, z = 0): Point {
  return add(add(add(frame.origin, frame.xAxis, x), frame.yAxis, y), frame.normal, z)
}

function extrudeEdges(occt: OpenCascadeInstance, edges: readonly Edge[], vector: Point): Shape3D {
  let wire: ReturnType<typeof assembleWire> | undefined
  let face: ReturnType<typeof makeFace> | undefined
  try {
    wire = assembleWire([...edges])
    face = makeFace(wire)
    const direction = new occt.gp_Vec_4(...vector)
    try {
      const builder = new occt.BRepPrimAPI_MakePrism_1(face.wrapped, direction, true, true)
      try {
        return adoptOcctShape(builder.Shape(), castOcctShape)
      } finally {
        builder.delete()
      }
    } finally {
      direction.delete()
    }
  } finally {
    face?.delete()
    wire?.delete()
    for (const edge of edges) edge.delete()
  }
}
function polygonPrism(occt: OpenCascadeInstance, vertices: readonly Point[], vector: Point) {
  const edges: Edge[] = []
  try {
    for (const [i, first] of vertices.entries()) {
      const second = vertices[(i + 1) % vertices.length]
      if (!second) throw new Error("FDM profile is incomplete.")
      edges.push(makeLine(first, second))
    }
  } catch (error) {
    for (const edge of edges) edge.delete()
    throw error
  }
  return extrudeEdges(occt, edges, vector)
}
function boolean(occt: OpenCascadeInstance, source: Shape3D, tool: Shape3D, mode: "cut" | "fuse") {
  const resources: { delete(): void }[] = []
  const ownNative = <T extends { delete(): void }>(value: T) => {
    resources.push(value)
    return value
  }
  let output: Shape3D | undefined, failure: { error: unknown } | undefined
  try {
    const args = ownNative(new occt.TopTools_ListOfShape_1()),
      tools = ownNative(new occt.TopTools_ListOfShape_1())
    const progress = ownNative(new occt.Message_ProgressRange_1())
    const builder = ownNative(
      mode === "cut" ? new occt.BRepAlgoAPI_Cut_1() : new occt.BRepAlgoAPI_Fuse_1(),
    )
    args.Append_1(source.wrapped).delete()
    tools.Append_1(tool.wrapped).delete()
    builder.SetNonDestructive(true)
    builder.SetToFillHistory(false)
    builder.SetArguments(args)
    builder.SetTools(tools)
    builder.Build(progress)
    if (!builder.IsDone()) throw new Error("FDM exact Boolean did not complete.")
    builder.SimplifyResult(true, true, 1e-8)
    output = adoptOcctShape(builder.Shape(), castOcctShape)
  } catch (error) {
    failure = { error }
  }
  return releaseFdmOutput(resources, output, failure)
}
function localPlacement(
  occt: OpenCascadeInstance,
  source: Shape3D,
  p: Exclude<FdmFeatureContentParameters, { kind: "web" }>,
) {
  return placeOcctShape(occt, source, {
    translation: [p.origin.x, p.origin.y, p.origin.z],
    rotation:
      p.axis === "X" ? [0, Math.PI / 2, 0] : p.axis === "Y" ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
  })
}
function regularPolygon(radius: number, count: number): Point[] {
  return Array.from({ length: count }, (_, i) => [
    radius * Math.cos((i * 2 * Math.PI) / count),
    radius * Math.sin((i * 2 * Math.PI) / count),
    0,
  ])
}
function rotatedBox(
  occt: OpenCascadeInstance,
  dimensions: Point,
  center: Point,
  phase: number,
  own: Own,
) {
  const box = own(createOcctBox(occt, dimensions, false, center))
  return own(placeOcctShape(occt, box, { translation: [0, 0, 0], rotation: [0, 0, phase] }))
}
function teardropTool(
  occt: OpenCascadeInstance,
  p: Extract<FdmFeatureContentParameters, { kind: "teardrop-hole" }>,
) {
  const r = p.diameter / 2,
    alpha = p.roofAngle
  const right: Point = [r * Math.sin(alpha), r * Math.cos(alpha), 0]
  const left: Point = [-right[0], right[1], 0]
  const apex = r / Math.cos(alpha)
  const topX = (apex - r) / Math.tan(alpha)
  const top: Point[] = p.flatTop
    ? [
        [-topX, r, 0],
        [topX, r, 0],
      ]
    : [[0, apex, 0]]
  const edges: Edge[] = []
  try {
    edges.push(makeThreePointArc(right, [0, -r, 0], left))
    let previous = left
    for (const point of [...top, right]) {
      edges.push(makeLine(previous, point))
      previous = point
    }
  } catch (error) {
    for (const edge of edges) edge.delete()
    throw error
  }
  return extrudeEdges(occt, edges, [0, 0, p.depth])
}

type Primitive = Exclude<FdmFeatureContentParameters, { kind: "web" }>
type Tools = { additions: Shape3D[]; cuts: Shape3D[]; independent?: Shape3D }
type Factory = {
  occt: OpenCascadeInstance
  own: Own
  cylinder: (radius: number, height: number, center?: Point) => Shape3D
  box: (dimensions: Point, center?: Point) => Shape3D
}
function hexSeatTools(f: Factory, p: Extract<Primitive, { kind: "hex-seat" }>): Tools {
  const radius = p.acrossFlats / Math.sqrt(3)
  const cuts = [f.own(polygonPrism(f.occt, regularPolygon(radius, 6), [0, 0, p.depth]))]
  for (let i = 0; i < 6; i++)
    cuts.push(
      rotatedBox(
        f.occt,
        [p.compliance + p.slotWidth, p.slotWidth, p.depth],
        [radius + (p.compliance - p.slotWidth) / 2, 0, 0],
        (i * Math.PI) / 3,
        f.own,
      ),
    )
  return { cuts, additions: [] }
}
function crushRibTools(f: Factory, p: Extract<Primitive, { kind: "crush-ribs" }>): Tools {
  const additions: Shape3D[] = []
  for (let i = 0; i < p.count; i++)
    additions.push(
      rotatedBox(
        f.occt,
        [p.ribHeight * 2, p.ribWidth, p.depth],
        [p.holeDiameter / 2, 0, 0],
        (i * 2 * Math.PI) / p.count,
        f.own,
      ),
    )
  return { additions, cuts: [] }
}
function sleeveTools(f: Factory, p: Extract<Primitive, { kind: "flexible-sleeve" }>): Tools {
  const outer = f.cylinder(p.outerDiameter / 2, p.length)
  const inner = f.cylinder(p.innerDiameter / 2, p.length + 2e-4, [0, 0, -1e-4])
  let sleeve = f.own(boolean(f.occt, outer, inner, "cut"))
  for (let i = 0; i < p.count; i++) {
    const slot = rotatedBox(
      f.occt,
      [p.outerDiameter, p.slotWidth, p.slotLength + 1e-4],
      [p.outerDiameter / 2, 0, p.length - p.slotLength],
      (i * 2 * Math.PI) / p.count,
      f.own,
    )
    sleeve = f.own(boolean(f.occt, sleeve, slot, "cut"))
  }
  return { additions: [], cuts: [], independent: sleeve }
}
function insertTools(f: Factory, p: Extract<Primitive, { kind: "insert-pocket" }>): Tools {
  const additions =
    p.bossDiameter && p.bossHeight ? [f.cylinder(p.bossDiameter / 2, p.bossHeight)] : []
  return { additions, cuts: [f.cylinder(p.diameter / 2 + p.clearance, p.depth)] }
}
function enclosureTools(f: Factory, p: Extract<Primitive, { kind: "enclosure-joint" }>): Tools {
  const clearance = p.mode === "groove" ? p.clearance : 0
  const outer = f.box([p.width + 2 * clearance, p.length + 2 * clearance, p.height])
  const inner = f.box(
    [p.width - 2 * (p.wall + clearance), p.length - 2 * (p.wall + clearance), p.height + 2e-4],
    [0, 0, -1e-4],
  )
  const ring = f.own(boolean(f.occt, outer, inner, "cut"))
  return p.mode === "lip" ? { additions: [ring], cuts: [] } : { additions: [], cuts: [ring] }
}
function membraneTools(f: Factory, p: Extract<Primitive, { kind: "membrane" }>): Tools {
  if (p.mode === "sheet") return { additions: [f.box([p.width, p.length, p.thickness])], cuts: [] }
  if (!p.bridgeCount || !p.bridgeWidth) throw new Error("Bridge dimensions are missing.")
  const additions: Shape3D[] = [],
    spacing = p.width / p.bridgeCount
  for (let i = 0; i < p.bridgeCount; i++)
    additions.push(
      f.box([p.bridgeWidth, p.length, p.thickness], [(i + 0.5) * spacing - p.width / 2, 0, 0]),
    )
  return { additions, cuts: [] }
}
function couponTools(f: Factory, p: Extract<Primitive, { kind: "calibration-coupon" }>): Tools {
  const largest = p.diameterStart + (p.holeCount - 1) * p.diameterStep
  let coupon = f.box([
    (p.holeCount - 1) * p.spacing + largest + 2 * p.margin,
    largest + 2 * p.margin,
    p.thickness,
  ])
  for (let i = 0; i < p.holeCount; i++)
    coupon = f.own(
      boolean(
        f.occt,
        coupon,
        f.cylinder((p.diameterStart + i * p.diameterStep) / 2, p.thickness + 2e-4, [
          (i - (p.holeCount - 1) / 2) * p.spacing,
          0,
          -1e-4,
        ]),
        "cut",
      ),
    )
  return { additions: [], cuts: [], independent: coupon }
}
function basicCutTools(f: Factory, p: Primitive): Tools {
  let cutter: Shape3D
  switch (p.kind) {
    case "corner-relief":
      cutter = f.cylinder(p.radius, p.depth)
      break
    case "seam-groove":
      cutter = f.own(
        polygonPrism(
          f.occt,
          [
            [-p.length / 2, -p.width / 2, 0],
            [-p.length / 2, p.width / 2, 0],
            [-p.length / 2, 0, p.depth],
          ],
          [p.length, 0, 0],
        ),
      )
      break
    case "teardrop-hole":
      cutter = f.own(teardropTool(f.occt, p))
      break
    case "nut-pocket":
      cutter = f.own(
        polygonPrism(f.occt, regularPolygon((p.acrossFlats + 2 * p.clearance) / Math.sqrt(3), 6), [
          0,
          0,
          p.depth,
        ]),
      )
      break
    default:
      throw new Error("Unsupported basic FDM cutter.")
  }
  return { cuts: [cutter], additions: [] }
}
function primitiveTools(occt: OpenCascadeInstance, p: Primitive, own: Own): Tools {
  const f: Factory = {
    occt,
    own,
    cylinder: (radius, height, center = [0, 0, 0]) =>
      own(createOcctCylinder(occt, radius, height, center)),
    box: (dimensions, center = [0, 0, 0]) => own(createOcctBox(occt, dimensions, false, center)),
  }
  switch (p.kind) {
    case "hex-seat":
      return hexSeatTools(f, p)
    case "crush-ribs":
      return crushRibTools(f, p)
    case "flexible-sleeve":
      return sleeveTools(f, p)
    case "insert-pocket":
      return insertTools(f, p)
    case "enclosure-joint":
      return enclosureTools(f, p)
    case "membrane":
      return membraneTools(f, p)
    case "calibration-coupon":
      return couponTools(f, p)
    default:
      return basicCutTools(f, p)
  }
}

type PlanarRectangle = {
  origin: Point
  normal: Point
  first: Point
  second: Point
  width: number
  height: number
}
function straightFaceCorners(face: Face): Point[] | null {
  const edges = face.edges
  try {
    if (edges.length !== 4 || edges.some((edge) => edge.geomType !== "LINE")) return null
    const points = edges.flatMap((edge) => {
      const start = edge.startPoint,
        end = edge.endPoint
      try {
        return [start.toTuple(), end.toTuple()]
      } finally {
        start.delete()
        end.delete()
      }
    })
    const corners: Point[] = []
    for (const point of points)
      if (!corners.some((other) => Math.hypot(...subtract(point, other)) < 1e-7))
        corners.push(point)
    return corners
  } finally {
    for (const edge of edges) edge.delete()
  }
}
function rectangularAxes(corners: readonly Point[]) {
  const origin = corners[0]
  if (!origin || corners.length !== 4) return null
  const vectors = corners
    .slice(1)
    .map((point) => subtract(point, origin))
    .sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  const a = vectors[0],
    b = vectors[1],
    diagonal = vectors[2]
  if (!a || !b || !diagonal) return null
  const width = Math.hypot(...a),
    height = Math.hypot(...b)
  if (
    Math.abs(dot(a, b)) > 1e-7 * width * height ||
    Math.hypot(...subtract(add(a, b), diagonal)) > 1e-6
  )
    return null
  return {
    origin,
    first: a.map((v) => v / width) as Point,
    second: b.map((v) => v / height) as Point,
    width,
    height,
  }
}
function planarRectangle(face: Face): PlanarRectangle | null {
  if (face.geomType !== "PLANE") return null
  const corners = straightFaceCorners(face)
  const axes = corners ? rectangularAxes(corners) : null
  if (!axes) return null
  const normal = face.normalAt()
  try {
    return { ...axes, normal: normal.toTuple() }
  } finally {
    normal.delete()
  }
}
function withinRectangle(point: Point, rectangle: PlanarRectangle) {
  const relative = subtract(point, rectangle.origin),
    x = dot(relative, rectangle.first),
    y = dot(relative, rectangle.second)
  return x >= -1e-6 && x <= rectangle.width + 1e-6 && y >= -1e-6 && y <= rectangle.height + 1e-6
}
function coveredWallDistance(
  rectangle: PlanarRectangle,
  origin: Point,
  ray: Point,
  frame: Frame,
  direction: Point2,
  halfThickness: number,
  depth: number,
) {
  const projection = dot(rectangle.normal, ray)
  if (Math.abs(projection) < 1e-8) return null
  const distance = dot(rectangle.normal, subtract(rectangle.origin, origin)) / projection
  if (distance < -1e-6 || distance > 1000) return null
  const center = add(origin, ray, Math.max(0, distance))
  const side = subtract(world(frame, -direction[1], direction[0]), world(frame, 0, 0))
  const corners = [-1, 1].flatMap((sign) => [
    add(add(center, side, sign * halfThickness), frame.normal, -depth / 2),
    add(add(center, side, sign * halfThickness), frame.normal, depth / 2),
  ])
  // The supported face is an exact convex rectangle; all four corners prove coverage.
  return corners.every((point) => withinRectangle(point, rectangle)) ? Math.max(0, distance) : null
}
function wallExtension(
  source: Shape3D,
  frame: Frame,
  endpoint: Point2,
  direction: Point2,
  halfThickness: number,
  depth: number,
) {
  const origin = world(frame, endpoint[0], endpoint[1], depth / 2)
  const ray = subtract(world(frame, direction[0], direction[1]), world(frame, 0, 0))
  const faces = source.faces
  const hits: number[] = []
  try {
    if (faces.some((face) => face.geomType !== "PLANE"))
      throw new Error("Automatic Web extension supports planar prismatic cavities only.")
    for (const face of faces) {
      const normal = face.normalAt()
      let vertical: boolean
      try {
        vertical = Math.abs(dot(normal.toTuple(), frame.normal)) <= 1e-8
      } finally {
        normal.delete()
      }
      if (!vertical) continue
      const rectangle = planarRectangle(face)
      if (!rectangle)
        throw new Error("Automatic Web extension requires rectangular cavity wall faces.")
      const distance = coveredWallDistance(
        rectangle,
        origin,
        ray,
        frame,
        direction,
        halfThickness,
        depth,
      )
      if (distance !== null) hits.push(distance)
    }
  } finally {
    for (const face of faces) face.delete()
  }
  if (!hits.length)
    throw new Error(
      "Automatic Web extension requires finite rectangular planar walls covering the complete Web height and thickness.",
    )
  return Math.min(...hits) + 1e-5
}
function webTools(
  occt: OpenCascadeInstance,
  p: Extract<FdmFeatureContentParameters, { kind: "web" }>,
  source: Shape3D,
  own: Own,
) {
  const depth = p.depth * (p.direction === "reverse" ? -1 : 1)
  return p.segments.map((segment) => {
    let start = segment.start,
      end = segment.end
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    const ux = (end[0] - start[0]) / length,
      uy = (end[1] - start[1]) / length
    if (p.extendToWalls) {
      const first = wallExtension(source, p.frame, start, [-ux, -uy], p.thickness / 2, depth)
      const last = wallExtension(source, p.frame, end, [ux, uy], p.thickness / 2, depth)
      start = [start[0] - ux * first, start[1] - uy * first]
      end = [end[0] + ux * last, end[1] + uy * last]
    }
    if (p.style === "rib")
      return own(
        polygonPrism(
          occt,
          [
            world(p.frame, start[0], start[1], -p.thickness / 2),
            world(p.frame, end[0], end[1], -p.thickness / 2),
            world(p.frame, end[0] - uy * depth, end[1] + ux * depth, -p.thickness / 2),
          ],
          p.frame.normal.map((value) => value * p.thickness) as Point,
        ),
      )
    const dx = (-uy * p.thickness) / 2,
      dy = (ux * p.thickness) / 2
    return own(
      polygonPrism(
        occt,
        [
          world(p.frame, start[0] + dx, start[1] + dy),
          world(p.frame, end[0] + dx, end[1] + dy),
          world(p.frame, end[0] - dx, end[1] - dy),
          world(p.frame, start[0] - dx, start[1] - dy),
        ],
        p.frame.normal.map((value) => value * depth) as Point,
      ),
    )
  })
}

function requireSingleBody(occt: OpenCascadeInstance, shape: Shape3D) {
  const metrics = inspectOcctBody(occt, shape)
  if (!metrics.valid || metrics.solidCount !== 1 || metrics.volume <= 0)
    throw new Error("FDM geometry must remain one valid connected positive-volume solid.")
}
function applyMaterial(
  occt: OpenCascadeInstance,
  current: Shape3D | undefined,
  tool: Shape3D,
  mode: "cut" | "fuse",
  own: Own,
) {
  if (!current) throw new Error("This FDM operation requires an exact target body.")
  const before = inspectOcctBody(occt, current).volume
  const next = own(boolean(occt, current, tool, mode))
  const after = inspectOcctBody(occt, next),
    tolerance = Math.max(1e-8, before * 1e-10)
  const changed =
    mode === "cut" ? after.volume < before - tolerance : after.volume > before + tolerance
  if (!after.valid || after.volume <= 0 || !changed)
    throw new Error(`FDM ${mode} does not affect material or creates invalid geometry.`)
  return next
}
function createPrimitiveFeature(
  occt: OpenCascadeInstance,
  p: Primitive,
  source: Shape3D | undefined,
  current: Shape3D | undefined,
  own: Own,
) {
  const tools = primitiveTools(occt, p, own)
  if (tools.independent) {
    const placed = own(localPlacement(occt, tools.independent, p))
    current = source ? applyMaterial(occt, current, placed, "fuse", own) : placed
  }
  for (const tool of tools.additions)
    current = applyMaterial(occt, current, own(localPlacement(occt, tool, p)), "fuse", own)
  for (const tool of tools.cuts)
    current = applyMaterial(occt, current, own(localPlacement(occt, tool, p)), "cut", own)
  return current
}
function evaluateFdmShape(
  occt: OpenCascadeInstance,
  p: FdmFeatureContentParameters,
  source: Shape3D | undefined,
  own: Own,
) {
  if (source) requireSingleBody(occt, source)
  let current = source
    ? own(placeOcctShape(occt, source, { translation: [0, 0, 0], rotation: [0, 0, 0] }))
    : undefined
  if (p.kind === "web") {
    if (!source) throw new Error("Web requires an exact target body.")
    for (const tool of webTools(occt, p, source, own))
      current = applyMaterial(occt, current, tool, "fuse", own)
  } else current = createPrimitiveFeature(occt, p, source, current, own)
  if (!current) throw new Error("The FDM feature produced no body.")
  requireSingleBody(occt, current)
  return current
}
function disposeFdmShapes(shapes: readonly { delete(): void }[], retained?: Shape3D) {
  const failures: unknown[] = []
  for (const shape of [...shapes].reverse()) {
    if (shape === retained) continue
    try {
      shape.delete()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}
function releaseFdmOutput(
  owned: readonly { delete(): void }[],
  output: Shape3D | undefined,
  failure: { error: unknown } | undefined,
) {
  const failures = disposeFdmShapes(owned, output)
  if (failure || failures.length) {
    if (output) failures.push(...disposeFdmShapes([output]))
    if (failures.length)
      throw new AggregateError(
        [...(failure ? [failure.error] : []), ...failures],
        "FDM geometry cleanup failed.",
      )
    throw failure?.error
  }
  if (!output) throw new Error("The FDM result is unavailable.")
  return output
}
/** One exact body or no result; cached target geometry is copied before any Boolean. */
export function createOcctFdmFeature(
  occt: OpenCascadeInstance,
  input: FdmFeatureContentParameters,
  source?: Shape3D,
): Shape3D {
  const p = fdmFeatureContentParametersSchema.parse(input)
  const owned: Shape3D[] = []
  const own: Own = (shape) => {
    if (shape === source || owned.includes(shape))
      throw new Error("FDM shapes require separate ownership.")
    owned.push(shape)
    return shape
  }
  let output: Shape3D | undefined, failure: { error: unknown } | undefined
  try {
    output = evaluateFdmShape(occt, p, source, own)
  } catch (error) {
    failure = { error }
  }
  return releaseFdmOutput(owned, output, failure)
}
