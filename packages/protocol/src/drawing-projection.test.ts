import { describe, expect, it } from "bun:test"
import {
  DRAWING_VIEW_FRAMES,
  DRAWING_VIEW_IDS,
  drawingCurveSchema,
  drawingProjectionSchema,
  drawingProjectionViewsSchema,
} from "./drawing-projection"

describe("drawing projection contract", () => {
  it("defines right-handed orthonormal frames whose up axis points to +Z for side views", () => {
    for (const view of DRAWING_VIEW_IDS) {
      const { normal, xAxis } = DRAWING_VIEW_FRAMES[view]
      const length = (vector: readonly number[]) => Math.hypot(...vector)
      expect(length(normal)).toBeCloseTo(1, 12)
      expect(length(xAxis)).toBeCloseTo(1, 12)
      expect(
        normal.reduce((sum, value, index) => sum + value * (xAxis[index] ?? 0), 0),
      ).toBeCloseTo(0, 12)
    }
    for (const view of ["front", "back", "right", "left"] as const) {
      const { normal: n, xAxis: x } = DRAWING_VIEW_FRAMES[view]
      expect(n[0] * x[1] - n[1] * x[0]).toBeCloseTo(1, 12)
    }
  })

  it("accepts only counter-clockwise partial arcs and bounded polylines", () => {
    const arc = { kind: "arc", center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI }
    expect(drawingCurveSchema.safeParse(arc).success).toBe(true)
    expect(drawingCurveSchema.safeParse({ ...arc, endAngle: -1 }).success).toBe(false)
    expect(drawingCurveSchema.safeParse({ ...arc, endAngle: 2 * Math.PI }).success).toBe(false)
    expect(drawingCurveSchema.safeParse({ kind: "polyline", points: [[0, 0]] }).success).toBe(false)
  })

  it("rejects duplicate views in requests and results", () => {
    expect(drawingProjectionViewsSchema.safeParse(["front", "front"]).success).toBe(false)
    const view = { view: "top", bounds: { min: [0, 0], max: [1, 1] }, edges: [] }
    expect(
      drawingProjectionSchema.safeParse({ chordTolerance: 0.01, bodyCount: 1, views: [view, view] })
        .success,
    ).toBe(false)
  })
})
