import {
  DRAWING_ANGULAR_TOLERANCE_RAD,
  DRAWING_CHORD_TOLERANCE_MM,
  DRAWING_VIEW_FRAMES,
  type DrawingBounds,
  type DrawingCurve,
  type DrawingEdge,
  type DrawingViewId,
  type DrawingViewProjection,
  MAX_DRAWING_CURVE_POINTS,
  MAX_DRAWING_VIEW_EDGES,
} from "@vibeshape/protocol"
import type {
  BRepAdaptor_Curve,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { straightenPolyline, suppressCoincidentEdges } from "./drawing-edge-cleanup"
import { nativeScope, type OwnNative } from "./occt-native-scope"

const LABEL = "Drawing projection"
const FULL_TURN = 2 * Math.PI
const ANGLE_EPSILON = 1e-9
type Point = [number, number]
type HlrToShape = InstanceType<OpenCascadeInstance["HLRBRep_HLRToShape"]>
type Extraction = Readonly<{
  visibility: DrawingEdge["visibility"]
  edgeClass: DrawingEdge["edgeClass"]
  extract: (shapes: HlrToShape) => TopoDS_Shape
}>

/** Sewn (RgN) and isoparametric HLR lines are not drawing edges and are never extracted. */
const EXTRACTIONS: readonly Extraction[] = [
  { visibility: "visible", edgeClass: "sharp", extract: (shapes) => shapes.VCompound_1() },
  { visibility: "visible", edgeClass: "smooth", extract: (shapes) => shapes.Rg1LineVCompound_1() },
  { visibility: "visible", edgeClass: "outline", extract: (shapes) => shapes.OutLineVCompound_1() },
  { visibility: "hidden", edgeClass: "sharp", extract: (shapes) => shapes.HCompound_1() },
  { visibility: "hidden", edgeClass: "smooth", extract: (shapes) => shapes.Rg1LineHCompound_1() },
  { visibility: "hidden", edgeClass: "outline", extract: (shapes) => shapes.OutLineHCompound_1() },
]

/**
 * Exact hidden-line removal of one native shape for each requested orthographic or isometric view.
 * Every temporary wrapper is released on success and failure; the source shape stays owned by the
 * caller. Output contains only coordinates, never transient OCCT topology indices.
 */
export function projectOcctDrawingViews(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  views: readonly DrawingViewId[],
): DrawingViewProjection[] {
  return views.map((view) => projectView(occt, shape, view))
}

function projectView(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  view: DrawingViewId,
): DrawingViewProjection {
  const edges = nativeScope(LABEL, (own) => {
    const frame = DRAWING_VIEW_FRAMES[view]
    const axes = own(
      new occt.gp_Ax2_2(
        own(new occt.gp_Pnt_3(0, 0, 0)),
        own(new occt.gp_Dir_4(...frame.normal)),
        own(new occt.gp_Dir_4(...frame.xAxis)),
      ),
    )
    const projector = own(new occt.HLRAlgo_Projector_2(axes))
    const algorithm = new occt.HLRBRep_Algo_1()
    // The handle takes intrusive ownership; deleting the raw algorithm wrapper would double free.
    const handle = own(new occt.Handle_HLRBRep_Algo_2(algorithm))
    algorithm.Add_2(shape, 0)
    algorithm.Projector_1(projector)
    algorithm.Update()
    algorithm.Hide_1()
    const shapes = own(new occt.HLRBRep_HLRToShape(handle))
    const result: DrawingEdge[] = []
    for (const extraction of EXTRACTIONS) {
      const compound = own(extraction.extract(shapes))
      if (compound.IsNull()) continue
      occt.BRepLib.BuildCurves3d_2(compound)
      collectEdges(occt, own, compound, extraction, result)
    }
    return result
  })
  const cleaned = suppressCoincidentEdges(edges)
  return { view, bounds: edgeBounds(cleaned), edges: cleaned }
}

function collectEdges(
  occt: OpenCascadeInstance,
  own: OwnNative,
  compound: TopoDS_Shape,
  extraction: Extraction,
  result: DrawingEdge[],
) {
  const explorer = own(
    new occt.TopExp_Explorer_2(
      compound,
      occt.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
      occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
    ),
  )
  for (; explorer.More(); explorer.Next()) {
    const curve = nativeScope(LABEL, (edgeOwn) => {
      const edge = edgeOwn(occt.TopoDS.Edge_1(edgeOwn(explorer.Current())))
      return projectedCurve(occt, edgeOwn, edgeOwn(new occt.BRepAdaptor_Curve_2(edge)))
    })
    if (!curve) continue
    if (result.length >= MAX_DRAWING_VIEW_EDGES)
      throw new RangeError("The drawing view exceeds its projected edge budget.")
    result.push({ visibility: extraction.visibility, edgeClass: extraction.edgeClass, curve })
  }
}

function pointAt(own: OwnNative, curve: BRepAdaptor_Curve, parameter: number): Point {
  const point = own(curve.Value(parameter))
  const value: Point = [point.X(), point.Y()]
  if (!value.every(Number.isFinite)) throw new Error("A projected drawing point is not finite.")
  return value
}

function projectedCurve(
  occt: OpenCascadeInstance,
  own: OwnNative,
  curve: BRepAdaptor_Curve,
): DrawingCurve | null {
  const first = curve.FirstParameter()
  const last = curve.LastParameter()
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null
  const type = curve.GetType()
  if (type === occt.GeomAbs_CurveType.GeomAbs_Line) {
    const start = pointAt(own, curve, first)
    const end = pointAt(own, curve, last)
    return Math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-9
      ? { kind: "line", start, end }
      : null
  }
  if (type === occt.GeomAbs_CurveType.GeomAbs_Circle) return circularCurve(own, curve, first, last)
  return polylineCurve(occt, own, curve)
}

function circularCurve(
  own: OwnNative,
  curve: BRepAdaptor_Curve,
  first: number,
  last: number,
): DrawingCurve {
  const circle = own(curve.Circle())
  const location = own(circle.Location())
  const direction = own(own(circle.Axis()).Direction())
  const center: Point = [location.X(), location.Y()]
  const radius = circle.Radius()
  if (last - first >= FULL_TURN - ANGLE_EPSILON) return { kind: "circle", center, radius }
  const angleOf = (point: Point) => Math.atan2(point[1] - center[1], point[0] - center[0])
  let startAngle = angleOf(pointAt(own, curve, first))
  let endAngle = angleOf(pointAt(own, curve, last))
  // A circle whose axis faces away from the viewer runs clockwise in sheet coordinates.
  if (direction.Z() < 0) [startAngle, endAngle] = [endAngle, startAngle]
  while (endAngle <= startAngle) endAngle += FULL_TURN
  return { kind: "arc", center, radius, startAngle, endAngle }
}

function polylineCurve(
  occt: OpenCascadeInstance,
  own: OwnNative,
  curve: BRepAdaptor_Curve,
): DrawingCurve | null {
  const sampler = own(
    new occt.GCPnts_TangentialDeflection_2(
      curve,
      DRAWING_ANGULAR_TOLERANCE_RAD,
      DRAWING_CHORD_TOLERANCE_MM,
      2,
      1e-9,
      1e-7,
    ),
  )
  const count = sampler.NbPoints()
  if (count < 2) return null
  const stride = Math.max(1, Math.ceil((count - 1) / (MAX_DRAWING_CURVE_POINTS - 1)))
  const points: Point[] = []
  for (let index = 1; index <= count; index += stride) {
    const point = own(sampler.Value(index))
    points.push([point.X(), point.Y()])
  }
  if ((count - 1) % stride !== 0) {
    const point = own(sampler.Value(count))
    points.push([point.X(), point.Y()])
  }
  if (!points.flat().every(Number.isFinite))
    throw new Error("A projected drawing point is not finite.")
  return straightenPolyline(points)
}

/** Tight sheet-plane extents of exact lines, circles and arcs, and of sampled polylines. */
function edgeBounds(edges: readonly DrawingEdge[]): DrawingBounds {
  const min: Point = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max: Point = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const include = (point: readonly [number, number]) => {
    min[0] = Math.min(min[0], point[0])
    min[1] = Math.min(min[1], point[1])
    max[0] = Math.max(max[0], point[0])
    max[1] = Math.max(max[1], point[1])
  }
  for (const { curve } of edges) curvePoints(curve).forEach(include)
  if (!Number.isFinite(min[0])) return { min: [0, 0], max: [0, 0] }
  return { min, max }
}

function curvePoints(curve: DrawingCurve): (readonly [number, number])[] {
  if (curve.kind === "line") return [curve.start, curve.end]
  if (curve.kind === "polyline") return curve.points
  const at = (angle: number): Point => [
    curve.center[0] + curve.radius * Math.cos(angle),
    curve.center[1] + curve.radius * Math.sin(angle),
  ]
  if (curve.kind === "circle") return [0, 1, 2, 3].map((quarter) => at((quarter * Math.PI) / 2))
  const points = [at(curve.startAngle), at(curve.endAngle)]
  const firstQuarter = Math.ceil(curve.startAngle / (Math.PI / 2))
  for (let quarter = firstQuarter; (quarter * Math.PI) / 2 < curve.endAngle; quarter += 1)
    points.push(at((quarter * Math.PI) / 2))
  return points
}
