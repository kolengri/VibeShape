import { describe, expect, it } from "vitest"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  formatDisplayAngle,
  formatDisplayArea,
  formatDisplayLength,
  normalizeExpressionWithDisplayUnit,
  positiveDirectManipulationAngleExpression,
  positiveDirectManipulationLengthExpression,
} from "./document-display-units"

const number = (value: number) => String(Number(value.toFixed(6)))

describe("document display units", () => {
  it("normalizes only a bare dimensional literal into an explicit project unit", () => {
    expect(normalizeExpressionWithDisplayUnit(" 2 ", "in")).toBe("2 in")
    expect(normalizeExpressionWithDisplayUnit("-2.5e-3", "m")).toBe("-2.5e-3 m")
    expect(normalizeExpressionWithDisplayUnit("2 cm", "in")).toBe("2 cm")
    expect(normalizeExpressionWithDisplayUnit("#width", "in")).toBe("#width")
    expect(normalizeExpressionWithDisplayUnit("2 * #width", "in")).toBe("2 * #width")
  })

  it("creates stable explicit defaults and formats canonical values for presentation", () => {
    expect(defaultLengthExpression(25.4, "in")).toBe("1 in")
    expect(defaultAngleExpression(Math.PI / 2, "deg")).toBe("90 deg")
    expect(formatDisplayLength(25.4, "in", number)).toBe("1 in")
    expect(formatDisplayArea(645.16, "in", number)).toBe("1 in²")
    expect(formatDisplayAngle(Math.PI / 2, "deg", number)).toBe("90 deg")
  })

  it("snaps positive direct manipulation to a readable project-unit step", () => {
    expect(positiveDirectManipulationLengthExpression(20.6881479756, "mm")).toBe("20.7 mm")
    expect(positiveDirectManipulationLengthExpression(20.6881479756, "in")).toBe("0.814 in")
    expect(positiveDirectManipulationLengthExpression(0.001, "mm")).toBe("0.1 mm")
  })

  it("snaps angular direct manipulation without losing an exact full revolution", () => {
    expect(positiveDirectManipulationAngleExpression(Math.PI / 3 + 0.004, "deg")).toBe("60 deg")
    expect(positiveDirectManipulationAngleExpression(1.234, "rad")).toBe("1.23 rad")
    expect(positiveDirectManipulationAngleExpression(Math.PI * 2, "deg")).toBe("360 deg")
    expect(positiveDirectManipulationAngleExpression(Math.PI * 2, "rad")).toBe("6.28318530718 rad")
  })
})
