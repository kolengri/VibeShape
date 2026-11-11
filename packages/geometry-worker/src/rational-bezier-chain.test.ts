import { describe, expect, it } from "bun:test"
import {
  bezierCurvePiece,
  fitRationalBezierChain,
  nurbsBezierPieces,
  type RationalBezierPiece,
} from "./rational-bezier-chain"

type Point = [number, number, number]

function binomial(n: number, k: number) {
  let result = 1
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index
  return result
}

/** Product of two scalar Bernstein polynomials on [0, 1]. */
function bernsteinProduct(left: readonly number[], right: readonly number[]) {
  const m = left.length - 1
  const n = right.length - 1
  return Array.from({ length: m + n + 1 }, (_, k) => {
    let sum = 0
    for (let i = Math.max(0, k - n); i <= Math.min(m, k); i += 1) {
      sum +=
        (binomial(m, i) * binomial(n, k - i) * (left[i] ?? 0) * (right[k - i] ?? 0)) /
        binomial(m + n, k)
    }
    return sum
  })
}

function bernsteinValue(coefficients: readonly number[], t: number) {
  const n = coefficients.length - 1
  return coefficients.reduce(
    (sum, coefficient, i) => sum + coefficient * binomial(n, i) * t ** i * (1 - t) ** (n - i),
    0,
  )
}

/**
 * Codex counterexample: y = A·t²(1 − t)²·∏(t − k/16), k = 1…15, vanishes with zero end slopes and at
 * every sample of a 16-interval grid, yet bulges between the samples.
 */
function gridInvisibleCurve(peak: number) {
  let y = bernsteinProduct([0, 0, 1], [1, 0, 0])
  for (let k = 1; k <= 15; k += 1) y = bernsteinProduct(y, [-k / 16, 1 - k / 16])
  let maximum = 0
  for (let sample = 0; sample <= 20_000; sample += 1) {
    maximum = Math.max(maximum, Math.abs(bernsteinValue(y, sample / 20_000)))
  }
  const scaled = y.map((value) => (value * peak) / maximum)
  const degree = scaled.length - 1
  // x = t has Bernstein coefficients i / n.
  const poles = scaled.map((value, i): Point => [i / degree, value, 0])
  return { poles, y: scaled }
}

function chainPoint(poles: readonly Point[], segment: number, t: number): Point {
  const s = 1 - t
  const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]
  return [0, 1, 2].map((axis) =>
    weights.reduce(
      (sum, weight, index) =>
        sum + weight * ((poles[segment * 3 + index] as Point)[axis as 0 | 1 | 2] ?? 0),
      0,
    ),
  ) as Point
}

