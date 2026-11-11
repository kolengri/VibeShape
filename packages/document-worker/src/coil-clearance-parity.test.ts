import { describe, expect, it } from "bun:test"
import {
  coilMeridianSpan as domainSpan,
  minimumCoilPitch as domainMinimumPitch,
} from "@vibeshape/domain/part-design-helix"
import {
  coilSectionMeridianSpan as protocolSpan,
  minimumCoilPitch as protocolMinimumPitch,
} from "@vibeshape/protocol"

// The domain cannot import the worker protocol, so it mirrors the Coil clearance rule (ADR-0155).
// Both copies decide whether authored and prepared content is accepted; they must agree.
const sections = [
  { radius: 10, section: { kind: "circular", diameter: 2 } },
  { radius: 1, section: { kind: "circular", diameter: 1.9 } },
  { radius: 0.4, section: { kind: "circular", diameter: 0.75 } },
  { radius: 250, section: { kind: "circular", diameter: 40 } },
  { radius: 5, section: { kind: "rectangular", width: 8, height: 2 } },
  { radius: 5, section: { kind: "rectangular", width: 2, height: 8 } },
  { radius: 3, section: { kind: "rectangular", width: 5.9, height: 0.5 } },
  { radius: 80, section: { kind: "rectangular", width: 12.5, height: 30 } },
] as const

describe("Coil clearance parity between domain and protocol", () => {
  it.each(sections)("agrees on the minimum pitch for R = $radius, $section.kind", (sample) => {
    const domain = domainMinimumPitch(sample.radius, sample.section)
    const protocol = protocolMinimumPitch(sample.radius, sample.section)
    expect(Number.isFinite(protocol)).toBe(true)
    expect(Math.abs(domain - protocol)).toBeLessThanOrEqual(1e-9 * protocol)
  })

  it.each(sections)("agrees on meridian spans around the minimum for R = $radius", (sample) => {
    const minimum = protocolMinimumPitch(sample.radius, sample.section)
    for (const pitch of [minimum * 0.5, minimum, minimum * 1.5, minimum * 4]) {
      const protocol = protocolSpan(sample.radius, pitch, sample.section)
      expect(Math.abs(domainSpan(sample.radius, pitch, sample.section) - protocol)).toBeLessThan(
        1e-9 * protocol,
      )
    }
  })

  it("agrees that a section reaching the axis has no clear pitch", () => {
    const section = { kind: "rectangular", width: 10, height: 1 } as const
    expect(domainMinimumPitch(5, section)).toBe(Number.POSITIVE_INFINITY)
    expect(protocolMinimumPitch(5, section)).toBe(Number.POSITIVE_INFINITY)
  })
})
