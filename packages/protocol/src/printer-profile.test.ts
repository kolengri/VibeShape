import { describe, expect, it } from "vitest"
import { printerProfileSchema } from "./printer-profile"

const profile = {
  version: 1,
  name: "Custom printer",
  width: 220,
  depth: 180,
  height: 250,
}

describe("rectangular printer profiles", () => {
  it("defaults to a rectangular bed without a margin", () => {
    expect(printerProfileSchema.parse(profile)).toEqual({
      ...profile,
      bedShape: "rectangular",
      margin: 0,
    })
  })

  it("accepts bounded dimensions and an inset that preserves both bed axes", () => {
    expect(
      printerProfileSchema.safeParse({ ...profile, width: 100_000, margin: 89.9 }).success,
    ).toBe(true)
    expect(printerProfileSchema.safeParse({ ...profile, width: 0.001, margin: 0 }).success).toBe(
      true,
    )
  })

  it.each(["width", "depth", "height"])("rejects invalid %s dimensions", (axis) => {
    for (const value of [0, -1, 100_001, Number.NaN, Infinity, -Infinity, "220", null]) {
      expect(printerProfileSchema.safeParse({ ...profile, [axis]: value }).success).toBe(false)
    }
  })

  it.each([-1, 90, 100, Number.NaN, Infinity, -Infinity, "5"])(
    "rejects a negative, invalid, or bed-consuming margin %s",
    (margin) => {
      expect(printerProfileSchema.safeParse({ ...profile, margin }).success).toBe(false)
    },
  )

  it("checks the narrower bed axis regardless of which axis it is", () => {
    expect(
      printerProfileSchema.safeParse({ ...profile, width: 100, depth: 200, margin: 50 }).success,
    ).toBe(false)
  })

  it.each([
    null,
    undefined,
    {},
    { ...profile, version: 2 },
    { ...profile, version: "1" },
    { ...profile, name: "" },
    { ...profile, name: " \t " },
    { ...profile, name: 1 },
    { ...profile, bedShape: "circular" },
    { ...profile, origin: "corner" },
  ])("rejects malformed, unsupported, or unknown profile fields %j", (raw) => {
    expect(printerProfileSchema.safeParse(raw).success).toBe(false)
  })
})
