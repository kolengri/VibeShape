import { describe, expect, it } from "bun:test"
import type { SketchPoint2 } from "@vibeshape/domain"
import {
  expandBezierChain,
  projectWorldBezierChainToSupport,
  sampleBezierChain,
} from "./model-spline-projection"

const chain: SketchPoint2[] = [
  { x: 0, y: 0 },
  { x: 3, y: 5 },
  { x: 7, y: 5 },
  { x: 10, y: 0 },
  { x: 13, y: -5 },
  { x: 18, y: -2 },
  { x: 20, y: 0 },
]

function pole(poles: readonly SketchPoint2[], index: number): SketchPoint2 {
  const point = poles[index]
  if (!point) throw new Error(`Missing pole ${index}.`)
  return point
}

function cubicAt(poles: readonly SketchPoint2[], segment: number, t: number) {
  const s = 1 - t
  const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]
  return weights.reduce(
    (sum, weight, index) => {
      const point = pole(poles, segment * 3 + index)
      return { x: sum.x + weight * point.x, y: sum.y + weight * point.y }
    },
    { x: 0, y: 0 },
  )
}

/** Evaluates a published segment that owns `share` expanded pieces starting at `offset`. */
function expandedAt(expanded: readonly SketchPoint2[], offset: number, share: number, t: number) {
  const piece = Math.min(Math.floor(t * share), share - 1)
  return cubicAt(expanded, offset + piece, t * share - piece)
}

describe("model spline projection", () => {
  it("expands a chain to more segments without changing the traced curve", () => {
    for (const target of [2, 3, 5, 8]) {
      const expanded = expandBezierChain(chain, target)
      if (!expanded) throw new Error(`Expansion to ${target} segments must succeed.`)
      expect(expanded).toHaveLength(target * 3 + 1)
      // Published segment 0 owns the first ceil(target / 2) expanded segments.
      const firstShare = Math.ceil(target / 2)
      const ownership = [
        { offset: 0, share: firstShare },
        { offset: firstShare, share: target - firstShare },
      ]
      for (const [segment, { offset, share }] of ownership.entries()) {
        for (let sample = 0; sample <= 20; sample += 1) {
          const original = cubicAt(chain, segment, sample / 20)
          const fitted = expandedAt(expanded, offset, share, sample / 20)
          expect(fitted.x).toBeCloseTo(original.x, 10)
          expect(fitted.y).toBeCloseTo(original.y, 10)
        }
      }
    }
    expect(expandBezierChain(chain, 1)).toBeNull()
  })

  it("projects only chains in a plane parallel to the support", () => {
    const frame = {
      origin: [0, 0, 12] as [number, number, number],
      xAxis: [1, 0, 0] as [number, number, number],
      yAxis: [0, 1, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
    }
    const parallel = chain.map(({ x, y }): [number, number, number] => [x, y, 4])
    const projected = projectWorldBezierChainToSupport(frame, parallel)
    expect(projected).toEqual({ ok: true, poles: chain, segmentCount: 2 })
    const tilted = chain.map(({ x, y }): [number, number, number] => [x, y, 4 + x * 1e-3])
    expect(projectWorldBezierChainToSupport(frame, tilted)).toEqual({
      ok: false,
      reason: "not-parallel",
    })
    expect(projectWorldBezierChainToSupport(frame, parallel, 1)).toEqual({
      ok: false,
      reason: "segment-count",
    })
    const collapsed = Array.from({ length: 4 }, (): [number, number, number] => [1, 1, 0])
    expect(projectWorldBezierChainToSupport(frame, collapsed)).toEqual({
      ok: false,
      reason: "degenerate",
    })
    expect(sampleBezierChain(chain, 4)).toHaveLength(9)
  })
})
