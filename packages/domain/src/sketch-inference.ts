import type { SketchEntityId } from "./identifiers"
import type { SketchPoint2, SketchPointTarget } from "./sketch-edit"

export type SketchInferencePoint = SketchPoint2 & Readonly<{ id: SketchEntityId }>
export type SketchAxisInference = "horizontal" | "vertical"

export type SketchPointInference = Readonly<{
  axis: SketchAxisInference | null
  point: SketchPoint2
  target: SketchPointTarget
}>

function squaredDistance(first: SketchPoint2, second: SketchPoint2) {
  const x = first.x - second.x
  const y = first.y - second.y
  return x * x + y * y
}

function nearestPoint(
  point: SketchPoint2,
  points: readonly SketchInferencePoint[],
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  return points
    .filter((candidate) => squaredDistance(point, candidate) <= maximumDistance)
    .sort((left, right) => {
      const distanceDifference = squaredDistance(point, left) - squaredDistance(point, right)
      return distanceDifference || left.id.localeCompare(right.id)
    })[0]
}

function inferredAxis(
  point: SketchPoint2,
  anchor: SketchPoint2,
  tolerance: number,
): SketchAxisInference | null {
  const horizontalDistance = Math.abs(point.y - anchor.y)
  const verticalDistance = Math.abs(point.x - anchor.x)
  const horizontal = horizontalDistance <= tolerance
  const vertical = verticalDistance <= tolerance
  if (!horizontal && !vertical) return null
  if (horizontal && vertical) {
    return horizontalDistance <= verticalDistance ? "horizontal" : "vertical"
  }
  return horizontal ? "horizontal" : "vertical"
}

export function inferSketchPoint(input: {
  anchor?: SketchPoint2
  point: SketchPoint2
  points: readonly SketchInferencePoint[]
  tolerance: number
}): SketchPointInference {
  if (!Number.isFinite(input.tolerance) || input.tolerance < 0) {
    throw new RangeError("Sketch inference tolerance must be a finite non-negative distance.")
  }
  const snappedPoint = nearestPoint(input.point, input.points, input.tolerance)
  if (snappedPoint) {
    return {
      axis: null,
      point: { x: snappedPoint.x, y: snappedPoint.y },
      target: { kind: "existing", pointId: snappedPoint.id },
    }
  }
  const axis = input.anchor ? inferredAxis(input.point, input.anchor, input.tolerance) : null
  const point =
    axis === "horizontal"
      ? { x: input.point.x, y: input.anchor?.y ?? input.point.y }
      : axis === "vertical"
        ? { x: input.anchor?.x ?? input.point.x, y: input.point.y }
        : input.point
  return { axis, point, target: { kind: "new", point } }
}
