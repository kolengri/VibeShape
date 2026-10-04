import type { ShellFeatureContentParameters } from "@vibeshape/protocol"
import type { Face, Shape3D } from "replicad"
import type { TopologyCaptureSnapshot } from "./topology-signatures"

export type BodyFaceResolver = (
  references: ShellFeatureContentParameters["openings"],
  candidates: readonly TopologyCaptureSnapshot["candidates"][number][],
  scope: { featureId: string; outputRole: string },
) =>
  | { ok: true; candidateIds: readonly string[] }
  | { ok: false; reason: "missing" | "ambiguous" | "changed" | "duplicate" }

/** Resolves persisted body topology first, then transfers one current native face wrapper. */
export function takeResolvedBodyFace(
  target: Shape3D,
  snapshot: TopologyCaptureSnapshot,
  reference: ShellFeatureContentParameters["openings"][number],
  scope: { featureId: string; outputRole: string },
  resolve: BodyFaceResolver,
): Face {
  const resolved = resolve([reference], snapshot.candidates, scope)
  if (!resolved.ok || resolved.candidateIds.length !== 1)
    throw new Error("The selected body face is unavailable or ambiguous.")
  const id = resolved.candidateIds[0] ?? ""
  const key = snapshot.transientShapeKeys.get(id)
  if (!id.startsWith("face:") || key === undefined)
    throw new Error("The selected face is missing from its exact body.")
  const faces = target.faces
  const matches = faces.filter((face) => face.hashCode === key)
  const result = matches.length === 1 ? matches[0] : undefined
  for (const face of faces) if (face !== result) face.delete()
  if (!result) throw new Error("The current native face is missing or ambiguous.")
  return result
}
