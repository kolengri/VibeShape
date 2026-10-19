import { describe, expect, it } from "bun:test"
import messages from "../../i18n/messages/en.json"
import { parsePlacementForm } from "./placement-form-model"
import { placementManipulatorFrame } from "./placement-manipulator"

const copy = {
  ...messages.app.placement,
  invalidRange: messages.app.placement.invalidTranslationRange,
}
const units = { length: "mm", angle: "deg" } as const
function frame(rotationX = "0 deg", rotationY = "0 deg", rotationZ = "90 deg") {
  const parsed = parsePlacementForm(
    {
      translationX: "5 mm",
      translationY: "-4 mm",
      translationZ: "3 mm",
      rotationX,
      rotationY,
      rotationZ,
    },
    [],
    units,
    copy,
  )
  if (!parsed.ok) throw new Error("Invalid fixture")
  return placementManipulatorFrame(parsed, { min: [10, 20, 30], max: [30, 40, 50] })
}
describe("Placement direct manipulation frame", () => {
  it("anchors translation at the rotated non-origin source center and preserves world-origin rotation", () => {
    const result = frame()
    expect(result?.position[0]).toBeCloseTo(-25)
    expect(result?.position[1]).toBeCloseTo(16)
    expect(result?.position[2]).toBeCloseTo(43)
    const translated = result?.translationForPosition([-20, 18, 45])
    expect(translated?.[0]).toBeCloseTo(10)
    expect(translated?.[1]).toBeCloseTo(-2)
    expect(translated?.[2]).toBeCloseTo(5)
    expect(result?.translationForPosition([Number.NaN, 0, 0])).toBeNull()
    expect(result?.translationForPosition([100_001, 0, 0])).toBeNull()
  })
  it("uses frozen Rz Ry Rx ordering and the effective world axis of each Euler field", () => {
    const result = frame("90 deg", "90 deg", "90 deg")
    expect(result?.position[0]).toBeCloseTo(45)
    expect(result?.position[1]).toBeCloseTo(26)
    expect(result?.position[2]).toBeCloseTo(-17)
    expect(result?.rotation("x").axisDirection[2]).toBeCloseTo(-1)
    expect(result?.rotation("y").axisDirection[0]).toBeCloseTo(-1)
    expect(result?.rotation("z").axisDirection).toEqual([0, 0, 1])
    expect(result?.rotation("x").axisOrigin).toEqual([5, -4, 3])
    expect(result?.rotation("x").minAngle).toBe(-2 * Math.PI)
  })
})
