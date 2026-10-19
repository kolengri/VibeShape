import { describe, expect, it } from "bun:test"
import { splitManipulatorFrame, splitSupportPlane } from "./split-manipulator"

describe("Split direct manipulation frame", () => {
  it("keeps signed offsets on the oriented support normal and projects the body center onto its base plane", () => {
    const result = splitManipulatorFrame(
      { origin: [2, 3, 4], normal: [0, -1, 0] },
      { min: [10, 20, 30], max: [30, 40, 50] },
      -6,
    )
    expect(result?.origin).toEqual([20, 3, 40])
    expect(result?.direction).toEqual([0, -1, 0])
    expect(result?.distance).toBe(-6)
    expect(result?.toolPlane.origin).toEqual([20, 9, 40])
  })
  it("supports every legacy plane and fails closed for unresolved authored references", () => {
    expect(splitSupportPlane(undefined, "XY")?.normal).toEqual([0, 0, 1])
    expect(splitSupportPlane(undefined, "XZ")?.normal).toEqual([0, 1, 0])
    expect(splitSupportPlane(undefined, "YZ")?.normal).toEqual([1, 0, 0])
    expect(splitSupportPlane(null, "XY")).toBeNull()
    expect(
      splitSupportPlane({ kind: "explicit-plane", origin: [1, 2, 3], normal: [1, 0, 0] }, "XY")
        ?.origin,
    ).toEqual([1, 2, 3])
    expect(splitSupportPlane(undefined, "XZ", () => null)).toBeNull()
  })
  it("rejects nonfinite, out-of-range and degenerate plane frames", () => {
    const bounds = { min: [0, 0, 0], max: [10, 10, 10] } as const
    expect(splitManipulatorFrame({ origin: [0, 0, 0], normal: [0, 0, 0] }, bounds, 0)).toBeNull()
    expect(
      splitManipulatorFrame({ origin: [0, 0, 0], normal: [0, 0, 1] }, bounds, -100_001),
    ).toBeNull()
    expect(
      splitManipulatorFrame({ origin: [Number.NaN, 0, 0], normal: [0, 0, 1] }, bounds, 0),
    ).toBeNull()
  })
})
