import type { DocumentSnapshot, SketchEntityId } from "@vibeshape/domain"
import {
  sketchProfileSelectorKey,
  sketchProfileSelectorSchema,
} from "@vibeshape/domain/sketch-profile-selector"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import type { PathSketchOption, ProfileOption, SweepLoftOperation } from "./sweep-loft-form-model"

type SketchDisplay = Extract<
  DocumentWorkerResponse,
  { type: "documentRebuilt" }
>["sketches"][number]
export type SweepLoftCatalogueCopy = Readonly<{
  profile: (sketch: string, number: number) => string
  curve: (
    kind: "line" | "arc" | "circle" | "cubic-bezier" | "elliptical-arc",
    number: number,
  ) => string
  point: (number: number, position: readonly [number, number, number]) => string
}>
type Entity = DocumentSnapshot["sketches"][number]["entities"][number]
type SolvedPoints = ReadonlyMap<string, unknown>

function openCurveOption(
  entity: Entity,
  index: number,
  pointsById: SolvedPoints,
  copy: SweepLoftCatalogueCopy,
) {
  if (
    entity.construction ||
    (entity.type !== "line" &&
      entity.type !== "arc" &&
      entity.type !== "cubic-bezier" &&
      entity.type !== "elliptical-arc") ||
    !pointsById.has(entity.startPointId) ||
    !pointsById.has(entity.endPointId)
  )
    return null
  return {
    id: entity.id,
    label: copy.curve(entity.type, index + 1),
    startPointId: entity.startPointId,
    endPointId: entity.endPointId,
  }
}

/** A circle's center point stands in for both endpoints and names its angle-zero start. */
function circleCurveOption(
  entity: Entity,
  index: number,
  pointsById: SolvedPoints,
  copy: SweepLoftCatalogueCopy,
) {
  if (entity.type !== "circle" || entity.construction || !pointsById.has(entity.centerPointId))
    return null
  return {
    id: entity.id,
    label: copy.curve("circle", index + 1),
    startPointId: entity.centerPointId,
    endPointId: entity.centerPointId,
  }
}

export function sweepLoftCatalogue(
  snapshot: DocumentSnapshot,
  displays: readonly SketchDisplay[],
  excludedIds: readonly string[],
  _operation: SweepLoftOperation,
  copy: SweepLoftCatalogueCopy,
  /** Path Pattern accepts a lone circle; its center point names the angle-zero start. */
  includeCircles = false,
) {
  const excluded = new Set(excludedIds)
  const byId = new Map(snapshot.sketches.map((sketch) => [String(sketch.id), sketch]))
  const profiles: ProfileOption[] = []
  const paths: PathSketchOption[] = []
  for (const display of displays) {
    const sketch = byId.get(display.sketchId)
    if (!sketch || excluded.has(sketch.id)) continue
    profiles.push(
      ...display.profiles.map(({ selector: wireSelector }, index) => {
        const selector = sketchProfileSelectorSchema.parse(wireSelector)
        return {
          selector,
          key: sketchProfileSelectorKey(selector),
          label: copy.profile(sketch.label, index + 1),
        }
      }),
    )
    const pointsById = new Map(
      display.solvedPoints?.map(({ entityId, position }) => [entityId, position]) ?? [],
    )
    const curves = sketch.entities.flatMap((entity, index) => {
      const option =
        (includeCircles ? circleCurveOption(entity, index, pointsById, copy) : null) ??
        openCurveOption(entity, index, pointsById, copy)
      return option ? [option] : []
    })
    if (!curves.length) continue
    const endpointIds = new Set<SketchEntityId>(
      curves.flatMap(({ startPointId, endPointId }) => [startPointId, endPointId]),
    )
    const points = [...endpointIds].flatMap((id, index) => {
      const position = pointsById.get(id)
      return position ? [{ id, label: copy.point(index + 1, position) }] : []
    })
    paths.push({ sketch, curves, points })
  }
  return {
    profiles,
    paths,
  }
}
