import { describe, expect, it } from "vitest"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  formatDisplayAngle,
  formatDisplayArea,
  formatDisplayLength,
  normalizeExpressionWithDisplayUnit,
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
})
