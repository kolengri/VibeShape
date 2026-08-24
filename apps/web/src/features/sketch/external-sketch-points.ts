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

type ProjectedSketchPoint = Readonly<{
  world: readonly [number, number, number]
  x: number
  y: number
}>

export type ExternalSketchPointCandidate = Readonly<{
  kind: "point"
  label: string
  sourcePointId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
}> &
  ProjectedSketchPoint

export type ExternalSketchLineCandidate = Readonly<{
  kind: "line"
  label: string
  sourceLineId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  start: ProjectedSketchPoint
  end: ProjectedSketchPoint
}>

export type ExternalSketchGeometryCandidate =
  | ExternalSketchPointCandidate
  | ExternalSketchLineCandidate

export type ExternalSketchGeometryLabels = Readonly<{
  line: (sourceLabel: string, ordinal: number) => string
  point: (sourceLabel: string, ordinal: number) => string
}>

export function externalReferenceMatchesCandidate(
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
  candidate: ExternalSketchGeometryCandidate,
) {
  if (
    reference.sourceSketchId !== candidate.sourceSketchId ||
    (reference.kind ?? "point") !== candidate.kind
  ) {
    return false
  }
  return candidate.kind === "line"
    ? reference.kind === "line" && reference.sourceLineId === candidate.sourceLineId
    : reference.kind !== "line" && reference.sourcePointId === candidate.sourcePointId
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

export function applyExternalSketchCandidate(
  draft: SketchRecord,
  candidate: ExternalSketchGeometryCandidate,
  selectedEntityIds: readonly SketchEntityId[],
): SketchRecord {
  const references = draft.externalReferences ?? []
  if (references.some((reference) => externalReferenceMatchesCandidate(reference, candidate))) {
    return draft
  }
  if (candidate.kind === "line") {
    return {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          id: createBrowserSketchExternalReferenceId(),
          kind: "line",
          sourceSketchId: candidate.sourceSketchId,
          sourceLineId: candidate.sourceLineId,
          projectedLineId: createBrowserSketchEntityId(),
          projectedStartPointId: createBrowserSketchEntityId(),
          projectedEndPointId: createBrowserSketchEntityId(),
        },
      ],
    }
  }
  const projectedPointId = createBrowserSketchEntityId()
  return attachProjectedPoint(
    {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          kind: "point",
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

export function externalSketchGeometryCandidates(
  document: DocumentSnapshot,
  draft: SketchRecord,
  labels: ExternalSketchGeometryLabels,
  features: readonly FeatureRecord[] = document.features,
): readonly ExternalSketchGeometryCandidate[] {
  const targetFrame = sketchFrame(draft, document, features)
  if (!targetFrame) return []
  const draftIndex = document.sketches.findIndex((sketch) => sketch.id === draft.id)
  const sources = document.sketches.slice(0, draftIndex >= 0 ? draftIndex : undefined)
  return sources.flatMap((source) =>
    externalGeometryFromSketch(source, document, features, targetFrame, labels),
  )
}

function externalGeometryFromSketch(
  source: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  targetFrame: NonNullable<ReturnType<typeof sketchFrame>>,
  labels: ExternalSketchGeometryLabels,
): readonly ExternalSketchGeometryCandidate[] {
  if ((source.externalReferences?.length ?? 0) > 0) return []
  const sourceFrame = sketchFrame(source, document, features)
  if (!sourceFrame) return []
  const points = new Map(
    source.entities.flatMap((entity) =>
      entity.type === "point" ? ([[entity.id, entity]] as const) : [],
    ),
  )
  let pointOrdinal = 0
  let lineOrdinal = 0
  return source.entities.flatMap((entity): ExternalSketchGeometryCandidate[] => {
    if (entity.type === "point") {
      pointOrdinal += 1
      const projected = projectSketchPointBetweenFrames(sourceFrame, targetFrame, entity)
      return [
        {
          kind: "point",
          label: labels.point(source.label, pointOrdinal),
          sourcePointId: entity.id,
          sourceSketchId: source.id,
          world: projected.world,
          ...projected.local,
        },
      ]
    }
    if (entity.type !== "line") return []
    lineOrdinal += 1
    const sourceStart = points.get(entity.startPointId)
    const sourceEnd = points.get(entity.endPointId)
    if (!sourceStart || !sourceEnd) return []
    const start = projectSketchPointBetweenFrames(sourceFrame, targetFrame, sourceStart)
    const end = projectSketchPointBetweenFrames(sourceFrame, targetFrame, sourceEnd)
    if (Math.hypot(end.local.x - start.local.x, end.local.y - start.local.y) <= 1e-9) return []
    return [
      {
        kind: "line",
        label: labels.line(source.label, lineOrdinal),
        sourceLineId: entity.id,
        sourceSketchId: source.id,
        start: { world: start.world, ...start.local },
        end: { world: end.world, ...end.local },
      },
    ]
  })
}
