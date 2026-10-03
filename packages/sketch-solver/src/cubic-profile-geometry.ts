import type {
  ProfileBounds,
  ProfileCubicBezierCurve,
  ProfileCurve,
  ProfileEllipseLikeCurve,
  ProfileLineCurve,
  ProfilePoint,
  ProfileRoundCurve,
} from "./profile-geometry"

type Polynomial = readonly number[]
type Poles = readonly [ProfilePoint, ProfilePoint, ProfilePoint, ProfilePoint]
type CubicIntersectionResult = Readonly<{
  coincident: boolean
  points: readonly ProfilePoint[]
  uncertain?: boolean
}>
const MAX_PAIR_SUBDIVISIONS = 16_384
const MAX_PAIR_DEPTH = 96

function separation(a: ProfilePoint, b: ProfilePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function evaluate(coefficients: Polynomial, t: number) {
  return coefficients.reduceRight((value, coefficient) => value * t + coefficient, 0)
}
function coefficients(values: readonly number[]): [number, number, number, number] {
  const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = values
  return [p0, 3 * (p1 - p0), 3 * (p2 - 2 * p1 + p0), p3 - 3 * p2 + 3 * p1 - p0]
}
function coordinatePolynomials(
  curve: ProfileCubicBezierCurve,
  origin: ProfilePoint = { x: 0, y: 0 },
) {
  const poles = [curve.start, curve.control1, curve.control2, curve.end]
  return {
    x: coefficients(poles.map((p) => p.x - origin.x)),
    y: coefficients(poles.map((p) => p.y - origin.y)),
  }
}
function derivative(polynomial: Polynomial) {
  return polynomial.slice(1).map((value, index) => value * (index + 1))
}
function uniqueParameters(values: readonly number[]) {
  return [...values]
    .sort((a, b) => a - b)
    .filter(
      (value, index, sorted) =>
        index === 0 || Math.abs(value - (sorted[index - 1] ?? value)) > 1e-11,
    )
}
function rootBetween(polynomial: Polynomial, start: number, end: number) {
  let left = start
  let right = end
  let leftValue = evaluate(polynomial, left)
  for (let i = 0; i < 60; i += 1) {
    const middle = (left + right) / 2
    const value = evaluate(polynomial, middle)
    if (value === 0) return middle
    if (Math.sign(value) === Math.sign(leftValue)) {
      left = middle
      leftValue = value
    } else right = middle
  }
  return (left + right) / 2
}
function trimmedPolynomial(source: Polynomial) {
  const polynomial = [...source]
  while (polynomial.length > 1 && polynomial.at(-1) === 0) polynomial.pop()
  return polynomial
}
function linearPolynomialRoots(polynomial: Polynomial) {
  const t = -(polynomial[0] ?? 0) / (polynomial[1] ?? 1)
  return t >= 0 && t <= 1 ? [t] : []
}
function rootsOnPartitions(
  polynomial: Polynomial,
  partitions: readonly number[],
  valueTolerance: number,
) {
  const roots = partitions.filter((t) => Math.abs(evaluate(polynomial, t)) <= valueTolerance)
  partitions.slice(1).forEach((right, index) => {
    const left = partitions[index] ?? 0
    if (evaluate(polynomial, left) * evaluate(polynomial, right) < 0)
      roots.push(rootBetween(polynomial, left, right))
  })
  return uniqueParameters(roots)
}
/** Derivative partitions isolate polynomial roots, including tangent roots, on the closed unit interval. */
function polynomialRoots(source: Polynomial, valueTolerance: number): number[] {
  const polynomial = trimmedPolynomial(source)
  if (polynomial.length <= 1) return []
  if (polynomial.length === 2) return linearPolynomialRoots(polynomial)
  const slope = derivative(polynomial)
  const slopeTolerance =
    Number.EPSILON *
    Math.max(
      1,
      slope.reduce((sum, value) => sum + Math.abs(value), 0),
    ) *
    16
  const partitions = uniqueParameters([0, ...polynomialRoots(slope, slopeTolerance), 1])
  return rootsOnPartitions(polynomial, partitions, valueTolerance)
}

export function cubicPointAt(curve: ProfileCubicBezierCurve, t: number): ProfilePoint {
  const u = 1 - t
  const value = (key: "x" | "y") =>
    u ** 3 * curve.start[key] +
    3 * u * u * t * curve.control1[key] +
    3 * u * t * t * curve.control2[key] +
    t ** 3 * curve.end[key]
  return { x: value("x"), y: value("y") }
}
export function cubicBounds(curve: Omit<ProfileCubicBezierCurve, "bounds">): ProfileBounds {
  const points = [curve.start, curve.control1, curve.control2, curve.end]
  const at = (axis: "x" | "y") => {
    const polynomial = coefficients(points.map((point) => point[axis]))
    const slope = derivative(polynomial)
    const roots = polynomialRoots(slope, Number.EPSILON * Math.max(1, ...slope.map(Math.abs)) * 16)
    return [
      polynomial[0] ?? 0,
      evaluate(polynomial, 1),
      ...roots.map((t) => evaluate(polynomial, t)),
    ]
  }
  const xs = at("x"),
    ys = at("y")
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}
export function cubicAreaContribution(curve: ProfileCubicBezierCurve, reversed: boolean) {
  const { x, y } = coordinatePolynomials(curve, curve.start)
  let integral = 0
  for (let i = 0; i < 4; i += 1) {
    for (let j = 1; j < 4; j += 1)
      integral += ((x[i] ?? 0) * j * (y[j] ?? 0) - (y[i] ?? 0) * j * (x[j] ?? 0)) / (i + j)
  }
  integral +=
    curve.start.x * (curve.end.y - curve.start.y) - curve.start.y * (curve.end.x - curve.start.x)
  return ((reversed ? -1 : 1) * integral) / 2
}
export function cubicHasDegenerateTangent(curve: ProfileCubicBezierCurve, tolerance: number) {
  const { x, y } = coordinatePolynomials(curve, curve.start)
  const dx = derivative(x),
    dy = derivative(y)
  const candidates = uniqueParameters([
    0,
    1,
    ...polynomialRoots(dx, tolerance),
    ...polynomialRoots(dy, tolerance),
  ])
  return candidates.some((t) => Math.hypot(evaluate(dx, t), evaluate(dy, t)) <= tolerance)
}
export function cubicSelfIntersects(curve: ProfileCubicBezierCurve, tolerance: number) {
  const { x, y } = coordinatePolynomials(curve, curve.start)
  const denominator = x[3] * y[2] - y[3] * x[2]
  if (denominator === 0) return false
  const sum = -(x[3] * y[1] - y[3] * x[1]) / denominator
  const axis = Math.abs(x[3]) >= Math.abs(y[3]) ? x : y
  const product = sum * sum + (axis[2] * sum + axis[1]) / axis[3]
  const discriminant = sum * sum - 4 * product
  if (!(discriminant > 0)) return false
  const first = (sum - Math.sqrt(discriminant)) / 2,
    second = (sum + Math.sqrt(discriminant)) / 2
  if (!(first >= 0 && second <= 1 && second > first)) return false
  if (first <= 1e-11 && second >= 1 - 1e-11) return false
  return separation(cubicPointAt(curve, first), cubicPointAt(curve, second)) <= tolerance
}
export function cubicStartAngle(curve: ProfileCubicBezierCurve, reversed: boolean) {
  const start = reversed ? curve.end : curve.start
  const control = reversed ? curve.control2 : curve.control1
  return Math.atan2(control.y - start.y, control.x - start.x)
}
function midpoint(a: ProfilePoint, b: ProfilePoint): ProfilePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
function subdivide(poles: Poles): readonly [Poles, Poles] {
  const [a, b, c, d] = poles
  const ab = midpoint(a, b),
    bc = midpoint(b, c),
    cd = midpoint(c, d)
  const abc = midpoint(ab, bc),
    bcd = midpoint(bc, cd),
    middle = midpoint(abc, bcd)
  return [
    [a, ab, abc, middle],
    [middle, bcd, cd, d],
  ]
}
export function cubicLength(curve: ProfileCubicBezierCurve) {
  const queue: { poles: Poles; depth: number }[] = [
    { poles: [curve.start, curve.control1, curve.control2, curve.end], depth: 0 },
  ]
  let length = 0
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i]
    if (!entry) continue
    const [a, b, c, d] = entry.poles
    const chord = separation(a, d),
      polygon = separation(a, b) + separation(b, c) + separation(c, d)
    if (entry.depth >= 12 || polygon - chord <= 1e-8) length += (polygon + chord) / 2
    else
      subdivide(entry.poles).forEach((poles) => {
        queue.push({ poles, depth: entry.depth + 1 })
      })
  }
  return length
}
export function cubicSamples(curve: ProfileCubicBezierCurve, reversed: boolean) {
  return Array.from({ length: 128 }, (_, index) =>
    cubicPointAt(curve, reversed ? 1 - index / 128 : index / 128),
  )
}
function firstNonzeroDerivative(polynomial: Polynomial, t: number) {
  let slope = polynomial
  for (let order = 1; order < polynomial.length; order += 1) {
    slope = derivative(slope)
    const value = evaluate(slope, t)
    const tolerance = Number.EPSILON * Math.max(1, ...slope.map(Math.abs)) * 32
    if (Math.abs(value) > tolerance) return { order, value }
  }
  return null
}
function rayRootCrosses(polynomial: Polynomial, t: number) {
  const slope = firstNonzeroDerivative(polynomial, t)
  if (!slope) return false
  if (t <= 1e-11) return slope.value > 0
  if (t >= 1 - 1e-11) return slope.value * (-1) ** slope.order > 0
  return slope.order % 2 === 1
}
export function cubicRayCrossings(curve: ProfileCubicBezierCurve, yCoordinate: number) {
  const polynomial = coordinatePolynomials(curve, { x: 0, y: yCoordinate })
  const tolerance = Number.EPSILON * Math.max(1, ...polynomial.y.map(Math.abs)) * 32
  return polynomialRoots(polynomial.y, tolerance)
    .filter((t) => rayRootCrosses(polynomial.y, t))
    .map((t) => cubicPointAt(curve, t).x)
}
function polynomialProduct(left: Polynomial, right: Polynomial) {
  const output = Array.from({ length: left.length + right.length - 1 }, () => 0)
  left.forEach((a, i) => {
    right.forEach((b, j) => {
      output[i + j] = (output[i + j] ?? 0) + a * b
    })
  })
  return output
}
function numericalFloor(polynomial: Polynomial) {
  if (!polynomial.every(Number.isFinite)) return Infinity
  return Number.EPSILON * polynomial.reduce((sum, value) => sum + Math.abs(value), 0) * 32
}
function distinctPoints(points: readonly ProfilePoint[], tolerance: number) {
  const output: ProfilePoint[] = []
  for (const point of points)
    if (!output.some((other) => separation(point, other) <= tolerance)) output.push(point)
  return output
}
function lineIntersections(
  curve: ProfileCubicBezierCurve,
  line: ProfileLineCurve,
  tolerance: number,
): CubicIntersectionResult {
  const length = separation(line.start, line.end)
  const normal = {
    x: -(line.end.y - line.start.y) / length,
    y: (line.end.x - line.start.x) / length,
  }
  const { x, y } = coordinatePolynomials(curve, line.start)
  const polynomial = x.map((value, index) => value * normal.x + (y[index] ?? 0) * normal.y)
  if (numericalFloor(polynomial) > tolerance / 4)
    return { coincident: false, points: [], uncertain: true }
  if (polynomial.every((value) => Math.abs(value) <= tolerance))
    return { coincident: true, points: [] }
  const points = polynomialRoots(polynomial, tolerance)
    .map((t) => cubicPointAt(curve, t))
    .filter((point) => {
      const projection =
        ((point.x - line.start.x) * (line.end.x - line.start.x) +
          (point.y - line.start.y) * (line.end.y - line.start.y)) /
        (length * length)
      return projection >= -tolerance / length && projection <= 1 + tolerance / length
    })
  return { coincident: false, points: distinctPoints(points, tolerance) }
}
function conicPolynomials(
  curve: ProfileCubicBezierCurve,
  conic: ProfileEllipseLikeCurve | ProfileRoundCurve,
) {
  const { x, y } = coordinatePolynomials(curve, conic.center)
  if (conic.type === "circle" || conic.type === "arc")
    return {
      x: x.map((value) => value / conic.radius),
      y: y.map((value) => value / conic.radius),
      radius: conic.radius,
    }
  const cosine = Math.cos(conic.rotationRadians),
    sine = Math.sin(conic.rotationRadians)
  return {
    x: x.map((value, index) => (value * cosine + (y[index] ?? 0) * sine) / conic.primaryRadius),
    y: y.map(
      (value, index) =>
        (-(x[index] ?? 0) * sine + value * cosine) / (conic.secondarySign * conic.secondaryRadius),
    ),
    radius: Math.min(conic.primaryRadius, conic.secondaryRadius),
  }
}
function onConicSweep(
  conic: ProfileEllipseLikeCurve | ProfileRoundCurve,
  parameter: number,
  tolerance: number,
) {
  if (conic.type === "circle" || conic.type === "ellipse") return true
  const start = conic.type === "arc" ? conic.startAngle : conic.startParameter
  const relative = (((parameter - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const radius =
    conic.type === "arc" ? conic.radius : Math.min(conic.primaryRadius, conic.secondaryRadius)
  return (
    relative <= conic.sweep + tolerance / radius || 2 * Math.PI - relative <= tolerance / radius
  )
}
function conicIntersections(
  curve: ProfileCubicBezierCurve,
  conic: ProfileEllipseLikeCurve | ProfileRoundCurve,
  tolerance: number,
): CubicIntersectionResult {
  const local = conicPolynomials(curve, conic)
  const xx = polynomialProduct(local.x, local.x),
    yy = polynomialProduct(local.y, local.y)
  const polynomial = xx.map((value, index) => value + (yy[index] ?? 0) - (index === 0 ? 1 : 0))
  const valueTolerance = (2 * tolerance) / local.radius
  if (numericalFloor(polynomial) > valueTolerance / 4)
    return { coincident: false, points: [], uncertain: true }
  const parameters = polynomialRoots(polynomial, valueTolerance).filter((t) =>
    onConicSweep(conic, Math.atan2(evaluate(local.y, t), evaluate(local.x, t)), tolerance),
  )
  return {
    coincident: false,
    points: distinctPoints(
      parameters.map((t) => cubicPointAt(curve, t)),
      tolerance,
    ),
  }
}
function poleBounds(poles: Poles): ProfileBounds {
  return {
    minX: Math.min(...poles.map((p) => p.x)),
    maxX: Math.max(...poles.map((p) => p.x)),
    minY: Math.min(...poles.map((p) => p.y)),
    maxY: Math.max(...poles.map((p) => p.y)),
  }
}
function boxesOverlap(a: ProfileBounds, b: ProfileBounds, tolerance: number) {
  return (
    a.minX <= b.maxX + tolerance &&
    b.minX <= a.maxX + tolerance &&
    a.minY <= b.maxY + tolerance &&
    b.minY <= a.maxY + tolerance
  )
}
function diameter(bounds: ProfileBounds) {
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
}
function samePoles(left: Poles, right: Poles, tolerance: number) {
  return left.every((point, index) => separation(point, right[index] ?? point) <= tolerance)
}
type CurvePair = Readonly<{ left: Poles; right: Poles; depth: number }>
function subdividedPair(pair: CurvePair, splitLeft: boolean) {
  return subdivide(splitLeft ? pair.left : pair.right).map((poles) => ({
    left: splitLeft ? poles : pair.left,
    right: splitLeft ? pair.right : poles,
    depth: pair.depth + 1,
  }))
}
function pairContact(pair: CurvePair, tolerance: number) {
  const leftBounds = poleBounds(pair.left),
    rightBounds = poleBounds(pair.right)
  if (!boxesOverlap(leftBounds, rightBounds, tolerance / 4)) return { status: "separated" as const }
  const leftSize = diameter(leftBounds),
    rightSize = diameter(rightBounds)
  if (Math.max(leftSize, rightSize) <= tolerance / 4)
    return {
      status: "contact" as const,
      point: midpoint(midpoint(pair.left[0], pair.left[3]), midpoint(pair.right[0], pair.right[3])),
    }
  return { status: "subdivide" as const, splitLeft: leftSize >= rightSize }
}
function cubicPairIntersections(
  left: ProfileCubicBezierCurve,
  right: ProfileCubicBezierCurve,
  tolerance: number,
): CubicIntersectionResult {
  const a: Poles = [left.start, left.control1, left.control2, left.end],
    b: Poles = [right.start, right.control1, right.control2, right.end]
  const backwards: Poles = [b[3], b[2], b[1], b[0]]
  if (samePoles(a, b, tolerance) || samePoles(a, backwards, tolerance))
    return { coincident: true, points: [] }
  const queue: CurvePair[] = [{ left: a, right: b, depth: 0 }]
  const points: ProfilePoint[] = []
  for (const [index, pair] of queue.entries()) {
    if (index >= MAX_PAIR_SUBDIVISIONS) return { coincident: false, points: [], uncertain: true }
    const contact = pairContact(pair, tolerance)
    if (contact.status === "separated") continue
    if (contact.status === "contact") {
      points.push(contact.point)
      continue
    }
    if (pair.depth >= MAX_PAIR_DEPTH) return { coincident: false, points: [], uncertain: true }
    queue.push(...subdividedPair(pair, contact.splitLeft))
  }
  return { coincident: false, points: distinctPoints(points, tolerance) }
}

export function cubicCurveIntersections(
  curve: ProfileCubicBezierCurve,
  other: ProfileCurve,
  tolerance: number,
): CubicIntersectionResult {
  if (other.type === "line") return lineIntersections(curve, other, tolerance)
  if (other.type === "cubic-bezier") return cubicPairIntersections(curve, other, tolerance)
  return conicIntersections(curve, other, tolerance)
}
