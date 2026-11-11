import {
  type CoilFeatureContentParameters,
  coilFeatureContentParametersSchema,
  coilSectionExtent,
  type HelixContent,
  helixContentSchema,
  helixStart,
  type SweepFeatureContentParametersV2,
  sweepFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopoDS_Shape, TopoDS_Wire } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { createAnalyticalWire, parseAnalyticalProfile, validateOcctProfileSolid } from "./occt-loft"
import { nativeResult, nativeScope, type OwnNative } from "./occt-native-scope"

type Vector = readonly [number, number, number]
const LABEL = "Helix"
const MAX_TURNS_PER_EDGE = 4

function point(occt: OpenCascadeInstance, own: OwnNative, value: Vector) {
  return own(new occt.gp_Pnt_3(value[0], value[1], value[2]))
}
function direction(occt: OpenCascadeInstance, own: OwnNative, value: Vector) {
  return own(new occt.gp_Dir_4(value[0], value[1], value[2]))
}
function offset(origin: Vector, ...terms: readonly (readonly [Vector, number])[]): Vector {
  return terms.reduce<Vector>(
    (sum, [vector, scale]) => [
      sum[0] + vector[0] * scale,
      sum[1] + vector[1] * scale,
      sum[2] + vector[2] * scale,
    ],
    origin,
  )
}

/**
 * Builds the exact helix as a straight PCurve on its cylinder, then a 3D approximation. Angle
 * zero is the authored start radial direction, so the spine starts at the helix start point.
 */
export function createOcctHelixSpine(occt: OpenCascadeInstance, helix: HelixContent): TopoDS_Wire {
  const parsed = helixContentSchema.parse(helix)
  const { frame } = helixStart(parsed)
  return nativeResult(LABEL, (own) => {
    const axis = own(
      new occt.gp_Ax3_3(
        point(occt, own, parsed.origin),
        direction(occt, own, frame.axis),
        direction(occt, own, frame.radial),
      ),
    )
    const cylinder = own(new occt.gp_Cylinder_2(axis, parsed.radius))
    const height = parsed.pitch * parsed.turns
    const faceBuilder = own(
      new occt.BRepBuilderAPI_MakeFace_10(cylinder, 0, 2 * Math.PI, 0, height),
    )
    const face = own(faceBuilder.Face())
    const surface = own(occt.BRep_Tool.Surface_2(face))
    const sign = parsed.handedness === "right" ? 1 : -1
    // One approximated 3D curve degrades past ~20 turns; chain bounded edges on one surface.
    const count = Math.ceil(parsed.turns / MAX_TURNS_PER_EDGE)
    const wireBuilder = own(new occt.BRepBuilderAPI_MakeWire_1())
    for (let index = 0; index < count; index += 1) {
      const [from, to] = [index, index + 1].map((step) => (parsed.turns * step) / count)
      const first = own(
        new occt.gp_Pnt2d_3(sign * 2 * Math.PI * (from ?? 0), parsed.pitch * (from ?? 0)),
      )
      const last = own(
        new occt.gp_Pnt2d_3(sign * 2 * Math.PI * (to ?? 0), parsed.pitch * (to ?? 0)),
      )
      const segment = own(new occt.GCE2d_MakeSegment_1(first, last))
      const trimmed = own(segment.Value())
      // get() is borrowed; the new handle retains it, so only handles are released.
      const curve = own(new occt.Handle_Geom2d_Curve_2(trimmed.get()))
      const edgeBuilder = own(new occt.BRepBuilderAPI_MakeEdge_30(curve, surface))
      wireBuilder.Add_1(own(edgeBuilder.Edge()))
    }
    if (!wireBuilder.IsDone()) throw new Error("OCCT could not connect the helix edges.")
    const wire = own(wireBuilder.Wire())
    if (!occt.BRepLib.BuildCurves3d_2(wire))
      throw new Error("OCCT could not construct the helix in 3D.")
    return wire
  })
}

/**
 * Sweeps one closed section wire along the helix with the Frenet trihedron. For a helix the
 * Frenet frame is a rigid screw motion of the start frame, so the section does not twist.
 */
function pipeSolid(occt: OpenCascadeInstance, spine: TopoDS_Wire, section: TopoDS_Shape): Shape3D {
  return nativeResult(LABEL, (own) => {
    const builder = own(new occt.BRepOffsetAPI_MakePipeShell(spine))
    builder.SetTolerance(1e-6, 1e-6, 1e-5)
    builder.SetMode_1(true)
    builder.Add_1(section, false, false)
    const progress = own(new occt.Message_ProgressRange_1())
    builder.Build(progress)
    if (!builder.IsDone() || !builder.MakeSolid())
      throw new Error("OCCT could not sweep a closed solid along the helix.")
    const shape = own(adoptOcctShape(builder.Shape(), castOcctShape))
    validateOcctProfileSolid(occt, shape)
    return shape
  })
}

