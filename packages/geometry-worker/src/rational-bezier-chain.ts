import {
  MAX_TOPOLOGY_BEZIER_CHAIN_SEGMENTS as MAX_SEGMENTS,
  TOPOLOGY_BEZIER_CHAIN_TOLERANCE_MM as TOLERANCE_MM,
} from "@vibeshape/protocol"

type Point = [number, number, number]
/** Homogeneous pole `[w·x, w·y, w·z, w]`. */
type Homogeneous = [number, number, number, number]

/** One exact rational Bezier piece of a curve on the parameter interval `[first, last]`. */
export type RationalBezierPiece = Readonly<{
  first: number
  last: number
  poles: readonly Homogeneous[]
}>

/** A clamped NURBS curve with a flat knot vector of length `poles.length + degree + 1`. */
export type NurbsCurve = Readonly<{
  degree: number
  knots: readonly number[]
  poles: readonly Point[]
  weights: readonly number[]
}>

export type FittedBezierChain = Readonly<{
  /** `3N + 1` world-space poles; consecutive segments share their joint pole. */
  poles: Point[]
  /** Proven upper bound on the distance between matching parameters of curve and chain. */
  maxDeviation: number
}>

const KNOT_TOLERANCE = 1e-12

function homogeneous(point: Point, weight: number): Homogeneous {
  return [point[0] * weight, point[1] * weight, point[2] * weight, weight]
}

function lerp(a: Homogeneous, b: Homogeneous, t: number): Homogeneous {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ]
}

/** Exact de Casteljau split of a homogeneous Bezier at `t`. */
function splitBezier(poles: readonly Homogeneous[], t: number) {
  const left: Homogeneous[] = []
  const right: Homogeneous[] = []
  let level = [...poles]
  while (level.length > 0) {
    left.push(level[0] as Homogeneous)
    right.unshift(level.at(-1) as Homogeneous)
    level = level.slice(1).map((pole, index) => lerp(level[index] as Homogeneous, pole, t))
  }
  return { left, right }
}

/** The exact sub-piece of `piece` on the global parameter interval `[from, to]`. */
function restrictPiece(piece: RationalBezierPiece, from: number, to: number) {
  const span = piece.last - piece.first
  const a = (from - piece.first) / span
  const b = (to - piece.first) / span
  const tail = a > KNOT_TOLERANCE ? splitBezier(piece.poles, a).right : [...piece.poles]
  const local = (b - a) / (1 - a)
  const poles = local < 1 - KNOT_TOLERANCE ? splitBezier(tail, local).left : tail
  return { first: from, last: to, poles }
}

function binomial(n: number, k: number) {
  let result = 1
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index
  return result
}

/** Rational value and parameter derivative at global parameter `u`. */
function evaluatePiece(piece: RationalBezierPiece, u: number) {
  const t = (u - piece.first) / (piece.last - piece.first)
  const degree = piece.poles.length - 1
  const { left, right } = splitBezier(piece.poles, t)
  const value = left.at(-1) as Homogeneous
  // The two points of the last de Casteljau level span the hodograph at `t`.
  const before = left.at(-2) as Homogeneous
  const after = right[1] as Homogeneous
  const derivative = after.map(
    (coordinate, axis) => degree * (coordinate - (before[axis] as number)),
  )
  const [x, y, z, w] = value
  const [dx, dy, dz, dw] = derivative as Homogeneous
  const scale = 1 / ((piece.last - piece.first) * w * w)
  const point: Point = [x / w, y / w, z / w]
  const tangent: Point = [
    (dx * w - x * dw) * scale,
    (dy * w - y * dw) * scale,
    (dz * w - z * dw) * scale,
  ]
  return { point, tangent }
}

/** Subdivision depth for certifying one segment; 2^12 sub-intervals at most. */
const MAX_CERTIFICATION_DEPTH = 12

function hullBound(coefficients: readonly Homogeneous[]) {
  const minimumWeight = Math.min(...coefficients.map((coefficient) => coefficient[3]))
  if (!(minimumWeight > 0)) return Number.POSITIVE_INFINITY
  const numerator = Math.max(...coefficients.map(([x, y, z]) => Math.hypot(x, y, z)))
  return numerator / minimumWeight
}

/** Exact error at a Bernstein end coefficient, where the polynomial interpolates its value. */
function endpointError([x, y, z, w]: Homogeneous) {
  return Math.hypot(x, y, z) / w
}

