import { describe, expect, it } from "bun:test"
import {
  coilFeatureContentParametersSchema,
  coilSectionMeridianSpan,
  helixFrame,
  helixLength,
  helixMeridianSpan,
  helixPoint,
  helixStart,
  minimumCoilPitch,
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
    const minimum = minimumCoilPitch(10, { kind: "circular", diameter: 2 })
    expect(
      coilFeatureContentParametersSchema.safeParse({
        ...valid,
        helix: { ...helix, pitch: minimum * (1 - 1e-6) },
      }).success,
    ).toBe(false)
    expect(
      coilFeatureContentParametersSchema.safeParse({
        ...valid,
        section: { kind: "rectangular", width: 20, height: 1 },
      }).success,
    ).toBe(false)
    expect(minimumCoilPitch(1, { kind: "circular", diameter: 2 })).toBe(Number.POSITIVE_INFINITY)
  })

  it.each([
    // Reviewer reproduction: near-axis corners of a wide rectangle climb faster than s / cos α.
    { radius: 5, section: { kind: "rectangular", width: 8, height: 2 }, low: 2.02, high: 2.05 },
    // Codex reproduction: a ⌀1.9 tube on R = 1 touches itself about 0.9 turn later.
    { radius: 1, section: { kind: "circular", diameter: 1.9 }, low: 1.994, high: 2.0 },
  ] as const)(
    "uses the exact meridian span for $section.kind sections on R = $radius",
    (sample) => {
      const content = (pitch: number) => ({
        helix: { ...helix, radius: sample.radius, pitch, turns: 2 },
        section: sample.section,
        operation: "new",
      })
      expect(coilFeatureContentParametersSchema.safeParse(content(sample.low)).success).toBe(false)
      expect(coilFeatureContentParametersSchema.safeParse(content(sample.high)).success).toBe(true)
      const minimum = minimumCoilPitch(sample.radius, sample.section)
      expect(minimum).toBeGreaterThan(sample.low)
      expect(minimum).toBeLessThan(sample.high)
      expect(coilFeatureContentParametersSchema.safeParse(content(minimum)).success).toBe(true)
      expect(coilSectionMeridianSpan(sample.radius, minimum, sample.section)).toBeCloseTo(
        minimum,
        9,
      )
    },
  )

  it("agrees with an independent tube-thickness check for circular sections", () => {
    // A normal tube of radius r is embedded iff r is below the curvature radius and half of
    // every doubly critical self-distance of the centerline (here, the far centerline minimum).
    for (const [radius, diameter] of [
      [1, 1.9],
      [10, 2],
      [3, 4],
    ] as const) {
      const minimum = minimumCoilPitch(radius, { kind: "circular", diameter })
      const curve = { ...helix, radius, pitch: minimum, turns: 2 }
      let closest = Number.POSITIVE_INFINITY
      for (let index = 0; index <= 100_000; index += 1) {
        const turns = 0.5 + index / 100_000
        const [a, b] = [helixPoint(curve, 0), helixPoint(curve, turns)]
        closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
      }
      expect(Math.abs(closest - diameter) / diameter).toBeLessThan(1e-5)
    }
  })

  it("computes helical profile spans from local boundary points", () => {
    // A point on the tangential side of the start crosses the meridian after a partial turn.
    const points = [
      { x: 10, y: 0, a: 0 },
      { x: 10, y: 1, a: 0 },
    ]
    const span = helixMeridianSpan(points, 5, "right")
    expect(span).toBeCloseTo((5 * Math.atan2(1, 10)) / (2 * Math.PI), 12)
    expect(helixMeridianSpan(points, 5, "left")).toBeCloseTo(span, 12)
    expect(() => helixMeridianSpan([{ x: 0, y: 0, a: 0 }], 5, "right")).toThrow("helix axis")
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
