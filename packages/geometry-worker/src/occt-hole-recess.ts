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
  return revolveAxialMeridian(occt, center, direction, [
    [0, 0],
    [outerRadius, 0],
    [innerRadius, height],
    [0, height],
  ])
}

/**
 * Revolves one drilled hole: a full-diameter cylinder to the shoulder at `depth`, then a
 * conical drill point whose apex lies `tipHeight` beyond the shoulder on the hole axis.
 */
export function createOcctDrilledHole(
  occt: OpenCascadeInstance,
  center: Point,
  direction: Point,
  radius: number,
  depth: number,
  tipHeight: number,
): Shape3D {
  return revolveAxialMeridian(occt, center, direction, [
    [0, 0],
    [radius, 0],
    [radius, depth],
    [0, depth + tipHeight],
  ])
}

/** A unit vector perpendicular to the drilling axis, used as the meridian's radial direction. */
function radialUnit([dx, dy, dz]: Point): Point {
  const [rx, ry, rz] = Math.abs(dx) < 0.8 ? [1, 0, 0] : [0, 1, 0]
  const cross: Point = [dy * rz - dz * ry, dz * rx - dx * rz, dx * ry - dy * rx]
  const norm = Math.hypot(...cross)
  if (!Number.isFinite(norm) || norm < 1e-9) throw new Error("Revolved hole axis is invalid.")
  return [cross[0] / norm, cross[1] / norm, cross[2] / norm]
}

/** Revolves a closed [radius, axial depth] polygon whose first and last points lie on the axis. */
function revolveAxialMeridian(
  occt: OpenCascadeInstance,
  center: Point,
  direction: Point,
  meridian: readonly (readonly [number, number])[],
): Shape3D {
  const owned: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T) => {
    owned.push(value)
    return value
  }
  try {
    const radial = radialUnit(direction)
    const point = (radius: number, depth: number) =>
      own(
        new occt.gp_Pnt_3(
          center[0] + direction[0] * depth + radial[0] * radius,
          center[1] + direction[1] * depth + radial[1] * radius,
          center[2] + direction[2] * depth + radial[2] * radius,
        ),
      )
    const points = meridian.map(([radius, depth]) => point(radius, depth))
    const wireBuilder = own(new occt.BRepBuilderAPI_MakeWire_1())
    for (const [index, first] of points.entries()) {
      const last = points[(index + 1) % points.length]
      if (!last) throw new Error("Revolved hole meridian is incomplete.")
      wireBuilder.Add_1(own(own(new occt.BRepBuilderAPI_MakeEdge_3(first, last)).Edge()))
    }
    if (!wireBuilder.IsDone()) throw new Error("Revolved hole meridian wire failed.")
    const wire = own(wireBuilder.Wire())
    const faceBuilder = own(new occt.BRepBuilderAPI_MakeFace_15(wire, true))
    if (!faceBuilder.IsDone()) throw new Error("Revolved hole meridian face failed.")
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
