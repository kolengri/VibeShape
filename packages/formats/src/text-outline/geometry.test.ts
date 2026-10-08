import { describe, expect, it } from "bun:test"
import { glyphContours } from "./contours"
import { elevateQuadratic, outlineBounds } from "./geometry"

describe("exact text curve conversion", () => {
  it("degree-elevates a quadratic without changing any curve position", () => {
    const start: [number, number] = [1, 2]
    const control: [number, number] = [4, 8]
    const end: [number, number] = [9, 3]
    const cubic = elevateQuadratic(start, control, end)
    if (cubic.kind !== "cubic-bezier") throw new Error("Quadratic elevation must return a cubic.")
    expect(cubic.control1).toEqual([3, 6])
    expect(cubic.control2).toEqual([9 + (2 / 3) * (4 - 9), 3 + (2 / 3) * (8 - 3)])
    for (const t of [0, 0.01, 0.2, 0.5, 0.8, 0.99, 1]) {
      const u = 1 - t
      for (const axis of [0, 1] as const) {
        const quadratic = u * u * start[axis] + 2 * u * t * control[axis] + t * t * end[axis]
        const elevated =
          u ** 3 * cubic.start[axis] +
          3 * u * u * t * cubic.control1[axis] +
          3 * u * t * t * cubic.control2[axis] +
          t ** 3 * cubic.end[axis]
        expect(elevated).toBeCloseTo(quadratic, 12)
      }
    }
  })

  it("uses derivative extrema rather than the control hull for bounds", () => {
    expect(
      outlineBounds([
        {
          kind: "cubic-bezier",
          start: [0, 0],
          control1: [0, 10],
          control2: [10, 10],
          end: [10, 0],
        },
      ]),
    ).toEqual({ min: [0, 0], max: [10, 7.5] })
    expect(outlineBounds([elevateQuadratic([0, 0], [5, 10], [10, 0])]).max[1]).toBeCloseTo(5, 12)
  })

  it("preserves closed contours, direct cubics and exact quadratic endpoints", () => {
    const budget = { segmentCount: 0, poleCount: 0 }
    const contours = glyphContours(
      [
        { type: "M", x: 0, y: 0 },
        { type: "Q", x1: 2, y1: 4, x: 4, y: 0 },
        { type: "C", x1: 6, y1: -1, x2: 7, y2: -2, x: 8, y: 0 },
        { type: "Z" },
      ],
      10,
      2,
      0,
      budget,
    )
    expect(contours[0]?.segments.map((segment) => segment.kind)).toEqual([
      "cubic-bezier",
      "cubic-bezier",
      "line",
    ])
    expect(contours[0]?.segments[0]?.start).toEqual([10, 0])
    expect(contours[0]?.segments[0]?.end).toEqual([18, 0])
    expect(contours[0]?.segments[2]?.end).toEqual([10, 0])
    expect(budget).toEqual({ segmentCount: 3, poleCount: 10 })
  })

  it("rejects unclosed, nonfinite and out-of-order native commands", () => {
    const budget = () => ({ segmentCount: 0, poleCount: 0 })
    expect(() => glyphContours([{ type: "M", x: 0, y: 0 }], 0, 1, 0, budget())).toThrow(
      "not closed",
    )
    expect(() => glyphContours([{ type: "Z" }], 0, 1, 0, budget())).toThrow("no starting point")
    expect(() => glyphContours([{ type: "M", x: NaN, y: 0 }], 0, 1, 0, budget())).toThrow(
      "nonfinite",
    )
    expect(() =>
      glyphContours(
        [
          { type: "M", x: 0, y: 0 },
          { type: "M", x: 1, y: 1 },
        ],
        0,
        1,
        0,
        budget(),
      ),
    ).toThrow("closing command")
  })

  it("enforces the pole cap before appending the next curve", () => {
    const budget = { segmentCount: 999, poleCount: 1_999 }
    expect(() =>
      glyphContours(
        [{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0 }, { type: "Z" }],
        0,
        1,
        0,
        budget,
      ),
    ).toThrow("2,000")
    expect(budget).toEqual({ segmentCount: 999, poleCount: 1_999 })
  })
})
