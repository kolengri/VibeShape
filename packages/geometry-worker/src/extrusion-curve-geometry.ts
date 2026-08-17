import type { SimplePoint } from "replicad"

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