/**
 * Certifies an upper bound on the error polynomial over `[0, 1]`: the convex-hull bound of each
 * de Casteljau sub-interval is refined until it proves the tolerance or the depth runs out. Only
 * "within tolerance" matters to callers, so an exact end error above the tolerance, or a failed
 * first half, returns at once with a value that already exceeds it.
 */
function certifiedBound(coefficients: readonly Homogeneous[], depth: number): number {
  const ends = Math.max(
    endpointError(coefficients[0] as Homogeneous),
    endpointError(coefficients.at(-1) as Homogeneous),
  )
  if (!(ends <= TOLERANCE_MM)) return ends
  const bound = hullBound(coefficients)
  if (bound <= TOLERANCE_MM || depth === 0 || !Number.isFinite(bound)) return bound
  const { left, right } = splitBezier(coefficients, 0.5)
  const first = certifiedBound(left, depth - 1)
  return first > TOLERANCE_MM ? first : Math.max(first, certifiedBound(right, depth - 1))
}

/**
 * Bounds `max |N(t) / w(t) − H(t)|` over the segment. `N − w·H` and the weight `w` are both
 * written in the degree `p + 3` Bernstein basis (`[E_x, E_y, E_z, w]` per coefficient); their
 * convex hulls bound the numerator from above and the positive weight from below.
 */
function hermiteDeviationBound(segment: RationalBezierPiece, cubic: readonly Point[]) {
  const degree = segment.poles.length - 1
  const product = degree + 3
  const coefficients = Array.from({ length: product + 1 }, (_, k): Homogeneous => {
    const total = binomial(product, k)
    const coefficient: Homogeneous = [0, 0, 0, 0]
    for (let i = Math.max(0, k - 3); i <= Math.min(degree, k); i += 1) {
      const pole = segment.poles[i] as Homogeneous
      const h = cubic[k - i] as Point
      const factor = (binomial(degree, i) * binomial(3, k - i)) / total
      // Elevated numerator minus the weight-times-cubic product; the last entry elevates `w`.
      for (const axis of [0, 1, 2] as const) {
        coefficient[axis] += factor * (pole[axis] - pole[3] * h[axis])
      }
      coefficient[3] += factor * pole[3]
    }
    return coefficient
  })
  return certifiedBound(coefficients, MAX_CERTIFICATION_DEPTH)
}

/** Cubic Hermite segment matching the curve position and first derivative at both ends. */
function hermiteSegment(piece: RationalBezierPiece, from: number, to: number) {
  const start = evaluatePiece(piece, from)
  const end = evaluatePiece(piece, to)
  const scale = (to - from) / 3
  return [
    start.point,
    start.point.map((value, axis) => value + (start.tangent[axis] as number) * scale) as Point,
    end.point.map((value, axis) => value - (end.tangent[axis] as number) * scale) as Point,
    end.point,
  ]
}

function fitSubdivision(pieces: readonly RationalBezierPiece[], subdivisions: number) {
  const poles: Point[] = []
  let maxDeviation = 0
  for (const piece of pieces) {
    const step = (piece.last - piece.first) / subdivisions
    for (let index = 0; index < subdivisions; index += 1) {
      const from = piece.first + step * index
      const to = index + 1 === subdivisions ? piece.last : from + step
      const cubic = hermiteSegment(piece, from, to)
      maxDeviation = Math.max(
        maxDeviation,
        hermiteDeviationBound(restrictPiece(piece, from, to), cubic),
      )
      // One uncertified segment rejects this refinement level; skip the remaining work.
      if (!(maxDeviation <= TOLERANCE_MM)) return null
      poles.push(...(poles.length === 0 ? cubic : cubic.slice(1)))
    }
  }
  return { poles, maxDeviation }
}

/**
 * Fits the coarsest uniform refinement of the exact Bezier pieces whose proven deviation bound
 * stays within the published tolerance, using at most the published segment budget.
 */
