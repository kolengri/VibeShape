export type ViewerSketchReferenceIdentity =
  | Readonly<{ kind?: "point"; sourcePointId: string; sourceSketchId: string }>
  | Readonly<{ kind: "line"; sourceLineId: string; sourceSketchId: string }>
  | Readonly<{ kind: "curve"; sourceEntityId: string; sourceSketchId: string }>
  | Readonly<{
      kind: "model-point" | "model-line" | "model-curve"
      candidateId: string
      featureId: string
    }>

export function viewerSketchReferenceCandidateKey(candidate: ViewerSketchReferenceIdentity): string
export function viewerSketchReferenceCandidateKey(candidate: null): null
export function viewerSketchReferenceCandidateKey(
  candidate: ViewerSketchReferenceIdentity | null,
): string | null
export function viewerSketchReferenceCandidateKey(
  candidate: ViewerSketchReferenceIdentity | null,
): string | null {
  if (!candidate) return null
  if ("featureId" in candidate) {
    return `${candidate.kind}:${candidate.featureId}:${candidate.candidateId}`
  }
  const entityId =
    candidate.kind === "line"
      ? candidate.sourceLineId
      : candidate.kind === "curve"
        ? candidate.sourceEntityId
        : candidate.sourcePointId
  return `${candidate.sourceSketchId}:${entityId}`
}
