import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { BodyReference } from "@vibeshape/domain/body-reference"

/** Authoring new features uses a visible current tip, never an upstream fallback or consumed part. */
export function authoredPlacementTarget(
  resolved: ResolvedAuthoredPart | undefined,
): BodyReference | null {
  if (resolved?.status !== "available" || !resolved.part.visible) return null
  const body = resolved.body
  return body
    ? { schemaVersion: 0, featureId: body.featureId, outputRole: body.outputRole ?? "result" }
    : null
}
