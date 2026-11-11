import type { Face, Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

/** A typed Press Pull failure; version 2 forwards its message, version 1 keeps catalog advice. */
export class PressPullError extends Error {}

type OwnedBinding = { delete(): unknown }
type OwnBinding = <T extends OwnedBinding>(binding: T) => T

function requirePressPullSource(
  occt: OpenCascadeInstance,
  source: Shape3D,
  face: Face,
  distance: number,
) {
  if (!Number.isFinite(distance) || Math.abs(distance) < 0.001 || Math.abs(distance) > 100_000)
    throw new PressPullError(
      "Press Pull distance must have a magnitude between 0.001 and 100000 mm.",
    )
  if (face.geomType !== "PLANE") throw new PressPullError("Press Pull supports planar faces only.")
  const metrics = inspectOcctBody(occt, source)
  if (!featureResultMetricsAreValid(metrics, 1) || !Number.isFinite(metrics.volume))
    throw new PressPullError("Press Pull requires one valid exact solid.")
  const faces = source.faces
  try {
    if (faces.filter((candidate) => candidate.wrapped.IsSame(face.wrapped)).length !== 1)
      throw new PressPullError("Press Pull face must belong to the exact target body.")
  } finally {
    for (const candidate of faces) candidate.delete()
  }
  return metrics.volume
}
function createOwnedFacePrism(
  occt: OpenCascadeInstance,
  source: Shape3D,
  face: Face,
  distance: number,
  own: OwnBinding,
) {
  const normal = own(face.normalAt()),
    components = normal.toTuple(),
    magnitude = Math.hypot(...components)
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12)
    throw new PressPullError("Press Pull planar face normal is unavailable.")
  const vector = own(
    new occt.gp_Vec_4(
      ...(components.map((value) => (value * distance) / magnitude) as [number, number, number]),
    ),
  )
  // Deep-copy the body and its selected trimmed face before either native builder touches them.
  const transform = own(new occt.gp_Trsf_1())
  const copier = own(new occt.BRepBuilderAPI_Transform_2(source.wrapped, transform, true))
  if (!copier.IsDone())
    throw new PressPullError("Press Pull could not copy the source body. Adjust the distance.")
  const copied = own(copier.Shape()),
    copiedFace = own(copier.ModifiedShape(face.wrapped))
  if (copiedFace.IsNull())
    throw new PressPullError("Press Pull face is unavailable on the owned copy.")
  const builder = own(new occt.BRepPrimAPI_MakePrism_1(copiedFace, vector, true, true))
  if (!builder.IsDone())
    throw new PressPullError("Press Pull could not sweep the face. Adjust the distance.")
  return { copied, prism: own(builder.Shape()) }
}
function requirePressPullResult(
  occt: OpenCascadeInstance,
  result: Shape3D,
  sourceVolume: number,
  distance: number,
) {
  const metrics = inspectOcctBody(occt, result)
  const delta = (metrics.volume - sourceVolume) * Math.sign(distance)
  if (
    !featureResultMetricsAreValid(metrics, 1) ||
    !Number.isFinite(metrics.volume) ||
    delta <= Math.max(1e-9, sourceVolume * 1e-12)
  )
    throw new PressPullError(
      "Press Pull must change the volume and retain one valid solid; this distance collapses, splits, or misses the body.",
    )
}
/** Sweeps the complete trimmed planar face, including inner wires, along its outward normal. */
export function pressPullOcctShape(
  occt: OpenCascadeInstance,
  source: Shape3D,
  face: Face,
  distance: number,
): Shape3D {
  const sourceVolume = requirePressPullSource(occt, source, face, distance)
  const owned: OwnedBinding[] = []
  const own: OwnBinding = (value) => {
    owned.push(value)
    return value
  }
  try {
    const { copied, prism } = createOwnedFacePrism(occt, source, face, distance, own)
    const progress = own(new occt.Message_ProgressRange_1())
    const Builder = distance > 0 ? occt.BRepAlgoAPI_Fuse_3 : occt.BRepAlgoAPI_Cut_3
    const builder = own(new Builder(copied, prism, progress))
    builder.Build(progress)
    if (!builder.IsDone())
      throw new PressPullError(
        "Press Pull could not combine the swept face with the body. Adjust the distance.",
      )
    builder.SimplifyResult(true, true, 1e-7)
    const result = adoptOcctShape(builder.Shape(), castOcctShape)
    try {
      requirePressPullResult(occt, result, sourceVolume, distance)
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}
