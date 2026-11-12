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

const annotationGap = 4

type HorizontalPlacement = Readonly<{ left: number; width: number }>

function coordinateAnnotationColumn(
  annotation: CoordinateAnnotation,
  region: CoordinateAnnotationRegion,
): HorizontalPlacement {
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
  return { left, width }
}

function finishedPlacement(
  annotation: CoordinateAnnotation,
  { left, width }: HorizontalPlacement,
  top: number,
): CoordinateAnnotationPlacement {
  const { anchor } = annotation
  return {
    left,
    top,
    width,
    leaderX: Math.max(left, Math.min(left + width, anchor.x)),
    leaderY: Math.max(top - annotationHalfHeight, Math.min(top + annotationHalfHeight, anchor.y)),
  }
}

/** Shifts a point's stacked labels as one unit; compresses them only when the region is short. */
function stackedTops(tops: readonly number[], low: number, high: number) {
  const first = Math.min(...tops)
  const last = Math.max(...tops)
  if (last - first <= high - low) {
    const shift = first < low ? low - first : last > high ? high - last : 0
    return tops.map((top) => top + shift)
  }
  const spacing = 2 * annotationHalfHeight
  const start = clamp(first, low, high - spacing * (tops.length - 1))
  const order = tops.map((top, index) => ({ top, index })).sort((a, b) => a.top - b.top)
  const placed = [...tops]
  order.forEach(({ index }, rank) => {
    placed[index] = start + rank * spacing
  })
  return placed
}

/** A region too short to stack the labels places them side by side on one row instead. */
function sideBySide(
  columns: readonly HorizontalPlacement[],
  tops: readonly number[],
  region: CoordinateAnnotationRegion,
) {
  const order = tops.map((top, index) => ({ top, index })).sort((a, b) => a.top - b.top)
  const total =
    columns.reduce((sum, { width }) => sum + width, 0) + annotationGap * (columns.length - 1)
  const minimumLeft = region.left + annotationMargin
  const start = Math.max(
    minimumLeft,
    Math.min(region.right - annotationMargin - total, Math.min(...columns.map(({ left }) => left))),
  )
  const placed = [...columns]
  let left = start
  for (const { index } of order) {
    const column = columns[index]
    if (!column) continue
    placed[index] = { left, width: column.width }
    left += column.width + annotationGap
  }
  return placed
}

function coordinateAnnotationGroup(
  group: readonly CoordinateAnnotation[],
  region: CoordinateAnnotationRegion,
) {
  const low = region.top + annotationHalfHeight
  const high = region.bottom - annotationHalfHeight
  const columns = group.map((annotation) => coordinateAnnotationColumn(annotation, region))
  const preferred = group.map((annotation) => coordinateAnnotationTop(annotation, region))
  const stackFits = 2 * annotationHalfHeight * (group.length - 1) <= high - low
  if (stackFits) {
    const tops = stackedTops(preferred, low, high)
    return group.map((annotation, index) =>
      finishedPlacement(annotation, columns[index] as HorizontalPlacement, tops[index] ?? low),
    )
  }
  const row = clamp(preferred.reduce((sum, top) => sum + top, 0) / preferred.length, low, high)
  const placed = sideBySide(columns, preferred, region)
  return group.map((annotation, index) =>
    finishedPlacement(annotation, placed[index] as HorizontalPlacement, row),
  )
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
  // A point's horizontal and vertical labels are clamped together so they never cover each other.
  const groups = new Map<string, CoordinateAnnotation[]>()
  for (const annotation of annotations.filter(({ anchor }) =>
    coordinateAnchorVisible(anchor, viewport),
  )) {
    const group = groups.get(annotation.pointId)
    if (group) group.push(annotation)
    else groups.set(annotation.pointId, [annotation])
  }
  for (const group of groups.values()) {
    coordinateAnnotationGroup(group, region).forEach((placement, index) => {
      const annotation = group[index]
      if (annotation) placements.set(annotation.id, placement)
    })
  }
  return placements
}
