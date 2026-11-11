import { DRAFT_MAX_ANGLE_RADIANS, DRAFT_MIN_ANGLE_RADIANS } from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

/** A user-actionable Draft failure; the message is safe to surface as a feature diagnostic. */
export class DraftError extends Error {}

export type DraftGeometryParameters = Readonly<{
  /** A point on the neutral plane in world millimetres. */
  planeOrigin: readonly [number, number, number]
  /** Unit normal of the neutral plane. */
  planeNormal: readonly [number, number, number]
  /** Unit pull direction; the selected faces narrow the body along it for a positive angle. */
  pullDirection: readonly [number, number, number]
  /** Draft angle in radians, at least 0.01 degrees and less than 89 degrees. */
  angle: number
}>

type OwnedBinding = { delete(): unknown }
// Draft_ErrorStatus is unbound in the pinned WASM build, so AddDone/IsDone are the only signals.
function requireDraftParameters(parameters: DraftGeometryParameters, faceCount: number) {
  if (!(parameters.angle >= DRAFT_MIN_ANGLE_RADIANS && parameters.angle < DRAFT_MAX_ANGLE_RADIANS))
    throw new DraftError("Draft angle must be at least 0.01 degrees and less than 89 degrees.")
  if (faceCount < 1 || faceCount > 256) throw new DraftError("Draft requires 1 to 256 faces.")
  for (const vector of [parameters.planeNormal, parameters.pullDirection]) {
    if (Math.abs(Math.hypot(...vector) - 1) > 1e-6)
      throw new DraftError("Draft directions must be unit vectors.")
  }
}

function requireSourceSolid(occt: OpenCascadeInstance, source: Shape3D) {
  const metrics = inspectOcctBody(occt, source)
  if (!featureResultMetricsAreValid(metrics, 1))
    throw new DraftError("Draft requires one valid exact solid body.")
}

/**
 * Tilts the selected exact faces about their intersection with the neutral plane. Every selected
 * face must be accepted by OCCT; a rejected face fails the whole feature instead of being skipped.
 */
export function draftOcctShape(
  occt: OpenCascadeInstance,
  source: Shape3D,
  faceKeys: readonly number[],
  parameters: DraftGeometryParameters,
): Shape3D {
  requireDraftParameters(parameters, faceKeys.length)
  if (new Set(faceKeys).size !== faceKeys.length)
    throw new DraftError("Draft faces must be distinct.")
  requireSourceSolid(occt, source)
  const owned: OwnedBinding[] = []
  const own = <T extends OwnedBinding>(value: T) => {
    owned.push(value)
    return value
  }
  const faces = source.faces
  try {
    const byKey = new Map(faces.map((face) => [face.hashCode, face]))
    if (byKey.size !== faces.length)
      throw new DraftError("Draft encountered ambiguous native face topology.")
    const origin = own(new occt.gp_Pnt_3(...parameters.planeOrigin))
    const normal = own(new occt.gp_Dir_4(...parameters.planeNormal))
    const plane = own(new occt.gp_Pln_3(origin, normal))
    const pull = own(new occt.gp_Dir_4(...parameters.pullDirection))
    const builder = own(new occt.BRepOffsetAPI_DraftAngle_2(source.wrapped))
    faceKeys.forEach((key, index) => {
      const face = byKey.get(key)
      if (!face) throw new DraftError(`Draft face ${index + 1} is missing from the exact body.`)
      builder.Add(face.wrapped, pull, parameters.angle, plane, true)
      if (!builder.AddDone())
        throw new DraftError(
          `Draft cannot tilt selected face ${index + 1} or a face tangent to it. Blends that ` +
            "run across the pull direction, such as fillets around a top face, and faces " +
            "perpendicular to it cannot be drafted; draft before adding those fillets.",
        )
    })
    const progress = own(new occt.Message_ProgressRange_1())
    builder.Build(progress)
    if (!builder.IsDone())
      throw new DraftError(
        "Draft could not rebuild the faces next to the drafted faces. Reduce the angle or select fewer faces.",
      )
    const result = adoptOcctShape(builder.Shape(), castOcctShape)
    try {
      const metrics = inspectOcctBody(occt, result)
      if (!featureResultMetricsAreValid(metrics, 1))
        throw new DraftError(
          "Draft produced an invalid or split solid. Reduce the angle or move the neutral plane.",
        )
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const face of faces) face.delete()
    for (const value of owned.reverse()) value.delete()
  }
}
