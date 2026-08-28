import type { revolveFeatureContentParametersSchema } from "@vibeshape/protocol"

type RevolveParameters = ReturnType<typeof revolveFeatureContentParametersSchema.parse>
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

function arcBounds(segment: Extract<Segment, { type: "arc" }>, coordinate: 0 | 1): Bounds {
  const circle = circleThroughThreePoints(segment.start, segment.middle, segment.end)
  if (!circle) {
    const values = [segment.start[coordinate], segment.middle[coordinate], segment.end[coordinate]]
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
    circle.center[coordinate],
    coordinate === 0 ? circle.radius : 0,
    coordinate === 1 ? circle.radius : 0,
    start,
    sweep,
  )
}

function ellipseCoefficients(
  segment: Extract<Segment, { type: "ellipse" | "elliptical-arc" }>,
  coordinate: 0 | 1,
) {
  return {
    center: segment.center[coordinate],
    primary: segment.primaryAxisPoint[coordinate] - segment.center[coordinate],
    secondary: segment.secondaryAxisPoint[coordinate] - segment.center[coordinate],
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

function segmentBounds(segment: Segment, coordinate: 0 | 1): Bounds {
  if (segment.type === "line") {
    return {
      min: Math.min(segment.start[coordinate], segment.end[coordinate]),
      max: Math.max(segment.start[coordinate], segment.end[coordinate]),
    }
  }
  if (segment.type === "arc") return arcBounds(segment, coordinate)
  if (segment.type === "circle") {
    return {
      min: segment.center[coordinate] - segment.radius,
      max: segment.center[coordinate] + segment.radius,
    }
  }
  const coefficients = ellipseCoefficients(segment, coordinate)
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

export function revolveProfileCrossesAxis(parameters: Pick<RevolveParameters, "axis" | "outer">) {
  const coordinate = parameters.axis === "x" ? 1 : 0
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const segment of parameters.outer.segments) {
    const bounds = segmentBounds(segment, coordinate)
    minimum = Math.min(minimum, bounds.min)
    maximum = Math.max(maximum, bounds.max)
  }
  return minimum < -AXIS_TOLERANCE && maximum > AXIS_TOLERANCE
}