describe("proven Bezier chain fitting", () => {
  it("refuses the grid-invisible 0.01 mm excursion that fixed samples reported as a line", () => {
    // Every grid sample of the single Hermite line y = 0 matches the curve exactly. The true error
    // still exceeds 1e-4 mm even with 64 uniform segments (about 2.1e-4 mm), so nothing is published.
    const { poles } = gridInvisibleCurve(0.01)
    expect(
      fitRationalBezierChain([
        bezierCurvePiece(
          poles,
          poles.map(() => 1),
          0,
          1,
        ),
      ]),
    ).toBeUndefined()
  })

  it("certifies a bound that covers the measured deviation of a grid-invisible excursion", () => {
    const { poles, y } = gridInvisibleCurve(0.001)
    const chain = fitRationalBezierChain([
      bezierCurvePiece(
        poles,
        poles.map(() => 1),
        0,
        1,
      ),
    ])
    if (!chain) throw new Error("A smooth polynomial edge must fit within 64 segments.")
    const segments = (chain.poles.length - 1) / 3
    // A single Hermite segment is the straight line y = 0, 0.001 mm away from the curve.
    expect(segments).toBeGreaterThan(1)
    expect(chain.maxDeviation).toBeLessThanOrEqual(1e-4)
    // One piece, uniformly subdivided: segment i covers [i / N, (i + 1) / N] of the curve.
    let measured = 0
    for (let sample = 0; sample <= 50_000; sample += 1) {
      const u = sample / 50_000
      const segment = Math.min(Math.floor(u * segments), segments - 1)
      const fitted = chainPoint(chain.poles, segment, u * segments - segment)
      measured = Math.max(measured, Math.hypot(fitted[0] - u, fitted[1] - bernsteinValue(y, u)))
    }
    expect(measured).toBeLessThanOrEqual(chain.maxDeviation)
  })

  it("refuses an uncertifiable edge quickly", () => {
    const { poles } = gridInvisibleCurve(0.01)
    const piece = bezierCurvePiece(
      poles,
      poles.map(() => 1),
      0,
      1,
    )
    const started = performance.now()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(fitRationalBezierChain([piece])).toBeUndefined()
    }
    // Generous guard: early exits keep each refusal far below the old 20-55 ms.
    expect((performance.now() - started) / 5).toBeLessThan(40)
  })

  it("decomposes a rational clamped B-spline into exact Bezier pieces", () => {
    // A quarter-circle NURBS split into two spans by a repeated quadratic knot insertion.
    const r = 10
    const w = Math.SQRT1_2
    const curve = {
      degree: 2,
      knots: [0, 0, 0, 0.5, 0.5, 1, 1, 1],
      poles: [
        [r, 0, 0],
        [r, r, 0],
        [0, r, 0],
        [-r, r, 0],
        [-r, 0, 0],
      ] as Point[],
      weights: [1, w, 1, w, 1],
    }
    const pieces = nurbsBezierPieces(curve)
    expect(pieces?.map(({ first, last }) => [first, last])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ])
    const chain = fitRationalBezierChain(pieces as RationalBezierPiece[])
    if (!chain) throw new Error("A rational half circle must fit within 64 segments.")
    // Every chain point lies on the circle within the proven bound.
    const segments = (chain.poles.length - 1) / 3
    for (let segment = 0; segment < segments; segment += 1) {
      for (let sample = 0; sample <= 64; sample += 1) {
        const [x, y] = chainPoint(chain.poles, segment, sample / 64)
        expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThanOrEqual(chain.maxDeviation + 1e-12)
      }
    }
  })

  it("inserts interior knots of a cubic B-spline without changing the curve", () => {
    const curve = {
      degree: 3,
      knots: [0, 0, 0, 0, 0.3, 0.7, 1, 1, 1, 1],
      poles: [
        [0, 0, 0],
        [2, 5, 0],
        [5, -3, 0],
        [8, 4, 0],
        [11, 1, 0],
        [14, 3, 0],
      ] as Point[],
      weights: [1, 1, 1, 1, 1, 1],
    }
    const pieces = nurbsBezierPieces(curve)
    expect(pieces).toHaveLength(3)
    // Polynomial cubic pieces are reproduced exactly by one Hermite segment each.
    const chain = fitRationalBezierChain(pieces as RationalBezierPiece[])
    expect(chain?.poles).toHaveLength(10)
    expect(chain?.maxDeviation).toBeLessThan(1e-9)
    expect(chain?.poles[0]).toEqual([0, 0, 0])
    expect(chain?.poles.at(-1)).toEqual([14, 3, 0])
  })

  it("fits the same curve, traversed backwards, for a reversed parameterization", () => {
    const { poles } = gridInvisibleCurve(0.001)
    const lifted = poles.map(([x, y]): Point => [x * 20, y + x * 3, 1])
    const ones = lifted.map(() => 1)
    const forward = fitRationalBezierChain([bezierCurvePiece(lifted, ones, 0, 1)])
    const reversed = fitRationalBezierChain([bezierCurvePiece([...lifted].reverse(), ones, 0, 1)])
    expect(forward?.poles[0]).toEqual([0, 0, 1])
    expect(reversed?.poles.length).toBe(forward?.poles.length)
    // Fits follow the parameterization; consumers pair ends with stored anchors instead.
    const backwards = [...(reversed?.poles ?? [])].reverse()
    for (const [index, pole] of (forward?.poles ?? []).entries()) {
      const other = backwards[index] as Point
      for (const axis of [0, 1, 2] as const) expect(other[axis]).toBeCloseTo(pole[axis], 9)
    }
  })
})
