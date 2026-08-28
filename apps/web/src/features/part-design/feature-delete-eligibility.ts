import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentGraphDependencyBlocker,
  type DocumentSnapshot,
  type FeatureRecord,
  isOrphanedModelReference,
  isSketchExternalModelReference,
  type SketchExternalModelReference,
  type SketchExternalReferenceId,
  type SketchId,
} from "@vibeshape/domain"

export const FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT = 8

export type FeatureDeleteEligibility = Readonly<{
  blockers: readonly DocumentGraphDependencyBlocker[]
  blockerCount: number
  preservableReferences: readonly Readonly<{
    kind: SketchExternalModelReference["kind"]
    referenceId: SketchExternalReferenceId
    sketchId: SketchId
  }>[]
  preservableReferenceCount: number
  preserveIntentAllowed: boolean
  unavailable: boolean
}>

export function featureDeleteEligibility(
  snapshot: DocumentSnapshot,
  featureId: FeatureRecord["id"],
): FeatureDeleteEligibility {
  const result = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!result.ok || result.graph.dependencyModelIssues.length > 0) {
    return {
      blockers: [],
      blockerCount: 0,
      preservableReferences: [],
      preservableReferenceCount: 0,
      preserveIntentAllowed: false,
      unavailable: true,
    }
  }
  const blockers = result.graph.deletionBlockersFor({ kind: "feature", id: featureId })
  const preservableReferences = snapshot.sketches.flatMap((sketch) =>
    (sketch.externalReferences ?? []).flatMap((reference) =>
      isSketchExternalModelReference(reference) &&
      !isOrphanedModelReference(reference) &&
      reference.reference.featureId === featureId
        ? [{ kind: reference.kind, referenceId: reference.id, sketchId: sketch.id }]
        : [],
    ),
  )
  const preservableSketchIds = new Set(preservableReferences.map(({ sketchId }) => sketchId))
  const preserveIntentAllowed =
    blockers.length > 0 &&
    blockers.every(
      (blocker) =>
        blocker.relation === "feature-topology-reference" &&
        blocker.dependent.kind === "sketch" &&
        preservableSketchIds.has(blocker.dependent.id),
    )
  return {
    blockers: blockers.slice(0, FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT),
    blockerCount: blockers.length,
    preservableReferences: preservableReferences.slice(0, FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT),
    preservableReferenceCount: preservableReferences.length,
    preserveIntentAllowed,
    unavailable: false,
  }
}
