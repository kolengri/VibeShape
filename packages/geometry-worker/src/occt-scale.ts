import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

export type ScaleCenter =
  | Readonly<{ kind: "origin" }>
  | Readonly<{ kind: "bounding-box-center" }>
  | Readonly<{ kind: "point"; point: readonly [number, number, number] }>

export type ScaleGeometryParameters = Readonly<{ factor: number; center: ScaleCenter }>

type OwnedBinding = { delete(): unknown }

/** Axis-aligned world bounding-box centre; the symmetric tolerance gap cancels out. */
export function occtBoundingBoxCenter(
  occt: OpenCascadeInstance,
  shape: Shape3D,
): [number, number, number] {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    if (box.IsVoid()) throw new Error("Scale cannot measure the body bounding box.")
    const min = box.CornerMin()
    try {
      const max = box.CornerMax()
      try {
        return [(min.X() + max.X()) / 2, (min.Y() + max.Y()) / 2, (min.Z() + max.Z()) / 2]
      } finally {
        max.delete()
      }
    } finally {
      min.delete()
    }
  } finally {
    box.delete()
  }
}

function scaleCenterPoint(
  occt: OpenCascadeInstance,
  source: Shape3D,
  center: ScaleCenter,
): readonly [number, number, number] {
  if (center.kind === "point") return center.point
  return center.kind === "origin" ? [0, 0, 0] : occtBoundingBoxCenter(occt, source)
}

/** Uniformly scales a copy of one exact solid; the cached source is never modified. */
export function scaleOcctShape(
  occt: OpenCascadeInstance,
  source: Shape3D,
  parameters: ScaleGeometryParameters,
): Shape3D {
  const { factor } = parameters
  if (!Number.isFinite(factor) || factor < 0.001 || factor > 1000)
    throw new Error("Scale factor must be between 0.001 and 1000.")
  if (!featureResultMetricsAreValid(inspectOcctBody(occt, source), 1))
    throw new Error("Scale requires one valid exact solid body.")
  const owned: OwnedBinding[] = []
  const own = <T extends OwnedBinding>(value: T) => {
    owned.push(value)
    return value
  }
  try {
    const center = own(new occt.gp_Pnt_3(...scaleCenterPoint(occt, source, parameters.center)))
    const transform = own(new occt.gp_Trsf_1())
    transform.SetScale(center, factor)
    // Copy=true keeps the cached source shape and its topology snapshot intact.
    const builder = own(new occt.BRepBuilderAPI_Transform_2(source.wrapped, transform, true))
    if (!builder.IsDone()) throw new Error("OCCT scale did not complete.")
    const result = adoptOcctShape(builder.Shape(), castOcctShape)
    try {
      if (!featureResultMetricsAreValid(inspectOcctBody(occt, result), 1))
        throw new Error("Scale did not produce one valid solid.")
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}
