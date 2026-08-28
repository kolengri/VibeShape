import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentGraphDependencyBlocker,
  type DocumentSnapshot,
  type FeatureRecord,
} from "@vibeshape/domain"

export const FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT = 8

export type FeatureDeleteEligibility = Readonly<{
  blockers: readonly DocumentGraphDependencyBlocker[]
  blockerCount: number
  unavailable: boolean
}>

export function featureDeleteEligibility(
  snapshot: DocumentSnapshot,
  featureId: FeatureRecord["id"],
): FeatureDeleteEligibility {
  const result = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!result.ok || result.graph.dependencyModelIssues.length > 0) {
    return { blockers: [], blockerCount: 0, unavailable: true }
  }
  const blockers = result.graph.deletionBlockersFor({ kind: "feature", id: featureId })
  return {
    blockers: blockers.slice(0, FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT),
    blockerCount: blockers.length,
    unavailable: false,
  }
}
