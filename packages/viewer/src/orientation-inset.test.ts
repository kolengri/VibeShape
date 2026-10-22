import { describe, expect, it } from "bun:test"
import { orientationInsetPlacement } from "./orientation-inset"

describe("orientationInsetPlacement", () => {
  it("aligns the orientation scene with its overlay legend after a panel inset", () => {
    expect(orientationInsetPlacement(1440, 800)).toEqual({ x: 8, y: 8, size: 80 })
    expect(orientationInsetPlacement(1440, 800, 248)).toEqual({ x: 256, y: 8, size: 80 })
    expect(orientationInsetPlacement(1440, 800, 328)).toEqual({ x: 336, y: 8, size: 80 })
  })

  it("fits small viewports and suppresses an inset without available space", () => {
    expect(orientationInsetPlacement(300, 100, 248)).toEqual({ x: 256, y: 8, size: 36 })
    expect(orientationInsetPlacement(300, 40, 248).size).toBe(24)
    expect(orientationInsetPlacement(200, 100, 248).size).toBe(0)
  })

  it("keeps the orientation scene above floating History and compact task sheets", () => {
    expect(orientationInsetPlacement(1440, 800, 256, 48)).toEqual({ x: 264, y: 56, size: 80 })
    expect(orientationInsetPlacement(390, 600, 8, 520)).toEqual({ x: 16, y: 528, size: 64 })
    expect(orientationInsetPlacement(390, 600, 8, 600).size).toBe(0)
    expect(orientationInsetPlacement(512, 272, 256, 177, 52)).toEqual({ x: 264, y: 185, size: 27 })
    expect(orientationInsetPlacement(512, 272, 256, 220, 52).size).toBe(0)
  })
})