export function fitRationalBezierChain(
  pieces: readonly RationalBezierPiece[],
): FittedBezierChain | undefined {
  if (pieces.length === 0 || pieces.length > MAX_SEGMENTS) return undefined
  if (!pieces.every((piece) => piece.poles.every((pole) => pole[3] > 0))) return undefined
  for (let subdivisions = 1; pieces.length * subdivisions <= MAX_SEGMENTS; subdivisions *= 2) {
    const fitted = fitSubdivision(pieces, subdivisions)
    if (!fitted) continue
    if (!fitted.poles.every((pole) => pole.every(Number.isFinite))) return undefined
    return { poles: fitted.poles, maxDeviation: fitted.maxDeviation }
  }
  return undefined
}

function lastKnotIndexAtOrBelow(knots: readonly number[], value: number) {
  let index = -1
  for (const [position, knot] of knots.entries())
    if (knot <= value + KNOT_TOLERANCE) index = position
  return index
}

/**
 * Decomposes a clamped NURBS curve into its exact rational Bezier pieces by inserting every
 * interior knot up to the degree (Boehm insertion on homogeneous poles).
 */
export function nurbsBezierPieces(curve: NurbsCurve): RationalBezierPiece[] | undefined {
  const range = clampedRange(curve)
  if (!range) return undefined
  const { degree, knots } = curve
  const breaks = [...new Set(knots.slice(degree + 1, -degree - 1))].filter(
    (knot) => knot > range.first + KNOT_TOLERANCE && knot < range.last - KNOT_TOLERANCE,
  )
  let state = {
    poles: curve.poles.map((pole, index) => homogeneous(pole, curve.weights[index] as number)),
    knots: [...knots],
  }
  for (const knot of breaks) {
    const multiplicity = state.knots.filter((value) => Math.abs(value - knot) <= KNOT_TOLERANCE)
    for (let present = multiplicity.length; present < degree; present += 1) {
      state = insertKnot(state, degree, knot, present)
    }
  }
  const parameters = [range.first, ...breaks, range.last]
  return parameters.slice(0, -1).map((start, index) => ({
    first: start,
    last: parameters[index + 1] as number,
    poles: state.poles.slice(index * degree, index * degree + degree + 1),
  }))
}

/** The parameter range of a valid clamped curve; open or malformed knot vectors are rejected. */
function clampedRange({ degree, knots, poles }: NurbsCurve) {
  if (knots.length !== poles.length + degree + 1 || degree < 1) return null
  const first = knots[degree] as number
  const last = knots[knots.length - degree - 1] as number
  const near = (value: number) => (knot: number) => Math.abs(knot - value) <= KNOT_TOLERANCE
  const clamped =
    knots.slice(0, degree + 1).every(near(first)) && knots.slice(-degree - 1).every(near(last))
  return clamped && last > first ? { first, last } : null
}

/** One Boehm insertion of `knot`, already present `present` times, into homogeneous poles. */
function insertKnot(
  state: Readonly<{ poles: readonly Homogeneous[]; knots: readonly number[] }>,
  degree: number,
  knot: number,
  present: number,
) {
  // Knot span `k` with U[k] <= u < U[k + 1].
  const span = lastKnotIndexAtOrBelow(state.knots, knot)
  const { knots, poles } = state
  const next = Array.from({ length: poles.length + 1 }, (_, index): Homogeneous => {
    if (index <= span - degree) return poles[index] as Homogeneous
    if (index > span - present) return poles[index - 1] as Homogeneous
    const lower = knots[index] as number
    const alpha = (knot - lower) / ((knots[index + degree] as number) - lower)
    return lerp(poles[index - 1] as Homogeneous, poles[index] as Homogeneous, alpha)
  })
  return { poles: next, knots: [...knots.slice(0, span + 1), knot, ...knots.slice(span + 1)] }
}

/** Exact pieces of one Bezier curve restricted to the trimmed parameter range. */
export function bezierCurvePiece(
  poles: readonly Point[],
  weights: readonly number[],
  first: number,
  last: number,
): RationalBezierPiece {
  return restrictPiece(
    {
      first: 0,
      last: 1,
      poles: poles.map((pole, index) => homogeneous(pole, weights[index] as number)),
    },
    first,
    last,
  )
}

/** Restricts decomposed pieces to the trimmed edge range `[first, last]`. */
export function trimPieces(pieces: readonly RationalBezierPiece[], first: number, last: number) {
  return pieces.flatMap((piece) => {
    const from = Math.max(piece.first, first)
    const to = Math.min(piece.last, last)
    return to - from > KNOT_TOLERANCE ? [restrictPiece(piece, from, to)] : []
  })
}
