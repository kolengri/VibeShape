import { describe, expect, it } from "bun:test"
import { validatePatternPathChain } from "./pattern-path"

type Point2 = [number, number]
const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`

function cubic(entity: number, start: Point2, control1: Point2, control2: Point2, end: Point2) {
  return {
    entityId: id(entity),
    type: "cubic-bezier" as const,
    startPointId: id(entity + 100),
    control1PointId: id(entity + 200),
    control2PointId: id(entity + 300),
    endPointId: id(entity + 400),
    start,
    control1,
    control2,
    end,
  }
}
function line(entity: number, start: Point2, end: Point2) {
  return {
    entityId: id(entity),
    type: "line" as const,
    startPointId: id(entity + 100),
    endPointId: id(entity + 200),
    start,
    end,
  }
}

describe("pattern path tangent validation", () => {
  it("accepts a smooth Bezier whose handles leave both endpoints", () => {
    expect(() =>
      validatePatternPathChain([cubic(1, [0, 0], [30, 60], [70, -60], [100, 0])], false),
    ).not.toThrow()
  })

  it.each([
    ["start", cubic(1, [0, 0], [0, 0], [50, 50], [100, 0])],
    ["end", cubic(1, [0, 0], [50, 50], [100, 0], [100, 0])],
  ])("rejects a Bezier handle collapsed onto its %s point", (_end, segment) => {
    expect(() => validatePatternPathChain([segment], false)).toThrow(
      `Pattern path curve ${id(1)} has no tangent at an endpoint`,
    )
  })

  it("rejects a degenerate first or last curve even when joins are G1", () => {
    // The joint at (10, 0) is G1; only the outer handle of the second curve is degenerate.
    const chain = [line(1, [0, 0], [10, 0]), cubic(2, [10, 0], [20, 0], [30, 10], [30, 10])]
    expect(() => validatePatternPathChain(chain, false)).toThrow(
      `Pattern path curve ${id(2)} has no tangent at an endpoint`,
    )
  })

  it("rejects an interior Bezier cusp", () => {
    expect(() =>
      validatePatternPathChain([cubic(1, [0, 0], [10, 10], [0, 10], [10, 0])], false),
    ).toThrow(`Pattern path curve ${id(1)} has a cusp where its tangent is undefined.`)
  })

  it("rejects a cusp on a collinear Bezier whose quadratic term rounds to almost zero", () => {
    // The curve runs forward then back along y = 1.7; the cusp sits at t = 0.0125.
    expect(() =>
      validatePatternPathChain(
        [cubic(1, [0.3, 1.7], [0.4, 1.7], [-3.5, 1.7], [-11.4, 1.7])],
        false,
      ),
    ).toThrow(`Pattern path curve ${id(1)} has a cusp where its tangent is undefined.`)
  })

  it("keeps a sharp but regular Bezier turn", () => {
    expect(() =>
      validatePatternPathChain([cubic(1, [0, 0], [10, 10], [1, 10], [10, 0])], false),
    ).not.toThrow()
  })
})
