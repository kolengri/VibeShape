import type { SketchPoint2 } from "./sketch-edit"

/** Upper bound for one authored spline so a single gesture stays within the solver budget. */
export const MAX_SPLINE_THROUGH_POINTS = 128
/** Minimum through-point spacing; closer picks are treated as a repeated pick. */
export const MIN_SPLINE_POINT_SPACING_MM = 1e-7

export type SplineSegmentControls = Readonly<{ control1: SketchPoint2; control2: SketchPoint2 }>

type Vector = Readonly<{ x: number; y: number }>

function unit(from: SketchPoint2, to: SketchPoint2): Vector {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

function normalized(vector: Vector, fallback: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y)
  return length <= 1e-12 ? fallback : { x: vector.x / length, y: vector.y / length }
}

/** Bisects the incoming and outgoing chord directions; a full reversal turns perpendicularly. */
function interiorTangent(incoming: Vector, outgoing: Vector): Vector {
  return normalized(
    { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y },
    { x: -incoming.y, y: incoming.x },
  )
}

/** Mirrors the neighboring tangent across the end chord, giving a parabolic free end. */
function endTangent(chord: Vector, neighbor: Vector): Vector {
  return normalized({ x: 2 * chord.x - neighbor.x, y: 2 * chord.y - neighbor.y }, chord)
}

export function validateSplineThroughPoints(points: readonly SketchPoint2[], closed: boolean) {
  const minimum = closed ? 3 : 2
  if (points.length < minimum || points.length > MAX_SPLINE_THROUGH_POINTS) {
    throw new RangeError(
      `A ${closed ? "closed" : "open"} spline requires ${minimum} to ${MAX_SPLINE_THROUGH_POINTS} through-points.`,
    )
  }
  const segmentCount = closed ? points.length : points.length - 1
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index] as SketchPoint2
    const end = points[(index + 1) % points.length] as SketchPoint2
    if (Math.hypot(end.x - start.x, end.y - start.y) <= MIN_SPLINE_POINT_SPACING_MM) {
      throw new RangeError("Consecutive spline through-points must be distinct.")
    }
  }
}

function splineTangents(points: readonly SketchPoint2[], closed: boolean): readonly Vector[] {
  const count = points.length
  const chord = (index: number) =>
    unit(points[index % count] as SketchPoint2, points[(index + 1) % count] as SketchPoint2)
  if (closed) {
    return points.map((_, index) => interiorTangent(chord(index + count - 1), chord(index)))
  }
  if (count === 2) return [chord(0), chord(0)]
  const interior = points
    .slice(1, -1)
    .map((_, offset) => interiorTangent(chord(offset), chord(offset + 1)))
  const first = endTangent(chord(0), interior[0] as Vector)
  const last = endTangent(chord(count - 2), interior.at(-1) as Vector)
  return [first, ...interior, last]
}

/**
 * Computes the interior Bezier poles of an interpolating G1 spline. Every handle lies on its
 * through-point tangent at one third of the adjacent chord, so the controls of a shared
 * through-point are collinear by construction and on opposite sides of it.
 */
export function interpolatingSplineControls(
  points: readonly SketchPoint2[],
  closed: boolean,
): readonly SplineSegmentControls[] {
  validateSplineThroughPoints(points, closed)
  const tangents = splineTangents(points, closed)
  const segmentCount = closed ? points.length : points.length - 1
  return Array.from({ length: segmentCount }, (_, index) => {
    const nextIndex = (index + 1) % points.length
    const start = points[index] as SketchPoint2
    const end = points[nextIndex] as SketchPoint2
    const startTangent = tangents[index] as Vector
    const endTangentVector = tangents[nextIndex] as Vector
    const handle = Math.hypot(end.x - start.x, end.y - start.y) / 3
    return {
      control1: { x: start.x + startTangent.x * handle, y: start.y + startTangent.y * handle },
      control2: { x: end.x - endTangentVector.x * handle, y: end.y - endTangentVector.y * handle },
    }
  })
}
