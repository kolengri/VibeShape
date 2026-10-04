import type { Edge, Face, SimplePoint } from "replicad"
import type { Extrema_ExtAlgo, OpenCascadeInstance } from "replicad-opencascadejs"

type Jet = {
  du: SimplePoint
  dv: SimplePoint
  duu: SimplePoint
  dvv: SimplePoint
  duv: SimplePoint
}
const dot = (a: SimplePoint, b: SimplePoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
function cross(occt: OpenCascadeInstance, a: SimplePoint, b: SimplePoint): SimplePoint {
  const first = new occt.gp_Vec_4(...a)
  try {
    const second = new occt.gp_Vec_4(...b)
    try {
      const result = first.Crossed(second)
      try {
        return [result.X(), result.Y(), result.Z()]
      } finally {
        result.delete()
      }
    } finally {
      second.delete()
    }
  } finally {
    first.delete()
  }
}

function unit(v: SimplePoint): SimplePoint {
  const length = Math.hypot(...v)
  if (!(length > 1e-12))
    throw new Error("A Loft continuity sample has singular surface derivatives.")
  return [v[0] / length, v[1] / length, v[2] / length]
}
function surfaceJet(
  occt: OpenCascadeInstance,
  face: Face,
  sample: SimplePoint,
): { distance: number; jet: Jet } {
  const owned: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T) => {
    owned.push(value)
    return value
  }
  try {
    const point = own(new occt.gp_Pnt_3(...sample)),
      surface = own(occt.BRep_Tool.Surface_2(face.wrapped)),
      projection = own(
        new occt.GeomAPI_ProjectPointOnSurf_3(
          point,
          surface,
          1e-12,
          occt.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as Extrema_ExtAlgo,
        ),
      )
    if (!projection.IsDone() || !projection.NbPoints())
      throw new Error("A Loft native surface projection did not complete.")
    const u = { current: 0 },
      v = { current: 0 }
    Reflect.apply(projection.LowerDistanceParameters, projection, [u, v])
    const adaptor = own(new occt.BRepAdaptor_Surface_2(face.wrapped, true)),
      at = own(new occt.gp_Pnt_1()),
      du = own(new occt.gp_Vec_1()),
      dv = own(new occt.gp_Vec_1()),
      duu = own(new occt.gp_Vec_1()),
      dvv = own(new occt.gp_Vec_1()),
      duv = own(new occt.gp_Vec_1())
    adaptor.D2(u.current, v.current, at, du, dv, duu, dvv, duv)
    const tuple = (vector: typeof du): SimplePoint => [vector.X(), vector.Y(), vector.Z()]
    return {
      distance: projection.LowerDistance(),
      jet: { du: tuple(du), dv: tuple(dv), duu: tuple(duu), dvv: tuple(dvv), duv: tuple(duv) },
    }
  } finally {
    for (const binding of owned.reverse()) binding.delete()
  }
}
function trimmedDistance(occt: OpenCascadeInstance, face: Face, sample: SimplePoint) {
  const owned: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(binding: T) => {
    owned.push(binding)
    return binding
  }
  try {
    const point = own(new occt.gp_Pnt_3(...sample)),
      vertexBuilder = own(new occt.BRepBuilderAPI_MakeVertex(point)),
      vertex = own(vertexBuilder.Vertex()),
      progress = own(new occt.Message_ProgressRange_1()),
      distance = own(new occt.BRepExtrema_DistShapeShape_1())
    distance.SetDeflection(1e-10)
    distance.LoadS1(vertex)
    distance.LoadS2(face.wrapped)
    distance.Perform(progress)
    if (!distance.IsDone()) throw new Error("A Loft native face distance did not complete.")
    return distance.Value()
  } finally {
    for (const binding of owned.reverse()) binding.delete()
  }
}
function curvature(jet: Jet, normal: SimplePoint, direction: SimplePoint) {
  const E = dot(jet.du, jet.du),
    F = dot(jet.du, jet.dv),
    G = dot(jet.dv, jet.dv),
    determinant = E * G - F * F
  if (!(determinant > 1e-20)) throw new Error("A Loft continuity sample has a singular metric.")
  const a = (G * dot(jet.du, direction) - F * dot(jet.dv, direction)) / determinant,
    b = (E * dot(jet.dv, direction) - F * dot(jet.du, direction)) / determinant
  return (
    dot(normal, jet.duu) * a * a + 2 * dot(normal, jet.duv) * a * b + dot(normal, jet.dvv) * b * b
  )
}
function compareJets(occt: OpenCascadeInstance, first: Jet, second: Jet, order: "G1" | "G2") {
  const n1 = unit(cross(occt, first.du, first.dv)),
    rawN2 = unit(cross(occt, second.du, second.dv)),
    sign = dot(n1, rawN2) < 0 ? -1 : 1,
    n2: SimplePoint = [rawN2[0] * sign, rawN2[1] * sign, rawN2[2] * sign]
  const angle = Math.asin(Math.min(1, Math.hypot(...cross(occt, n1, n2))))
  if (!(angle <= 1e-5))
    throw new Error(`A Loft end exceeded its geometric G1 tolerance (angle=${angle}).`)
  if (order !== "G2") return
  const d1 = unit(second.du),
    d2 = unit(cross(occt, n2, d1)),
    diagonal = unit([d1[0] + d2[0], d1[1] + d2[1], d1[2] + d2[2]])
  const residual = Math.max(
    ...[d1, d2, diagonal].map((direction) =>
      Math.abs(curvature(first, n1, direction) - curvature(second, n2, direction)),
    ),
  )
  if (!(residual <= 1e-4))
    throw new Error(`A Loft end exceeded its geometric G2 tolerance (curvature=${residual}).`)
}
/** Native closest projection and D2 verify geometric constraints independently of filling error reports. */
export function requireLoftEdgeResiduals(
  occt: OpenCascadeInstance,
  face: Face,
  edge: Edge,
  support?: { face: Face; order: "G1" | "G2" },
) {
  const curve = new occt.BRepAdaptor_Curve_2(edge.wrapped)
  try {
    const from = curve.FirstParameter(),
      to = curve.LastParameter()
    for (let index = 0; index <= 8; index++) {
      const nativePoint = curve.Value(from + ((to - from) * index) / 8)
      const sample: SimplePoint = [nativePoint.X(), nativePoint.Y(), nativePoint.Z()]
      nativePoint.delete()
      const actual = surfaceJet(occt, face, sample)
      if (!(actual.distance <= 1e-7) || !(trimmedDistance(occt, face, sample) <= 1e-7))
        throw new Error(
          `A Loft guide or section exceeded its geometric C0 tolerance (distance=${actual.distance}).`,
        )
      if (support)
        compareJets(occt, actual.jet, surfaceJet(occt, support.face, sample).jet, support.order)
    }
  } finally {
    curve.delete()
  }
}
