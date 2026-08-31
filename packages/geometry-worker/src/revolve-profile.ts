import type { revolveFeatureContentParametersSchema } from "@vibeshape/protocol"

type RevolveParameters = {
  axis: "x" | "y" | ReturnType<typeof revolveFeatureContentParametersSchema.parse>["axis"]
  axisDirection?: ReturnType<typeof revolveFeatureContentParametersSchema.parse>["axisDirection"]
  axisOrigin?: ReturnType<typeof revolveFeatureContentParametersSchema.parse>["axisOrigin"]
  frame?: ReturnType<typeof revolveFeatureContentParametersSchema.parse>["frame"]
  outer: ReturnType<typeof revolveFeatureContentParametersSchema.parse>["outer"]
}
type Segment = RevolveParameters["outer"]["segments"][number]
type Bounds = Readonly<{ min: number; max: number }>

const TWO_PI = Math.PI * 2
const AXIS_TOLERANCE = 1e-7

function normalizeAngle(angle: number) {
  const normalized = angle % TWO_PI
  return normalized < 0 ? normalized + TWO_PI : normalized
}

function positiveSweep(start: number, end: number) {
  const sweep = normalizeAngle(end - start)
  return sweep === 0 ? TWO_PI : sweep
}

function parameterIsOnSweep(start: number, sweep: number, candidate: number) {
  const relative =
    sweep >= 0 ? normalizeAngle(candidate - start) : normalizeAngle(start - candidate)
  return relative <= Math.abs(sweep) + AXIS_TOLERANCE
}

function parametricBounds(
  center: number,
  cosineCoefficient: number,
  sineCoefficient: number,
  start = 0,
  sweep = TWO_PI,
): Bounds {
  const end = start + sweep
  const values = [
    center + cosineCoefficient * Math.cos(start) + sineCoefficient * Math.sin(start),
    center + cosineCoefficient * Math.cos(end) + sineCoefficient * Math.sin(end),
  ]
  const firstExtreme = Math.atan2(sineCoefficient, cosineCoefficient)
  for (const candidate of [firstExtreme, firstExtreme + Math.PI]) {
    if (parameterIsOnSweep(start, sweep, candidate)) {
      values.push(
        center + cosineCoefficient * Math.cos(candidate) + sineCoefficient * Math.sin(candidate),
      )
    }
  }
  return { min: Math.min(...values), max: Math.max(...values) }
}

function circleThroughThreePoints(
  start: readonly [number, number],
  middle: readonly [number, number],
  end: readonly [number, number],
) {
  const determinant =
    2 *
    (start[0] * (middle[1] - end[1]) +
      middle[0] * (end[1] - start[1]) +
      end[0] * (start[1] - middle[1]))
  if (Math.abs(determinant) <= Number.EPSILON) return null
  const startSquared = start[0] ** 2 + start[1] ** 2
  const middleSquared = middle[0] ** 2 + middle[1] ** 2
  const endSquared = end[0] ** 2 + end[1] ** 2
  const center = [
    (startSquared * (middle[1] - end[1]) +
      middleSquared * (end[1] - start[1]) +
      endSquared * (start[1] - middle[1])) /
      determinant,
    (startSquared * (end[0] - middle[0]) +
      middleSquared * (start[0] - end[0]) +
      endSquared * (middle[0] - start[0])) /
      determinant,
  ] as const
  return { center, radius: Math.hypot(start[0] - center[0], start[1] - center[1]) }
}

type Projection = Readonly<{ normal: readonly [number, number]; offset: number }>

function projectedPoint(point: readonly [number, number], normal: readonly [number, number]) {
  return point[0] * normal[0] + point[1] * normal[1]
}

function arcBounds(
  segment: Extract<Segment, { type: "arc" }>,
  normal: readonly [number, number],
): Bounds {
  const circle = circleThroughThreePoints(segment.start, segment.middle, segment.end)
  if (!circle) {
    const values = [segment.start, segment.middle, segment.end].map((point) =>
      projectedPoint(point, normal),
    )
    return { min: Math.min(...values), max: Math.max(...values) }
  }
  const angleAt = (point: readonly [number, number]) =>
    Math.atan2(point[1] - circle.center[1], point[0] - circle.center[0])
  const start = angleAt(segment.start)
  const middle = angleAt(segment.middle)
  const end = angleAt(segment.end)
  const forwardSweep = positiveSweep(start, end)
  const sweep = parameterIsOnSweep(start, forwardSweep, middle)
    ? forwardSweep
    : forwardSweep - TWO_PI
  return parametricBounds(
    projectedPoint(circle.center, normal),
    circle.radius * normal[0],
    circle.radius * normal[1],
    start,
    sweep,
  )
}

