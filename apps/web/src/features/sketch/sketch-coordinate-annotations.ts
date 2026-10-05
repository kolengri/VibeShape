import type { SketchEntity, SketchPoint2, SketchRecord } from "@vibeshape/domain"

/** Coordinate dimensions use a fixed construction origin, rather than an arbitrary point pair. */
export function sketchCoordinateDimensionPoint(
  constraint: SketchRecord["constraints"][number],
  entities: ReadonlyMap<string, SketchEntity>,
  fixedPointIds: ReadonlySet<string>,
) {
  if (constraint.type !== "horizontal-distance" && constraint.type !== "vertical-distance")
    return null
  const originId = [constraint.firstPointId, constraint.secondPointId].find((id) => {
    const entity = entities.get(id)
    return (
      entity?.type === "point" &&
      entity.construction &&
      fixedPointIds.has(id) &&
      entity.x === 0 &&
      entity.y === 0
    )
  })
  if (!originId) return null
  return originId === constraint.firstPointId ? constraint.secondPointId : constraint.firstPointId
}

export type CoordinateAnnotation = Readonly<{
  id: string
  pointId: string
  anchor: SketchPoint2
  label: string
  axis: "horizontal" | "vertical"
}>

export type CoordinateAnnotationPlacement = Readonly<{
  left: number
  top: number
  width: number
  leaderX: number
  leaderY: number
}>

type AnnotationViewport = Readonly<{ width: number; height: number }>

function coordinateAnchorVisible(anchor: SketchPoint2, viewport: AnnotationViewport) {
  return anchor.x >= 0 && anchor.x <= viewport.width && anchor.y >= 0 && anchor.y <= viewport.height
}

function coordinateAnnotationPlacement(
  annotation: CoordinateAnnotation,
  viewport: AnnotationViewport,
): CoordinateAnnotationPlacement {
  const { anchor } = annotation
  const width = Math.min(320, annotation.label.length * 7 + 12, Math.max(1, viewport.width - 16))
  const leftSide = anchor.x < viewport.width / 2
  const preferredLeft = leftSide ? anchor.x - width - 16 : anchor.x + 16
  const alternateLeft = leftSide ? anchor.x + 16 : anchor.x - width - 16
  const preferredFits = preferredLeft >= 8 && preferredLeft + width <= viewport.width - 8
  const left = preferredFits
    ? preferredLeft
    : Math.max(8, Math.min(viewport.width - width - 8, alternateLeft))
  const top = coordinateAnnotationTop(annotation, viewport.height)
  return {
    left,
    top,
    width,
    leaderX: Math.max(left, Math.min(left + width, anchor.x)),
    leaderY: Math.max(top - 12, Math.min(top + 12, anchor.y)),
  }
}

function coordinateAnnotationTop(annotation: CoordinateAnnotation, height: number) {
  const horizontal = annotation.axis === "horizontal"
  if (annotation.anchor.y < 40) return annotation.anchor.y + (horizontal ? 18 : 54)
  if (annotation.anchor.y > height - 40) return annotation.anchor.y - (horizontal ? 54 : 18)
  return annotation.anchor.y + (horizontal ? -18 : 18)
}

/** Stable screen-space offsets preserve the relationship to the point while the camera moves. */
export function layoutSketchCoordinateAnnotations(
  annotations: readonly CoordinateAnnotation[],
  viewport: AnnotationViewport,
) {
  const placements = new Map<string, CoordinateAnnotationPlacement>()
  if (viewport.width <= 0 || viewport.height <= 0) return placements
  for (const annotation of annotations.filter(({ anchor }) =>
    coordinateAnchorVisible(anchor, viewport),
  )) {
    placements.set(annotation.id, coordinateAnnotationPlacement(annotation, viewport))
  }
  return placements
}
