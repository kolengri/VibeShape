import { Edge, type SimplePoint } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"

export type CubicBezierControlPoints = Readonly<{
  start: SimplePoint
  control1: SimplePoint
  control2: SimplePoint
  end: SimplePoint
}>

/** Creates one exact caller-owned edge; temporary native curve objects never escape. */
export function makeOcctCubicBezierEdge(
  occt: OpenCascadeInstance,
  input: CubicBezierControlPoints,
  reverse = false,
): Edge {
  const points = [input.start, input.control1, input.control2, input.end]
  if (
    !points.every(
      (point) =>
        point.length === 3 &&
        point.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000),
    )
  )
    throw new RangeError("Cubic Bezier coordinates must remain finite and within +/-100000 mm.")
  if (
    points.every(
      (point) =>
        Math.hypot(
          point[0] - input.start[0],
          point[1] - input.start[1],
          point[2] - input.start[2],
        ) <= 1e-7,
    )
  )
    throw new RangeError("An exact cubic Bezier edge requires nonzero geometric extent.")
  const owned: { delete(): void }[] = []
  try {
    const poles = new occt.TColgp_Array1OfPnt_2(1, 4)
    owned.push(poles)
    for (const [index, coordinates] of (reverse ? points.reverse() : points).entries()) {
      const point = new occt.gp_Pnt_3(...coordinates)
      try {
        poles.SetValue(index + 1, point)
      } finally {
        point.delete()
      }
    }
    const curve = new occt.Geom_BezierCurve_1(poles)
    owned.push(curve)
    const handle = new occt.Handle_Geom_Curve_2(curve)
    // OCCT handles take intrusive ownership. Deleting the raw pointee would invalidate the edge.
    owned.pop()
    owned.push(handle)
    const builder = new occt.BRepBuilderAPI_MakeEdge_24(handle)
    owned.push(builder)
    if (!builder.IsDone()) throw new Error("The exact cubic Bezier edge could not be built.")
    const edge = builder.Edge()
    try {
      return new Edge(edge)
    } catch (error) {
      edge.delete()
      throw error
    }
  } finally {
    owned.reverse().forEach((value) => {
      value.delete()
    })
  }
}
