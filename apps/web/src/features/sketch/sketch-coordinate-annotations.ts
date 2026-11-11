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

/** Viewport-relative rectangle left free by floating workspace panels. */
export type CoordinateAnnotationRegion = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const annotationMargin = 8
const annotationHalfHeight = 12

function coordinateAnchorVisible(anchor: SketchPoint2, viewport: AnnotationViewport) {
  return anchor.x >= 0 && anchor.x <= viewport.width && anchor.y >= 0 && anchor.y <= viewport.height
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** Panels cover part of the canvas; a region that leaves no room falls back to the whole canvas. */
function annotationRegion(
  viewport: AnnotationViewport,
  free: CoordinateAnnotationRegion | undefined,
): CoordinateAnnotationRegion {
  const whole = { left: 0, top: 0, right: viewport.width, bottom: viewport.height }
  if (!free) return whole
  const region = {
    left: clamp(free.left, 0, viewport.width),
    top: clamp(free.top, 0, viewport.height),
    right: clamp(free.right, 0, viewport.width),
    bottom: clamp(free.bottom, 0, viewport.height),
  }
  const roomy =
    region.right - region.left > 2 * annotationMargin &&
    region.bottom - region.top > 2 * annotationHalfHeight
  return roomy ? region : whole
}

function coordinateAnnotationPlacement(
  annotation: CoordinateAnnotation,
  region: CoordinateAnnotationRegion,
): CoordinateAnnotationPlacement {
  const { anchor } = annotation
  const minimumLeft = region.left + annotationMargin
  const maximumRight = region.right - annotationMargin
  const width = Math.min(
    320,
    annotation.label.length * 7 + 12,
    Math.max(1, maximumRight - minimumLeft),
  )
  const leftSide = anchor.x < (region.left + region.right) / 2
  const preferredLeft = leftSide ? anchor.x - width - 16 : anchor.x + 16
  const alternateLeft = leftSide ? anchor.x + 16 : anchor.x - width - 16
  const preferredFits = preferredLeft >= minimumLeft && preferredLeft + width <= maximumRight
  const left = preferredFits
    ? preferredLeft
    : Math.max(minimumLeft, Math.min(maximumRight - width, alternateLeft))
  const top = clamp(
    coordinateAnnotationTop(annotation, region),
    region.top + annotationHalfHeight,
    region.bottom - annotationHalfHeight,
  )
  return {
    left,
    top,
    width,
    leaderX: Math.max(left, Math.min(left + width, anchor.x)),
    leaderY: Math.max(top - 12, Math.min(top + 12, anchor.y)),
  }
}

function coordinateAnnotationTop(
  annotation: CoordinateAnnotation,
  region: CoordinateAnnotationRegion,
) {
  const horizontal = annotation.axis === "horizontal"
  if (annotation.anchor.y < region.top + 40) return annotation.anchor.y + (horizontal ? 18 : 54)
  if (annotation.anchor.y > region.bottom - 40) return annotation.anchor.y - (horizontal ? 54 : 18)
  return annotation.anchor.y + (horizontal ? -18 : 18)
}

/**
 * Stable screen-space offsets preserve the relationship to the point while the camera moves.
 * Labels stay inside the canvas region the floating panels leave free, so they remain editable.
 */
export function layoutSketchCoordinateAnnotations(
  annotations: readonly CoordinateAnnotation[],
  viewport: AnnotationViewport,
  freeRegion?: CoordinateAnnotationRegion,
) {
  const placements = new Map<string, CoordinateAnnotationPlacement>()
  if (viewport.width <= 0 || viewport.height <= 0) return placements
  const region = annotationRegion(viewport, freeRegion)
  for (const annotation of annotations.filter(({ anchor }) =>
    coordinateAnchorVisible(anchor, viewport),
  )) {
    placements.set(annotation.id, coordinateAnnotationPlacement(annotation, region))
  }
  return placements
}
