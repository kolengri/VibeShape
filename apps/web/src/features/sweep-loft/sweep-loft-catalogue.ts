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
  curve: (kind: "line" | "arc", number: number) => string
  point: (number: number, position: readonly [number, number, number]) => string
}>
export function sweepLoftCatalogue(
  snapshot: DocumentSnapshot,
  displays: readonly SketchDisplay[],
  excludedIds: readonly string[],
  operation: SweepLoftOperation,
  copy: SweepLoftCatalogueCopy,
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
      if (
        entity.construction ||
        (entity.type !== "line" && entity.type !== "arc") ||
        !pointsById.has(entity.startPointId) ||
        !pointsById.has(entity.endPointId)
      )
        return []
      return [
        {
          id: entity.id,
          label: copy.curve(entity.type, index + 1),
          startPointId: entity.startPointId,
          endPointId: entity.endPointId,
        },
      ]
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
    profiles:
      operation === "loft"
        ? profiles.filter(({ selector }) => selector.holeBoundaryEntityIds.length === 0)
        : profiles,
    paths,
  }
}
