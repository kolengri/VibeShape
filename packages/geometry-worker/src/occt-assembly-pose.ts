import { type AssemblyInspection, assemblyRigidPoseWireSchema } from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopoDS_Shape } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"

export type AssemblyPoseSource = Readonly<{
  shape: Shape3D
  pose: AssemblyInspection["occurrences"][number]["geometryFrame"]
}>
function validatePlacedBounds(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape, box, false, true)
    if (box.IsVoid() || box.IsOpen())
      throw new Error("Placed assembly source bounds must be finite.")
    const values = Array.from({ length: 6 }, () => ({ current: Number.NaN }))
    Reflect.apply(box.Get, box, values)
    if (
      values.some(({ current }) => !Number.isFinite(current) || Math.abs(current) > 100_000 + 1e-7)
    )
      throw new Error("A placed assembly source exceeds the modeling world bounds.")
  } finally {
    box.delete()
  }
}
/** Returns one owned copy. The source wrapper and its triangulation remain untouched. */
export function copyOcctAssemblySource(
  occt: OpenCascadeInstance,
  source: AssemblyPoseSource,
): TopoDS_Shape {
  const metrics = inspectOcctBody(occt, source.shape)
  if (
    !metrics.valid ||
    metrics.solidCount !== 1 ||
    !Number.isFinite(metrics.volume) ||
    metrics.volume <= 0
  )
    throw new Error("Assembly operations require valid exact single-solid sources.")
  const pose = assemblyRigidPoseWireSchema.parse(source.pose)
  const [x, y, z, w] = pose.quaternion
  const [tx, ty, tz] = pose.translation
  const transform = new occt.gp_Trsf_1()
  try {
    transform.SetValues(
      1 - 2 * (y * y + z * z),
      2 * (x * y - w * z),
      2 * (x * z + w * y),
      tx,
      2 * (x * y + w * z),
      1 - 2 * (x * x + z * z),
      2 * (y * z - w * x),
      ty,
      2 * (x * z - w * y),
      2 * (y * z + w * x),
      1 - 2 * (x * x + y * y),
      tz,
    )
    const builder = new occt.BRepBuilderAPI_Transform_2(source.shape.wrapped, transform, true)
    try {
      if (!builder.IsDone()) throw new Error("Assembly source placement did not complete.")
      const copied = builder.Shape()
      try {
        validatePlacedBounds(occt, copied)
        return copied
      } catch (error) {
        copied.delete()
        throw error
      }
    } finally {
      builder.delete()
    }
  } finally {
    transform.delete()
  }
}
