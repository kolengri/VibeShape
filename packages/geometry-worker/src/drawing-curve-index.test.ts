import { describe, expect, it } from "bun:test"
import {
  type DrawingCurve,
  MAX_DRAWING_CURVE_POINTS,
  MAX_DRAWING_CURVE_SAMPLES,
} from "@vibeshape/protocol"
import { CurveIndex, curvesExtent } from "./drawing-curve-index"
import { ChordCache } from "./drawing-round-chords"

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

describe("round coverage reach", () => {
  it("finds a circle's chords for a curve grazing it just beyond the coverage margin", () => {
    // Chords sit up to one sagitta inside the circle, so a stretch about 0.021 mm inside the
    // exact curve is still within the 0.0201 mm capsule of the chord in front of it.
    const shape = { radius: 0.0201, turn: 0.1 }
    const circle: DrawingCurve = { kind: "circle", center: [0, 0], radius: 10 }
    const index = new CurveIndex(curvesExtent([circle]), {
      margin: 0.0202,
      chords: new ChordCache(shape),
    })
    index.add(circle)
    const step =
      (2 * Math.PI) / Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - shape.radius / 10 / 10)))
    const angle = step / 2
    const inner = 10 - 0.021
    const tangent: [number, number] = [-Math.sin(angle) * 0.005, Math.cos(angle) * 0.005]
    const middle: [number, number] = [inner * Math.cos(angle), inner * Math.sin(angle)]
    const pieces = index.coveringPieces(
      [middle[0] - tangent[0], middle[1] - tangent[1]],
      [middle[0] + tangent[0], middle[1] + tangent[1]],
    )
    expect(pieces.length).toBeGreaterThan(0)
  })
})
