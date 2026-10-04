import { Edge, Face, makePolygon, type Shape3D, type SimplePoint } from "replicad"
import type { GeomAbs_Shape, OpenCascadeInstance, TopAbs_ShapeEnum } from "replicad-opencascadejs"
import { REPLICAD_OPENCASCADE_VERSION } from "./build-info"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import {
  type AnalyticalProfile,
  createAnalyticalEdge,
  createAnalyticalFace,
  validateOcctProfileSolid,
} from "./occt-loft"
import { requireLoftEdgeResiduals } from "./occt-loft-residuals"
import type { AnalyticalSweepPath } from "./occt-sweep"

type Owned = { delete(): void }
type Own = <T extends Owned>(binding: T) => T
export type LoftOuterTrack = Readonly<{
  sectionEntityIds: readonly string[]
  sectionStartPointIds: readonly string[]
}>
export type LoftRail = Readonly<{ vertexTrack: number; path: AnalyticalSweepPath }>
export type LoftGuide = Readonly<{ name: string; segmentTrack: number; path: AnalyticalSweepPath }>
export type LoftEndSupport = Readonly<{
  segmentTrack: number
  continuity: "G1" | "G2"
  support: Face
}>
export type LoftPatchNetwork = Readonly<{
  sections: readonly AnalyticalProfile[]
  outerCorrespondence: readonly LoftOuterTrack[]
  rails: readonly LoftRail[]
  guides: readonly LoftGuide[]
  start: readonly LoftEndSupport[]
  end: readonly LoftEndSupport[]
}>
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("A validated Loft correspondence entry is unavailable.")
  return value
}
const DISTANCE_TOLERANCE = 1e-7
const ANGLE_TOLERANCE = 1e-5
const CURVATURE_TOLERANCE = 1e-4
function nativeOrder(occt: OpenCascadeInstance, order: "G1" | "G2"): GeomAbs_Shape {
  if (order === "G1") return occt.GeomAbs_Shape.GeomAbs_G1 as GeomAbs_Shape
  // Pinned 0.23.0 BRepFill forwards this enum to GeomPlate's integer derivative order (0..2).
  // OCCT V7_9_2/src/BRepFill/BRepFill_Filling.cxx AddConstraints and BRepFill_CurveConstraint.cxx.
  if (
    REPLICAD_OPENCASCADE_VERSION !== "0.23.0" ||
    Reflect.get(occt.GeomAbs_Shape.GeomAbs_G2, "value") !== 3 ||
    Reflect.get(occt.GeomAbs_Shape.GeomAbs_C1, "value") !== 2
  )
    throw new Error("The pinned OCCT filling curvature-order mapping is unavailable.")
  return occt.GeomAbs_Shape.GeomAbs_C1 as GeomAbs_Shape
}
function point(frame: AnalyticalProfile["frame"], p: readonly [number, number]): SimplePoint {
  return frame.origin.map(
    (c, i) => c + (frame.xAxis[i] ?? 0) * p[0] + (frame.yAxis[i] ?? 0) * p[1],
  ) as SimplePoint
}
function requireNear(a: readonly number[], b: readonly number[], message: string) {
  if (Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) > 1e-6) throw new Error(message)
}
function directedSections(network: LoftPatchNetwork) {
  if (
    network.sections.length < 2 ||
    network.sections.length > 24 ||
    network.outerCorrespondence.length < 3 ||
    network.outerCorrespondence.length > 64
  )
    throw new Error("Loft patch networks require 2–24 sections and 3–64 matched outer segments.")
  if (
    network.outerCorrespondence.some(
      (track) =>
        track.sectionEntityIds.length !== network.sections.length ||
        track.sectionStartPointIds.length !== network.sections.length,
    )
  )
    throw new Error("Loft correspondence must cover exactly every ordered section.")
  return network.sections.map((section, column) => {
    if (
      section.holes.length ||
      section.outer.segments.length !== network.outerCorrespondence.length
    )
      throw new Error("Loft patch networks require matching hole-free outer topology.")
    const segments = network.outerCorrespondence.map((track) => {
      const segment = section.outer.segments.find(
        ({ entityId }) => entityId === track.sectionEntityIds[column],
      )
      const start = track.sectionStartPointIds[column]
      if (!segment || segment.type === "circle" || segment.type === "ellipse")
        throw new Error("A matched Loft segment is missing or closed.")
      if (segment.startPointId === start)
        return { segment, reverse: false, start: segment.start, end: segment.end }
      if (segment.endPointId === start)
        return { segment, reverse: true, start: segment.end, end: segment.start }
      throw new Error("Loft correspondence vertex does not belong to its segment.")
    })
    if (new Set(segments.map(({ segment }) => segment.entityId)).size !== segments.length)
      throw new Error("Loft correspondence repeats an outer segment.")
    for (const [i, current] of segments.entries())
      requireNear(
        current.end,
        required(segments[(i + 1) % segments.length]).start,
        "Loft correspondence does not form a directed closed boundary.",
      )
    return { section, segments }
  })
}
function nativeLine(occt: OpenCascadeInstance, a: SimplePoint, b: SimplePoint, own: Own): Edge {
  const builder = own(
    new occt.BRepBuilderAPI_MakeEdge_3(own(new occt.gp_Pnt_3(...a)), own(new occt.gp_Pnt_3(...b))),
  )
  if (!builder.IsDone()) throw new Error("A Loft rail did not complete.")
  return own(new Edge(builder.Edge()))
}
function pathEdges(occt: OpenCascadeInstance, path: AnalyticalSweepPath, own: Own) {
  return path.segments.map((segment) => own(createAnalyticalEdge(occt, path.frame, segment, false)))
}
function rails(
  occt: OpenCascadeInstance,
  network: LoftPatchNetwork,
  directed: ReturnType<typeof directedSections>,
  own: Own,
) {
  const first = required(directed[0]),
    last = required(directed.at(-1))
  if (new Set(network.rails.map(({ vertexTrack }) => vertexTrack)).size !== network.rails.length)
    throw new Error("Loft rail tracks must be unique.")
  return network.outerCorrespondence.map((_, index) => {
    const start = point(first.section.frame, required(first.segments[index]).start),
      end = point(last.section.frame, required(last.segments[index]).start)
    const rail = network.rails.find(({ vertexTrack }) => vertexTrack === index)
    if (!rail) return [nativeLine(occt, start, end, own)]
    const head = rail.path.segments[0],
      tail = rail.path.segments.at(-1)
    if (!head || !tail) throw new Error("A Loft rail path is empty.")
    requireNear(
      point(rail.path.frame, head.start),
      start,
      "A Loft rail does not begin at its matched vertex.",
    )
    requireNear(
      point(rail.path.frame, tail.end),
      end,
      "A Loft rail does not end at its matched vertex.",
    )
    return pathEdges(occt, rail.path, own)
  })
}
function copiedSupport(occt: OpenCascadeInstance, face: Face, own: Own) {
  const transform = own(new occt.gp_Trsf_1()),
    builder = own(new occt.BRepBuilderAPI_Transform_2(face.wrapped, transform, true))
  if (!builder.IsDone()) throw new Error("A Loft end support copy did not complete.")
  const raw = own(builder.Shape())
  return own(new Face(occt.TopoDS.Face_1(raw)))
}
function linearMeasure(occt: OpenCascadeInstance, edge: Owned & { wrapped: Edge["wrapped"] }) {
  const properties = new occt.GProp_GProps_1()
  try {
    occt.BRepGProp.LinearProperties(edge.wrapped, properties, false, false)
    return properties.Mass()
  } finally {
    properties.delete()
  }
}
function onSupportEdge(occt: OpenCascadeInstance, edge: Edge, support: Face, own: Own) {
  const progress = own(new occt.Message_ProgressRange_1()),
    common = own(new occt.BRepAlgoAPI_Common_3(edge.wrapped, support.wrapped, progress))
  common.Build(progress)
  if (!common.IsDone()) throw new Error("Loft end support intersection did not complete.")
  const shared = own(common.Shape()),
    properties = own(new occt.GProp_GProps_1())
  occt.BRepGProp.LinearProperties(shared, properties, false, false)
  if (Math.abs(properties.Mass() - linearMeasure(occt, edge)) > 1e-6)
    throw new Error("A Loft end edge does not lie on its support face.")
  if (support.geomType === "PLANE") {
    occt.BRepLib.BuildPCurveForEdgeOnPlane_1(edge.wrapped, support.wrapped)
    return edge
  }
  // Curved supports require an existing full native boundary edge with its stored pcurve.
  const candidates = support.edges
  for (const candidate of candidates) own(candidate)
  const matches = candidates.filter((candidate) => {
    const test = own(new occt.BRepAlgoAPI_Common_3(edge.wrapped, candidate.wrapped, progress))
    test.Build(progress)
    if (!test.IsDone()) return false
    const raw = own(test.Shape())
    occt.BRepGProp.LinearProperties(raw, properties, false, false)
    return (
      Math.abs(properties.Mass() - linearMeasure(occt, edge)) < 1e-6 &&
      Math.abs(linearMeasure(occt, candidate) - linearMeasure(occt, edge)) < 1e-6
    )
  })
  if (matches.length !== 1)
    throw new Error("A Loft end edge has no unique existing support pcurve.")
  return required(matches[0])
}
function requireResiduals(
  builder: InstanceType<OpenCascadeInstance["BRepOffsetAPI_MakeFilling"]>,
  g1: boolean,
  g2: boolean,
) {
  if (!builder.IsDone()) throw new Error("OCCT Loft filling did not complete.")
  const distance = builder.G0Error_1(),
    angle = g1 ? builder.G1Error_1() : 0,
    curvature = g2 ? builder.G2Error_1() : 0
  if (
    !(distance <= DISTANCE_TOLERANCE) ||
    !(angle <= ANGLE_TOLERANCE) ||
    !(curvature <= CURVATURE_TOLERANCE)
  )
    throw new Error(
      `OCCT Loft filling exceeded continuity tolerances (distance=${distance}, angle=${angle}, curvature=${curvature}).`,
    )
}
function validateNetworkConstraints(network: LoftPatchNetwork) {
  const count = network.outerCorrespondence.length
  const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < count
  for (const entries of [network.start, network.end])
    if (
      entries.some(({ segmentTrack }) => !validIndex(segmentTrack)) ||
      new Set(entries.map(({ segmentTrack }) => segmentTrack)).size !== entries.length
    )
      throw new Error("Loft end constraints require unique existing segment tracks.")
  if (network.rails.some(({ vertexTrack }) => !validIndex(vertexTrack)))
    throw new Error("A Loft rail references a missing vertex track.")
  if (
    network.guides.length > 64 ||
    network.guides.some(({ segmentTrack, name }) => !validIndex(segmentTrack) || !name.trim()) ||
    new Set(network.guides.map(({ name }) => name)).size !== network.guides.length
  )
    throw new Error("Loft guides require unique names and existing segment tracks.")
}
type Filling = InstanceType<OpenCascadeInstance["BRepOffsetAPI_MakeFilling"]>
type Constraint = { edge: Edge; support?: { face: Face; order: "G1" | "G2" } }
function appendSectionConstraints(
  occt: OpenCascadeInstance,
  builder: Filling,
  directed: ReturnType<typeof directedSections>,
  settings: { index: number; start?: LoftEndSupport | undefined; end?: LoftEndSupport | undefined },
  own: Own,
) {
  const constraints: Constraint[] = []
  for (const [column, entry] of directed.entries()) {
    const segment = required(entry.segments[settings.index]),
      edge = own(createAnalyticalEdge(occt, entry.section.frame, segment.segment, segment.reverse))
    const condition =
      column === 0 ? settings.start : column === directed.length - 1 ? settings.end : undefined
    const isBound = column === 0 || column === directed.length - 1
    if (condition) {
      const support = copiedSupport(occt, condition.support, own)
      constraints.push({ edge, support: { face: support, order: condition.continuity } })
      builder.Add_2(
        onSupportEdge(occt, edge, support, own).wrapped,
        support.wrapped,
        nativeOrder(occt, condition.continuity),
        true,
      )
    } else {
      constraints.push({ edge })
      builder.Add_1(edge.wrapped, occt.GeomAbs_Shape.GeomAbs_C0 as GeomAbs_Shape, isBound)
    }
  }
  return constraints
}
function appendAuxiliaryConstraints(
  occt: OpenCascadeInstance,
  builder: Filling,
  network: LoftPatchNetwork,
  rails: Edge[][],
  index: number,
  own: Own,
) {
  const constraints: Constraint[] = []
  for (const rail of [
    ...required(rails[index]),
    ...required(rails[(index + 1) % network.outerCorrespondence.length]),
  ]) {
    constraints.push({ edge: rail })
    builder.Add_1(rail.wrapped, occt.GeomAbs_Shape.GeomAbs_C0 as GeomAbs_Shape, true)
  }
  for (const guide of network.guides.filter(({ segmentTrack }) => segmentTrack === index))
    for (const edge of pathEdges(occt, guide.path, own)) {
      constraints.push({ edge })
      builder.Add_1(edge.wrapped, occt.GeomAbs_Shape.GeomAbs_C0 as GeomAbs_Shape, false)
    }
  return constraints
}
function patch(
  occt: OpenCascadeInstance,
  network: LoftPatchNetwork,
  directed: ReturnType<typeof directedSections>,
  rails: Edge[][],
  index: number,
  own: Own,
) {
  const first = required(directed[0]),
    last = required(directed.at(-1))
  const start = network.start.find(({ segmentTrack }) => segmentTrack === index),
    end = network.end.find(({ segmentTrack }) => segmentTrack === index)
  const g2 = start?.continuity === "G2" || end?.continuity === "G2",
    g1 = Boolean(start || end)
  const builder = own(
    new occt.BRepOffsetAPI_MakeFilling(
      g2 ? 4 : 3,
      50,
      5,
      false,
      DISTANCE_TOLERANCE / 100,
      DISTANCE_TOLERANCE / 100,
      ANGLE_TOLERANCE,
      CURVATURE_TOLERANCE,
      12,
      128,
    ),
  )
  const planarSupport = [start, end].find((condition) => condition?.support.geomType === "PLANE")
  const initial = planarSupport
    ? copiedSupport(occt, planarSupport.support, own)
    : own(
        makePolygon([
          point(first.section.frame, required(first.segments[index]).start),
          point(first.section.frame, required(first.segments[index]).end),
          point(last.section.frame, required(last.segments[index]).start),
        ]),
      )
  builder.LoadInitSurface(initial.wrapped)
  const constraints = appendSectionConstraints(occt, builder, directed, { index, start, end }, own)
  constraints.push(...appendAuxiliaryConstraints(occt, builder, network, rails, index, own))
  builder.Build(own(new occt.Message_ProgressRange_1()))
  requireResiduals(builder, g1, g2)
  const raw = own(builder.Shape())
  const face = own(new Face(occt.TopoDS.Face_1(raw)))
  for (const constraint of constraints)
    requireLoftEdgeResiduals(occt, face, constraint.edge, constraint.support)
  return face
}
/** Exact OCCT surfaces with bounded, measured constraints; all inputs remain borrowed. */
export function createOcctLoftPatchNetwork(
  occt: OpenCascadeInstance,
  network: LoftPatchNetwork,
): Shape3D {
  validateNetworkConstraints(network)
  const directed = directedSections(network),
    owned: Owned[] = []
  const own: Own = (binding) => {
    owned.push(binding)
    return binding
  }
  try {
    const railEdges = rails(occt, network, directed, own),
      sewing = own(new occt.BRepBuilderAPI_Sewing(1e-6, true, true, true, false))
    for (const [index] of network.outerCorrespondence.entries())
      sewing.Add(patch(occt, network, directed, railEdges, index, own).wrapped)
    sewing.Add(own(createAnalyticalFace(occt, required(network.sections[0]))).wrapped)
    sewing.Add(own(createAnalyticalFace(occt, required(network.sections.at(-1)))).wrapped)
    sewing.Perform(own(new occt.Message_ProgressRange_1()))
    if (sewing.NbFreeEdges() || sewing.NbMultipleEdges())
      throw new Error("A constrained Loft did not form a closed manifold shell.")
    const shell = own(sewing.SewedShape())
    if (shell.ShapeType() !== (occt.TopAbs_ShapeEnum.TopAbs_SHELL as TopAbs_ShapeEnum))
      throw new Error("A constrained Loft must form one shell.")
    const nativeShell = own(occt.TopoDS.Shell_1(shell)),
      solid = own(new occt.BRepBuilderAPI_MakeSolid_3(nativeShell))
    if (!solid.IsDone()) throw new Error("A constrained Loft solid did not complete.")
    const raw = solid.Solid()
    if (!occt.BRepLib.OrientClosedSolid(raw)) {
      raw.delete()
      throw new Error("A constrained Loft shell could not be oriented.")
    }
    const result = adoptOcctShape(raw, castOcctShape)
    try {
      validateOcctProfileSolid(occt, result)
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const binding of owned.reverse()) binding.delete()
  }
}
