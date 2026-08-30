import { describe, expect, it } from "vitest"
import { intersectBoundedLineWithSupportPlane } from "./pierce-point"
import type { SupportFrame } from "./support-frame"

const xy: SupportFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}

describe("intersectBoundedLineWithSupportPlane", () => {
  it.each([[[-1, 0, -1], [1, 0, 1], { x: 0, y: 0 }]] as const)(
    "returns the finite transverse intersection",
    (start, end, expected) => {
      expect(intersectBoundedLineWithSupportPlane(start, end, xy)).toEqual(expected)
    },
  )

  it.each([
    [
      [-1, 0, 1],
      [1, 0, 1],
    ],
    [
      [-1, 0, 0],
      [1, 0, 0],
    ],
    [
      [-1, 0, 1],
      [-0.5, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
    [
      [Number.NaN, 0, 0],
      [0, 0, 1],
    ],
  ] as const)("fails closed for non-piercing or invalid segments", (start, end) => {
    expect(intersectBoundedLineWithSupportPlane(start, end, xy)).toBeNull()
  })
})
