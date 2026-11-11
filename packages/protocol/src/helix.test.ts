import { describe, expect, it } from "bun:test"
import {
  coilFeatureContentParametersSchema,
  helixFrame,
  helixLength,
  helixPoint,
  helixStart,
  minimumHelixPitchForSection,
  validateHelicalSweepGeometry,
} from "./helix"

const helix = {
  origin: [0, 0, 0] as [number, number, number],
  direction: [0, 0, 1] as [number, number, number],
  handedness: "right" as const,
  radius: 10,
  pitch: 5,
  turns: 2,
  startAngle: 0,
}

describe("helix content conventions", () => {
  it("uses the cyclic seed zero direction and rotates it by the start angle", () => {
    expect(helixFrame(helix).radial).toEqual([1, 0, 0])
    expect(helixFrame({ ...helix, direction: [1, 0, 0] }).radial).toEqual([0, 1, 0])
    const quarter = helixFrame({ ...helix, startAngle: Math.PI / 2 }).radial
    expect(quarter[0]).toBeCloseTo(0, 12)
    expect(quarter[1]).toBeCloseTo(1, 12)
  })

  it("advances counterclockwise for right-handed helices and clockwise for left", () => {
    expect(helixPoint(helix, 0.25)[1]).toBeCloseTo(10, 12)
    expect(helixPoint({ ...helix, handedness: "left" }, 0.25)[1]).toBeCloseTo(-10, 12)
    expect(helixPoint(helix, 1)[2]).toBeCloseTo(5, 12)
    const start = helixStart(helix)
    expect(start.point).toEqual([10, 0, 0])
    expect(Math.hypot(...start.tangent)).toBeCloseTo(1, 12)
    expect(helixLength(helix)).toBeCloseTo(2 * Math.hypot(20 * Math.PI, 5), 12)
  })

  it("rejects coil sections that reach the axis or overlap adjacent turns", () => {
    const valid = { helix, section: { kind: "circular", diameter: 2 }, operation: "new" }
    expect(coilFeatureContentParametersSchema.safeParse(valid).success).toBe(true)
    const minimum = minimumHelixPitchForSection(10, 2)
    expect(
      coilFeatureContentParametersSchema.safeParse({
        ...valid,
        helix: { ...helix, pitch: minimum },
      }).success,
    ).toBe(false)
    expect(
      coilFeatureContentParametersSchema.safeParse({
        ...valid,
        section: { kind: "rectangular", width: 20, height: 1 },
      }).success,
    ).toBe(false)
    expect(minimumHelixPitchForSection(1, 7)).toBe(Number.POSITIVE_INFINITY)
  })

  it("requires the profile plane through the start and normal to the start tangent", () => {
    const start = helixStart(helix)
    const frame = { origin: [10, 0, 0] as const, normal: start.tangent }
    expect(() => validateHelicalSweepGeometry({ frame }, helix)).not.toThrow()
    expect(() =>
      validateHelicalSweepGeometry({ frame: { ...frame, origin: [10, 0, 1] } }, helix),
    ).toThrow("helix start")
    expect(() =>
      validateHelicalSweepGeometry({ frame: { ...frame, normal: [0, 1, 0] } }, helix),
    ).toThrow("normal to its tangent")
  })
})
