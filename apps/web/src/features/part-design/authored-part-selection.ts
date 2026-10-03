import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { PartId } from "@vibeshape/domain/identifiers"

/** Authoring new features uses a visible current tip, never an upstream fallback or consumed part. */
export function authoredPlacementTarget(
  resolved: ResolvedAuthoredPart | undefined,
): BodyReference | null {
  if (resolved?.status !== "available" || !resolved.part.visible) return null
  const body = resolved.body
  return body &&
    body.representation !== "triangle-mesh" &&
    body.shape.valid &&
    body.shape.solidCount === 1 &&
    body.shape.volume > 0
    ? { schemaVersion: 0, featureId: body.featureId, outputRole: body.outputRole ?? "result" }
    : null
}

/** Resolves only an unambiguous current part; historical and aggregate selections stay ineligible. */
export function selectedPlacementPart(
  parts: readonly ResolvedAuthoredPart[],
  partId: PartId | null,
  body: { featureId: string; outputRole?: string } | null,
): ResolvedAuthoredPart | undefined {
  if (partId)
    return parts.find(
      (resolved) => resolved.part.id === partId && authoredPlacementTarget(resolved),
    )
  if (!body) return undefined
  const matches = parts.filter((resolved) => {
    const target = authoredPlacementTarget(resolved)
    return (
      target?.featureId === body.featureId && target.outputRole === (body.outputRole ?? "result")
    )
  })
  return matches.length === 1 ? matches[0] : undefined
}
