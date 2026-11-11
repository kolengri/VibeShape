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

function cubicAt(poles: readonly SketchPoint2[], segment: number, t: number) {
  const [p0, p1, p2, p3] = poles.slice(segment * 3, segment * 3 + 4) as SketchPoint2[]
  const s = 1 - t
  const w = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]
  return {
    x:
      (w[0] ?? 0) * (p0?.x ?? 0) +
      (w[1] ?? 0) * (p1?.x ?? 0) +
      (w[2] ?? 0) * (p2?.x ?? 0) +
      (w[3] ?? 0) * (p3?.x ?? 0),
    y:
      (w[0] ?? 0) * (p0?.y ?? 0) +
      (w[1] ?? 0) * (p1?.y ?? 0) +
      (w[2] ?? 0) * (p2?.y ?? 0) +
      (w[3] ?? 0) * (p3?.y ?? 0),
  }
}

describe("model spline projection", () => {
  it("expands a chain to more segments without changing the traced curve", () => {
    for (const target of [2, 3, 5, 8]) {
      const expanded = expandBezierChain(chain, target)
      if (!expanded) throw new Error(`Expansion to ${target} segments must succeed.`)
      expect(expanded).toHaveLength(target * 3 + 1)
      // Published segment 0 spans the first ceil(target / 2) expanded segments.
      const firstShare = Math.ceil(target / 2)
      for (let sample = 0; sample <= 40; sample += 1) {
        const u = sample / 40
        const original = u < 0.5 ? cubicAt(chain, 0, u * 2) : cubicAt(chain, 1, u * 2 - 1)
        const share = u < 0.5 ? firstShare : target - firstShare
        const local = u < 0.5 ? u * 2 : u * 2 - 1
        const piece = Math.min(Math.floor(local * share), share - 1)
        const segment = (u < 0.5 ? 0 : firstShare) + piece
        const fitted = cubicAt(expanded, segment, local * share - piece)
        expect(fitted.x).toBeCloseTo(original.x, 10)
        expect(fitted.y).toBeCloseTo(original.y, 10)
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
