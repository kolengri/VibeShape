import type { SimplePoint } from "replicad"

/** Exact scalar extrema of a cubic Bezier projected onto a planar direction. */
export function cubicBezierProjectionBounds(
  points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ],
  normal: readonly [number, number],
) {
  const [p0, p1, p2, p3] = points.map((point) => point[0] * normal[0] + point[1] * normal[1]) as [
    number,
    number,
    number,
    number,
  ]
  const a = -p0 + 3 * p1 - 3 * p2 + p3,
    b = 3 * p0 - 6 * p1 + 3 * p2,
    c = 3 * (p1 - p0)
  const parameters = [0, 1]
  if (a === 0) {
    if (b !== 0) parameters.push(-c / (2 * b))
  } else {
    const discriminant = 4 * b * b - 12 * a * c
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      const q = -b - (b < 0 ? -root : root) / 2
      if (q !== 0) parameters.push(q / (3 * a), c / q)
      else parameters.push(-b / (3 * a))
    }
  }
  const values = parameters
    .filter((t) => t >= 0 && t <= 1)
    .map((t) => ((a * t + b) * t + c) * t + p0)
  return { min: Math.min(...values), max: Math.max(...values) }
}

function dot(left: SimplePoint, right: SimplePoint) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: SimplePoint, right: SimplePoint): SimplePoint {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function subtract(left: SimplePoint, right: SimplePoint): SimplePoint {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

export function normalizedExtrusionDirection(start: SimplePoint, end: SimplePoint): SimplePoint {
  const direction = subtract(end, start)
  const magnitude = Math.hypot(...direction)
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    throw new Error("Extrusion ellipse axis direction is degenerate.")
  }
  return direction.map((coordinate) => coordinate / magnitude) as SimplePoint
}

export type EllipticalArcKernelParameters = Readonly<{
  center: SimplePoint
  endParameter: number
  majorRadius: number
  minorRadius: number
  normal: SimplePoint
  startParameter: number
  xDirection: SimplePoint
}>

export function ellipticalArcKernelParameters(input: {
  center: SimplePoint
  end: SimplePoint
  normal: SimplePoint
  primaryAxisPoint: SimplePoint
  reverse: boolean
  secondaryAxisPoint: SimplePoint
  start: SimplePoint
}): EllipticalArcKernelParameters {
  const primary = normalizedExtrusionDirection(input.center, input.primaryAxisPoint)
  const secondary = normalizedExtrusionDirection(input.center, input.secondaryAxisPoint)
  const primaryRadius = Math.hypot(...subtract(input.primaryAxisPoint, input.center))
  const secondaryRadius = Math.hypot(...subtract(input.secondaryAxisPoint, input.center))
  const handedness = dot(cross(primary, secondary), input.normal) < 0 ? -1 : 1
  const reverseSign = input.reverse ? -1 : 1
  const normal = input.normal.map(
    (coordinate) => coordinate * handedness * reverseSign || 0,
  ) as SimplePoint
  const primaryIsMajor = primaryRadius >= secondaryRadius
  const majorRadius = primaryIsMajor ? primaryRadius : secondaryRadius
  const minorRadius = primaryIsMajor ? secondaryRadius : primaryRadius
  const xDirection = primaryIsMajor ? primary : secondary
  const yDirection = cross(normal, xDirection)
  const parameterAt = (point: SimplePoint) => {
    const offset = subtract(point, input.center)
    return Math.atan2(dot(offset, yDirection) / minorRadius, dot(offset, xDirection) / majorRadius)
  }
  const start = input.reverse ? input.end : input.start
  const end = input.reverse ? input.start : input.end
  const startParameter = parameterAt(start)
  let endParameter = parameterAt(end)
  while (endParameter <= startParameter) endParameter += Math.PI * 2
  return {
    center: input.center,
    endParameter,
    majorRadius,
    minorRadius,
    normal,
    startParameter,
    xDirection,
  }
}
