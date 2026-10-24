import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentNodeRef,
} from "@vibeshape/domain/document-graph"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"

type RebuiltDocument = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

/** Rebuild changed descendants and their inputs; retain the full path for opaque dependencies. */
export function scopeFeaturePreviewDocument(
  document: DocumentSnapshot,
  candidateId: FeatureRecord["id"],
): DocumentSnapshot {
  const result = createDocumentDependencyGraphFromSnapshot(document)
  if (!result.ok || result.graph.dependencyModelIssues.length > 0) return document
  const { graph } = result
  const affected: DocumentNodeRef[] = [{ kind: "feature", id: candidateId }]
  const keys = new Set<string>([`feature:${candidateId}`])
  const append = (refs: readonly DocumentNodeRef[], queue: DocumentNodeRef[]) => {
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`
      if (keys.has(key)) continue
      keys.add(key)
      queue.push(ref)
    }
  }
  for (let index = 0; index < affected.length; index++) {
    const ref = affected[index]
    if (ref) append(graph.dependentsOf(ref), affected)
  }
  const required = [...affected]
  for (let index = 0; index < required.length; index++) {
    const ref = required[index]
    if (ref) append(graph.dependenciesOf(ref), required)
  }
  return {
    ...document,
    features: document.features.filter(({ id }) => keys.has(`feature:${id}`)),
    sketches: document.sketches.filter(({ id }) => keys.has(`sketch:${id}`)),
  }
}

/** Scoped evaluation replaces every requested record, including failures and suppressed outputs. */
export function completeFeaturePreviewResponse(
  document: DocumentSnapshot,
  response: RebuiltDocument,
  committed: RebuiltDocument,
): RebuiltDocument {
  const rebuilt = new Set<string>(document.features.map(({ id }) => id))
  return {
    ...response,
    evaluation: {
      ...response.evaluation,
      records: [
        ...committed.evaluation.records.filter(({ featureId }) => !rebuilt.has(featureId)),
        ...response.evaluation.records,
      ],
    },
    geometry: [
      ...committed.geometry.filter(({ featureId }) => !rebuilt.has(featureId)),
      ...response.geometry,
    ],
  }
}