function ellipseCoefficients(
  segment: Extract<Segment, { type: "ellipse" | "elliptical-arc" }>,
  normal: readonly [number, number],
) {
  return {
    center: projectedPoint(segment.center, normal),
    primary:
      projectedPoint(segment.primaryAxisPoint, normal) - projectedPoint(segment.center, normal),
    secondary:
      projectedPoint(segment.secondaryAxisPoint, normal) - projectedPoint(segment.center, normal),
  }
}

function ellipticalArcParameter(
  segment: Extract<Segment, { type: "elliptical-arc" }>,
  point: readonly [number, number],
) {
  const primaryX = segment.primaryAxisPoint[0] - segment.center[0]
  const primaryY = segment.primaryAxisPoint[1] - segment.center[1]
  const secondaryX = segment.secondaryAxisPoint[0] - segment.center[0]
  const secondaryY = segment.secondaryAxisPoint[1] - segment.center[1]
  const offsetX = point[0] - segment.center[0]
  const offsetY = point[1] - segment.center[1]
  const cosine = (offsetX * primaryX + offsetY * primaryY) / (primaryX ** 2 + primaryY ** 2)
  const sine = (offsetX * secondaryX + offsetY * secondaryY) / (secondaryX ** 2 + secondaryY ** 2)
  return Math.atan2(sine, cosine)
}

function segmentBounds(segment: Segment, normal: readonly [number, number]): Bounds {
  if (segment.type === "line") {
    return {
      min: Math.min(projectedPoint(segment.start, normal), projectedPoint(segment.end, normal)),
      max: Math.max(projectedPoint(segment.start, normal), projectedPoint(segment.end, normal)),
    }
  }
  if (segment.type === "arc") return arcBounds(segment, normal)
  if (segment.type === "circle") {
    const center = projectedPoint(segment.center, normal)
    return {
      min: center - segment.radius,
      max: center + segment.radius,
    }
  }
  const coefficients = ellipseCoefficients(segment, normal)
  if (segment.type === "ellipse") {
    return parametricBounds(coefficients.center, coefficients.primary, coefficients.secondary)
  }
  const start = ellipticalArcParameter(segment, segment.start)
  const sweep = positiveSweep(start, ellipticalArcParameter(segment, segment.end))
  return parametricBounds(
    coefficients.center,
    coefficients.primary,
    coefficients.secondary,
    start,
    sweep,
  )
}

function selectedAxisProjection(parameters: RevolveParameters): Projection | null {
  const originAxis =
    typeof parameters.axis === "string"
      ? parameters.axis
      : parameters.axis.kind === "origin-axis"
        ? parameters.axis.axis
        : null
  if (originAxis) {
    return originAxis === "x" ? { normal: [0, 1], offset: 0 } : { normal: [-1, 0], offset: 0 }
  }
  if (!parameters.axisDirection || !parameters.axisOrigin || !parameters.frame) return null
  const { axisDirection, axisOrigin, frame } = parameters
  const localDirection = [
    axisDirection[0] * frame.xAxis[0] +
      axisDirection[1] * frame.xAxis[1] +
      axisDirection[2] * frame.xAxis[2],
    axisDirection[0] * frame.yAxis[0] +
      axisDirection[1] * frame.yAxis[1] +
      axisDirection[2] * frame.yAxis[2],
  ] as const
  const length = Math.hypot(...localDirection)
  if (!(length > Number.EPSILON)) return null
  const normal = [-localDirection[1] / length, localDirection[0] / length] as const
  const relativeOrigin = [
    axisOrigin[0] - frame.origin[0],
    axisOrigin[1] - frame.origin[1],
    axisOrigin[2] - frame.origin[2],
  ] as const
  const localOrigin = [
    relativeOrigin[0] * frame.xAxis[0] +
      relativeOrigin[1] * frame.xAxis[1] +
      relativeOrigin[2] * frame.xAxis[2],
    relativeOrigin[0] * frame.yAxis[0] +
      relativeOrigin[1] * frame.yAxis[1] +
      relativeOrigin[2] * frame.yAxis[2],
  ] as const
  return { normal, offset: projectedPoint(localOrigin, normal) }
}

export function revolveProfileCrossesAxis(parameters: RevolveParameters) {
  const projection = selectedAxisProjection(parameters)
  if (!projection) return false
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const segment of parameters.outer.segments) {
    const bounds = segmentBounds(segment, projection.normal)
    minimum = Math.min(minimum, bounds.min)
    maximum = Math.max(maximum, bounds.max)
  }
  return (
    minimum < projection.offset - AXIS_TOLERANCE && maximum > projection.offset + AXIS_TOLERANCE
  )
}
