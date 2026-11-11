import { describe, expect, it } from "bun:test"
import {
  type DrawingCurve,
  MAX_DRAWING_CURVE_POINTS,
  MAX_DRAWING_CURVE_SAMPLES,
} from "@vibeshape/protocol"
import { curvesExtent } from "./drawing-curve-index"

function polyline(count: number, offset: number): DrawingCurve {
  return {
    kind: "polyline",
    points: Array.from({ length: count }, (_, index): [number, number] => [
      offset + index * 1e-3,
      Math.sin(index) - offset,
    ]),
  }
}

describe("curve extent", () => {
  it("accumulates the extent of 160 polylines at the per-curve point limit", () => {
    const curves = Array.from({ length: 160 }, (_, index) =>
      polyline(MAX_DRAWING_CURVE_POINTS, index),
    )
    const [minX, minY, maxX, maxY] = curvesExtent(curves)
    expect(minX).toBe(0)
    expect(maxX).toBeCloseTo(159 + (MAX_DRAWING_CURVE_POINTS - 1) * 1e-3, 9)
    expect(minY).toBeGreaterThanOrEqual(-160)
    expect(minY).toBeLessThan(-159.99)
    expect(maxY).toBeGreaterThan(0.99)
  })

  it("accumulates the extent of one curve at the per-curve sample limit", () => {
    const [minX, , maxX] = curvesExtent([polyline(MAX_DRAWING_CURVE_SAMPLES, 0)])
    expect(minX).toBe(0)
    expect(maxX).toBeCloseTo((MAX_DRAWING_CURVE_SAMPLES - 1) * 1e-3, 9)
  })
})
