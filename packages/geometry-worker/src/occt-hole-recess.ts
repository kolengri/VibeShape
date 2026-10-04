import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

type Point = readonly [number, number, number]

/** Revolves an exact frustum meridian about the authored drilling direction. */
export function createOcctCountersink(
  occt: OpenCascadeInstance,
  center: Point,
  direction: Point,
  outerRadius: number,
  innerRadius: number,
  height: number,
): Shape3D {
  const owned: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T) => {
    owned.push(value)
    return value
  }
  try {
    const reference = Math.abs(direction[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]
    const cross = [
      direction[1] * (reference[2] ?? 0) - direction[2] * (reference[1] ?? 0),
      direction[2] * (reference[0] ?? 0) - direction[0] * (reference[2] ?? 0),
      direction[0] * (reference[1] ?? 0) - direction[1] * (reference[0] ?? 0),
    ]
    const norm = Math.hypot(...cross)
    if (!Number.isFinite(norm) || norm < 1e-9) throw new Error("Countersink axis is invalid.")
    const point = (radius: number, depth: number) =>
      own(
        new occt.gp_Pnt_3(
          center[0] + direction[0] * depth + ((cross[0] ?? 0) * radius) / norm,
          center[1] + direction[1] * depth + ((cross[1] ?? 0) * radius) / norm,
          center[2] + direction[2] * depth + ((cross[2] ?? 0) * radius) / norm,
        ),
      )
    const points = [
      point(0, 0),
      point(outerRadius, 0),
      point(innerRadius, height),
      point(0, height),
    ]
    const wireBuilder = own(new occt.BRepBuilderAPI_MakeWire_1())
    for (const [index, first] of points.entries()) {
      const last = points[(index + 1) % points.length]
      if (!last) throw new Error("Countersink meridian is incomplete.")
      wireBuilder.Add_1(own(own(new occt.BRepBuilderAPI_MakeEdge_3(first, last)).Edge()))
    }
    if (!wireBuilder.IsDone()) throw new Error("Countersink meridian wire failed.")
    const wire = own(wireBuilder.Wire())
    const faceBuilder = own(new occt.BRepBuilderAPI_MakeFace_15(wire, true))
    if (!faceBuilder.IsDone()) throw new Error("Countersink meridian face failed.")
    const face = own(faceBuilder.Face())
    const origin = own(new occt.gp_Pnt_3(...center))
    const normal = own(new occt.gp_Dir_4(...direction))
    const axis = own(new occt.gp_Ax1_2(origin, normal))
    const revolver = own(new occt.BRepPrimAPI_MakeRevol_1(face, axis, 2 * Math.PI, false))
    return adoptOcctShape(revolver.Shape(), castOcctShape)
  } finally {
    for (const resource of owned.reverse()) resource.delete()
  }
}
