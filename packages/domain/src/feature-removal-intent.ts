import type { DocumentGraphDependencyBlocker } from "./document-graph"
import type { FeatureRecord } from "./feature-graph"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  type SketchRecord,
  sketchRecordSchema,
} from "./sketch"

export function preservableModelReferenceSketchIds(
  sketches: readonly SketchRecord[],
  featureId: FeatureRecord["id"],
) {
  return new Set(
    sketches
      .filter((sketch) =>
        sketch.externalReferences?.some(
          (reference) =>
            isSketchExternalModelReference(reference) &&
            !isOrphanedModelReference(reference) &&
            reference.reference.featureId === featureId,
        ),
      )
      .map(({ id }) => id),
  )
}

export function unsupportedPreservingIntentBlockers(
  blockers: readonly DocumentGraphDependencyBlocker[],
  preservableSketchIds: ReadonlySet<string>,
) {
  return blockers.filter(
    (blocker) =>
      blocker.relation !== "feature-topology-reference" ||
      blocker.dependent.kind !== "sketch" ||
      !preservableSketchIds.has(blocker.dependent.id),
  )
}

export function orphanModelReferencesToFeature(
  sketch: SketchRecord,
  featureId: FeatureRecord["id"],
) {
  return sketchRecordSchema.parse({
    ...sketch,
    externalReferences: sketch.externalReferences?.map((reference) =>
      isSketchExternalModelReference(reference) &&
      !isOrphanedModelReference(reference) &&
      reference.reference.featureId === featureId
        ? {
            ...reference,
            schemaVersion: 1 as const,
            orphanedSource: { kind: "deleted-feature" as const, featureId },
          }
        : reference,
    ),
  })
}