function coilSectionWire(
  occt: OpenCascadeInstance,
  parameters: CoilFeatureContentParameters,
): TopoDS_Wire {
  const start = helixStart(parameters.helix)
  // Principal normal points to the axis; binormal = tangent x normal.
  const normal: Vector = [-start.frame.radial[0], -start.frame.radial[1], -start.frame.radial[2]]
  const [t, n] = [start.tangent, normal]
  const binormal: Vector = [
    t[1] * n[2] - t[2] * n[1],
    t[2] * n[0] - t[0] * n[2],
    t[0] * n[1] - t[1] * n[0],
  ]
  return nativeResult(LABEL, (own) => {
    const section = parameters.section
    if (section.kind === "circular") {
      const axis = own(
        new occt.gp_Ax2_2(
          point(occt, own, start.point),
          direction(occt, own, start.tangent),
          direction(occt, own, normal),
        ),
      )
      const circle = own(new occt.gp_Circ_2(axis, section.diameter / 2))
      const edge = own(own(new occt.BRepBuilderAPI_MakeEdge_8(circle)).Edge())
      return own(own(new occt.BRepBuilderAPI_MakeWire_2(edge)).Wire())
    }
    const w = section.width / 2
    const h = section.height / 2
    const corners = [
      offset(start.point, [normal, -w], [binormal, -h]),
      offset(start.point, [normal, w], [binormal, -h]),
      offset(start.point, [normal, w], [binormal, h]),
      offset(start.point, [normal, -w], [binormal, h]),
    ].map((corner) => point(occt, own, corner))
    const builder = own(new occt.BRepBuilderAPI_MakeWire_1())
    for (const [index, first] of corners.entries()) {
      const last = corners[(index + 1) % corners.length]
      if (!last) throw new Error("Coil section corner is unavailable.")
      builder.Add_1(own(own(new occt.BRepBuilderAPI_MakeEdge_3(first, last)).Edge()))
    }
    if (!builder.IsDone()) throw new Error("OCCT could not construct the coil section.")
    return own(builder.Wire())
  })
}

/** Exact coil tool body; Add/Remove/Intersect are applied by the evaluator. */
export function createOcctCoil(
  occt: OpenCascadeInstance,
  content: CoilFeatureContentParameters,
): Shape3D {
  const parameters = coilFeatureContentParametersSchema.parse(content)
  const extent = coilSectionExtent(parameters.section)
  if (extent.radial / 2 >= parameters.helix.radius)
    throw new Error("The coil section must not reach the helix axis.")
  return nativeResult(LABEL, (own) => {
    const spine = own(createOcctHelixSpine(occt, parameters.helix))
    const section = own(coilSectionWire(occt, parameters))
    return own(pipeSolid(occt, spine, section))
  })
}

/** Local helix coordinates: radial at start, tangential, axial. */
function profileExtentsInHelixFrame(
  occt: OpenCascadeInstance,
  wire: TopoDS_Wire,
  helix: HelixContent,
) {
  const { frame } = helixStart(helix)
  const [r, t, a] = [frame.radial, frame.tangential, frame.axis]
  const [x, y, z] = helix.origin
  return nativeScope(LABEL, (own) => {
    const transform = own(new occt.gp_Trsf_1())
    transform.SetValues(
      r[0],
      r[1],
      r[2],
      -(r[0] * x + r[1] * y + r[2] * z),
      t[0],
      t[1],
      t[2],
      -(t[0] * x + t[1] * y + t[2] * z),
      a[0],
      a[1],
      a[2],
      -(a[0] * x + a[1] * y + a[2] * z),
    )
    const builder = own(new occt.BRepBuilderAPI_Transform_2(wire, transform, true))
    if (!builder.IsDone()) throw new Error("OCCT could not place the helical Sweep profile.")
    const local = own(builder.Shape())
    const box = own(new occt.Bnd_Box_1())
    occt.BRepBndLib.AddOptimal(local, box, false, false)
    if (box.IsVoid() || box.IsOpen())
      throw new Error("Helical Sweep profile bounds are not finite.")
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
      radialMin: values[0].current,
      axialSize: values[5].current - values[2].current,
    }
  })
}

/**
 * The profile must stay off the axis, and its meridian span (axial size / cos^2 of the lead
 * angle, because the start plane is tilted by the lead angle) must stay below the pitch.
 */
function validateHelicalProfileClearance(
  occt: OpenCascadeInstance,
  wire: TopoDS_Wire,
  helix: HelixContent,
) {
  const extents = profileExtentsInHelixFrame(occt, wire, helix)
  if (extents.radialMin <= 1e-6)
    throw new Error("The helical Sweep profile must not reach the helix axis.")
  const circumference = 2 * Math.PI * helix.radius
  const cosSquared = circumference ** 2 / (circumference ** 2 + helix.pitch ** 2)
  if (helix.pitch <= extents.axialSize / cosSquared)
    throw new Error(
      "Adjacent helical Sweep turns would intersect. Increase the pitch or reduce the profile size along the axis.",
    )
}

/** Helical Sweep v2: one hole-free authored profile along an exact helix. */
export function createOcctHelicalSweep(
  occt: OpenCascadeInstance,
  content: SweepFeatureContentParametersV2,
): Shape3D {
  const parameters = sweepFeatureContentParametersV2Schema.parse(content)
  const profile = parseAnalyticalProfile(parameters.profile)
  if (profile.holes.length)
    throw new Error("Helical Sweep profiles must not contain holes in this version.")
  return nativeResult(LABEL, (own) => {
    const section = own(createAnalyticalWire(occt, profile.frame, profile.outer.segments))
    validateHelicalProfileClearance(occt, section.wrapped, parameters.helix)
    const spine = own(createOcctHelixSpine(occt, parameters.helix))
    return own(pipeSolid(occt, spine, section.wrapped))
  })
}
