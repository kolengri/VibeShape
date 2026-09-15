import {
  createTopologyReferenceResolver,
  type EdgeTopoRef,
  featureIdSchema,
  type TopologyCandidate,
  topologyCandidateSchema,
} from "@vibeshape/domain"
import { createEdgeReferenceProjector } from "@vibeshape/domain/model-edges"

type WireCandidate = TopologyCandidate &
  Readonly<{ edgePolyline?: readonly [number, number, number][] | undefined }>
export type EdgeTreatmentGeometry = Readonly<{
  featureId: string
  geometry: Readonly<{ topologyCandidates: readonly WireCandidate[] }>
}>

export type SelectedEdgeCandidate = Readonly<{
  candidateId: string
  label: string
  reference: EdgeTopoRef
  candidate: TopologyCandidate
  edgePolyline: readonly [number, number, number][] | undefined
}>

export function selectedEdgeCandidates(
  geometry: readonly EdgeTreatmentGeometry[],
  targetFeatureId: string,
  label: (ordinal: number) => string,
): readonly SelectedEdgeCandidate[] {
  const parsedTarget = featureIdSchema.safeParse(targetFeatureId)
  const record = parsedTarget.success
    ? geometry.find(({ featureId }) => featureId === targetFeatureId)
    : undefined
  if (!record || !parsedTarget.success) return []
  const edges = record.geometry.topologyCandidates.filter(({ kind }) => kind === "edge")
  const projectReference = createEdgeReferenceProjector(parsedTarget.data, edges)
  return edges.map((candidate, index) => {
    const domainCandidate = topologyCandidateSchema.parse({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      ...(candidate.meshFaceId === undefined ? {} : { meshFaceId: candidate.meshFaceId }),
      ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
      lineageTokens: candidate.lineageTokens,
      signature: candidate.signature,
    })
    const edgePolyline = candidate.edgePolyline
    return {
      candidateId: candidate.candidateId,
      label: label(index + 1),
      reference: projectReference(domainCandidate),
      candidate: domainCandidate,
      edgePolyline,
    }
  })
}

/** Toggle the resolved current edge, preserving other unresolved authored references for repair. */
export function toggleSelectedEdgeReference(
  references: readonly EdgeTopoRef[],
  picked: EdgeTopoRef,
  candidates: readonly SelectedEdgeCandidate[],
): readonly EdgeTopoRef[] {
  const owner = candidates[0]?.reference.featureId
  if (
    !owner ||
    picked.featureId !== owner ||
    references.some((reference) => reference.featureId !== owner)
  )
    return references
  const resolve = createTopologyReferenceResolver(candidates.map(({ candidate }) => candidate))
  const chosen = resolve(picked)
  if (chosen.status !== "resolved") return references
  const remaining = references.filter((reference) => {
    const result = resolve(reference)
    return result.status !== "resolved" || result.candidateId !== chosen.candidateId
  })
  if (remaining.length !== references.length) return remaining
  return references.length < 256 ? [...references, picked] : references
}
