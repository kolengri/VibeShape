import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import type { SketchEntityId, SketchRecord } from "@vibeshape/domain"
import type { ViewerSketchPointCandidate, ViewerVector3 } from "@vibeshape/viewer/three-viewport"

export type HolePointCandidate = ViewerSketchPointCandidate &
  Readonly<{ sourcePointId: SketchEntityId }>

function finiteViewerPosition(position: readonly number[]): ViewerVector3 | null {
  const [x, y, z] = position
  if (
    position.length !== 3 ||
    x === undefined ||
    y === undefined ||
    z === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  )
    return null
  return [x, y, z]
}

/**
 * Maps only explicit solved authored-point identities to their world positions.
 * Any incomplete or ambiguous display metadata disables graphical Hole picking.
 */
export function holePointCandidates(
  sketch: SketchRecord,
  display: SketchDisplayRecord,
  selectedPointIds: readonly SketchEntityId[],
  label: (ordinal: number, id: SketchEntityId) => string,
): readonly HolePointCandidate[] | null {
  if (display.sketchId !== sketch.id || !Array.isArray(display.solvedPoints)) return null
  const authoredPoints = sketch.entities.filter(
    (entity): entity is Extract<SketchRecord["entities"][number], { type: "point" }> =>
      entity.type === "point",
  )
  if (display.solvedPoints.length !== authoredPoints.length) return null

  const authoredPointsById = new Map<string, (typeof authoredPoints)[number]>(
    authoredPoints.map((point) => [point.id, point]),
  )
  const positionsById = new Map<SketchEntityId, ViewerVector3>()
  for (const solved of display.solvedPoints) {
    const authoredPoint = authoredPointsById.get(solved.entityId)
    if (!authoredPoint || positionsById.has(authoredPoint.id)) return null
    const position = finiteViewerPosition(solved.position)
    if (!position) return null
    positionsById.set(authoredPoint.id, position)
  }
  if (positionsById.size !== authoredPointsById.size) return null

  const selected = new Set(selectedPointIds)
  return authoredPoints.map(({ id }, index) => {
    const position = positionsById.get(id)
    if (!position) throw new Error("Hole point candidates require complete solved-point coverage.")
    return {
      kind: "point" as const,
      label: label(index + 1, id),
      position,
      selected: selected.has(id),
      sourcePointId: id,
      sourceSketchId: sketch.id,
    }
  })
}
