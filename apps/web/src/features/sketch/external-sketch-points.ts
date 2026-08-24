import { projectSketchPointBetweenFrames, sketchFrame } from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchEntityId,
  SketchRecord,
} from "@vibeshape/domain"
import { appendSketchConstraint } from "@vibeshape/domain"
import {
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
  createBrowserSketchExternalReferenceId,
} from "../../document/document-controller"

export type ExternalSketchPointCandidate = Readonly<{
  label: string
  sourcePointId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  world: readonly [number, number, number]
  x: number
  y: number
}>

function referenceMatchesCandidate(
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
  candidate: ExternalSketchPointCandidate,
) {
  return (
    reference.sourceSketchId === candidate.sourceSketchId &&
    reference.sourcePointId === candidate.sourcePointId
  )
}

function attachProjectedPoint(
  sketch: SketchRecord,
  projectedPointId: SketchEntityId,
  selectedEntityIds: readonly SketchEntityId[],
) {
  if (selectedEntityIds.length !== 1) return sketch
  const selected = sketch.entities.find(({ id }) => id === selectedEntityIds[0])
  if (selected?.type !== "point") return sketch
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "coincident" &&
      ((constraint.firstPointId === selected.id && constraint.secondPointId === projectedPointId) ||
        (constraint.firstPointId === projectedPointId && constraint.secondPointId === selected.id)),
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "coincident", firstPointId: selected.id, secondPointId: projectedPointId },
        createBrowserSketchConstraintId,
      )
}

export function applyExternalSketchPointCandidate(
  draft: SketchRecord,
  candidate: ExternalSketchPointCandidate,
  selectedEntityIds: readonly SketchEntityId[],
) {
  const references = draft.externalReferences ?? []
  if (references.some((reference) => referenceMatchesCandidate(reference, candidate))) return draft
  const projectedPointId = createBrowserSketchEntityId()
  return attachProjectedPoint(
    {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          id: createBrowserSketchExternalReferenceId(),
          sourceSketchId: candidate.sourceSketchId,
          sourcePointId: candidate.sourcePointId,
          projectedPointId,
        },
      ],
    },
    projectedPointId,
    selectedEntityIds,
  )
}

export function externalSketchPointCandidates(
  document: DocumentSnapshot,
  draft: SketchRecord,
  features: readonly FeatureRecord[] = document.features,
): readonly ExternalSketchPointCandidate[] {
  const targetFrame = sketchFrame(draft, document, features)
  if (!targetFrame) return []
  const draftIndex = document.sketches.findIndex((sketch) => sketch.id === draft.id)
  const sources = document.sketches.slice(0, draftIndex >= 0 ? draftIndex : undefined)
  return sources.flatMap((source) =>
    externalPointsFromSketch(source, document, features, targetFrame),
  )
}

function externalPointsFromSketch(
  source: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  targetFrame: NonNullable<ReturnType<typeof sketchFrame>>,
): readonly ExternalSketchPointCandidate[] {
  if ((source.externalReferences?.length ?? 0) > 0) return []
  const sourceFrame = sketchFrame(source, document, features)
  if (!sourceFrame) return []
  return source.entities.flatMap((entity): ExternalSketchPointCandidate[] => {
    if (entity.type !== "point") return []
    const projected = projectSketchPointBetweenFrames(sourceFrame, targetFrame, entity)
    return [
      {
        label: `${source.label} · Point`,
        sourcePointId: entity.id,
        sourceSketchId: source.id,
        world: projected.world,
        ...projected.local,
      },
    ]
  })
}
