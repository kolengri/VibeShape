import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  type BodyFaceRef,
  bodyFaceRefSchema,
  bodyTopoRefContent,
} from "@vibeshape/domain/body-topology-reference"
import {
  createBodyTopologyReferenceProjector,
  type ModelBodyTopologyEvidence,
} from "@vibeshape/domain/model-body-topology"

/**
 * Restores saved body-bound faces on the current body evidence. Any unresolved or repeated face
 * requires explicit reselection, so a partial selection is never shown as complete.
 */
export function restoreBodyFaceSelection(
  faces: readonly BodyFaceRef[] | undefined,
  target: BodyReference | undefined,
  evidence: ModelBodyTopologyEvidence | null,
  allowSemanticRebinding = true,
): { repair: boolean; faceIds: string[] } {
  if (
    !faces ||
    !target ||
    !evidence ||
    evidence.featureId !== target.featureId ||
    evidence.outputRole !== target.outputRole
  )
    return { repair: true, faceIds: [] }
  const faceIds: string[] = []
  for (const face of faces) {
    const durable = Boolean(face.semanticRole || face.lineageToken)
    const resolved = resolveShellOpeningCandidates(
      [bodyTopoRefContent(face)],
      evidence.candidates,
      evidence,
      durable ? "durable" : "exact",
      { allowSemanticRebinding },
    )
    const id = resolved.ok ? resolved.candidateIds[0] : undefined
    if (!id || faceIds.includes(id)) return { repair: true, faceIds: [] }
    faceIds.push(id)
  }
  return { repair: false, faceIds }
}

/** Projects picked candidates into body-bound references, or null when a pick is stale. */
export function projectBodyFaceSelection(
  evidence: ModelBodyTopologyEvidence,
  faceIds: readonly string[],
  allowSemanticRebinding = true,
): BodyFaceRef[] | null {
  const selected = faceIds.flatMap(
    (id) => evidence.candidates.find(({ candidateId }) => candidateId === id) ?? [],
  )
  if (selected.length !== faceIds.length) return null
  const project = createBodyTopologyReferenceProjector(evidence)
  return selected.map((candidate) => {
    const reference = bodyFaceRefSchema.parse(project(candidate))
    if (allowSemanticRebinding) return reference
    // Modifier Extrusion face roles are heuristic and cannot be persisted as durable identity.
    const { semanticRole: _semanticRole, ...withoutHeuristicRole } = reference
    return withoutHeuristicRole
  })
}

/** Toggles one picked face; returns null when the pick is stale or exceeds the face limit. */
export function toggleBodyFace(
  faceIds: readonly string[],
  candidateId: string,
  evidence: ModelBodyTopologyEvidence | null,
  maximum: number,
): string[] | null {
  if (!evidence?.candidates.some((candidate) => candidate.candidateId === candidateId)) return null
  if (faceIds.includes(candidateId)) return faceIds.filter((id) => id !== candidateId)
  return faceIds.length < maximum ? [...faceIds, candidateId] : null
}
