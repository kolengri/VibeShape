import type { SketchEntityId, SketchRecord } from "@vibeshape/domain"

export type ExternalSketchPointCandidate = Readonly<{
  label: string
  sourcePointId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  x: number
  y: number
}>

export function externalSketchPointCandidates(
  sketches: readonly SketchRecord[],
  draft: SketchRecord,
): readonly ExternalSketchPointCandidate[] {
  const draftIndex = sketches.findIndex((sketch) => sketch.id === draft.id)
  const sources = sketches.slice(0, draftIndex >= 0 ? draftIndex : undefined)
  return sources.flatMap((source) => externalPointsFromSketch(source, draft))
}

function externalPointsFromSketch(
  source: SketchRecord,
  draft: SketchRecord,
): readonly ExternalSketchPointCandidate[] {
  if (!isCompatibleExternalPointSource(source, draft)) return []
  return source.entities.flatMap((entity): ExternalSketchPointCandidate[] => {
    if (entity.type !== "point") return []
    return [
      {
        label: `${source.label} · Point`,
        sourcePointId: entity.id,
        sourceSketchId: source.id,
        x: entity.x,
        y: entity.y,
      },
    ]
  })
}

function isCompatibleExternalPointSource(source: SketchRecord, draft: SketchRecord) {
  return (
    source.plane === draft.plane &&
    JSON.stringify(source.support ?? null) === JSON.stringify(draft.support ?? null) &&
    (source.externalReferences?.length ?? 0) === 0
  )
}
