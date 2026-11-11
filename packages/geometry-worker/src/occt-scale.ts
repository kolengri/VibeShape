import { SCALE_MAX_FACTOR, SCALE_MIN_FACTOR } from "@vibeshape/protocol"
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
type Point = [number, number, number]

/** A user-actionable Scale failure; the message is safe to surface as a feature diagnostic. */
export class ScaleError extends Error {}

/** Every scaled body stays within this distance of the world origin on each axis. */
const SCALE_WORKSPACE_LIMIT_MM = 100_000

/** Axis-aligned world bounding box; the symmetric tolerance gap cancels out of its centre. */
function occtBoundingBox(occt: OpenCascadeInstance, shape: Shape3D): { min: Point; max: Point } {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    if (box.IsVoid()) throw new ScaleError("Scale cannot measure the body bounding box.")
    const min = box.CornerMin()
    try {
      const max = box.CornerMax()
      try {
        return { min: [min.X(), min.Y(), min.Z()], max: [max.X(), max.Y(), max.Z()] }
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

export function occtBoundingBoxCenter(occt: OpenCascadeInstance, shape: Shape3D): Point {
  const { min, max } = occtBoundingBox(occt, shape)
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

function requireWithinWorkspace(occt: OpenCascadeInstance, result: Shape3D) {
  const { min, max } = occtBoundingBox(occt, result)
  if ([...min, ...max].some((value) => Math.abs(value) > SCALE_WORKSPACE_LIMIT_MM))
    throw new ScaleError(
      `The scaled body extends beyond ${SCALE_WORKSPACE_LIMIT_MM} mm from the world origin. Reduce the factor or move the scale center closer to the body.`,
    )
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
  if (!Number.isFinite(factor) || factor < SCALE_MIN_FACTOR || factor > SCALE_MAX_FACTOR)
    throw new ScaleError(
      `Scale factor must be between ${SCALE_MIN_FACTOR} and ${SCALE_MAX_FACTOR}.`,
    )
  if (!featureResultMetricsAreValid(inspectOcctBody(occt, source), 1))
    throw new ScaleError("Scale requires one valid exact solid body. Repair the target body.")
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
    if (!builder.IsDone())
      throw new ScaleError("OCCT could not scale this body. Adjust the factor or the center.")
    const result = adoptOcctShape(builder.Shape(), castOcctShape)
    try {
      requireWithinWorkspace(occt, result)
      if (!featureResultMetricsAreValid(inspectOcctBody(occt, result), 1))
        throw new ScaleError(
          "Scale did not produce one valid solid. Adjust the factor or the center.",
        )
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}
