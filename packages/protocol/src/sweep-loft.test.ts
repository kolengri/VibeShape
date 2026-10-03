import { describe, expect, it } from "vitest"
import {
  analyticalProfileSchema,
  analyticalSweepPathSchema,
  loftFeatureContentParametersSchema,
  sweepFeatureContentParametersSchema,
} from "./sweep-loft"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const xyFrame = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
const yzFrame = { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] }
const circle = (value: number, radius: number) => ({
  sourceEntityIds: [id(value)],
  segments: [{ entityId: id(value), type: "circle", center: [0, 0], radius }],
})
const profile = (value = 1) => ({
  sketchId: id(value + 100),
  frame: yzFrame,
  outer: circle(value, 2),
  holes: [],
})
const line = (value: number, start: number[], end: number[]) => ({
  entityId: id(value),
  type: "line",
  startPointId: id(value + 1000),
  endPointId: id(value + 1001),
  start,
  end,
})
const path = {
  sketchId: id(200),
  frame: xyFrame,
  sourceEntityIds: [id(2)],
  segments: [line(2, [0, 0], [10, 0])],
  startPointId: id(1002),
}

describe("prepared analytical Sweep and Loft contracts", () => {
  it("rejects an oversized spine before endpoint-neighborhood validation", () => {
    const segments = Array.from({ length: 2_001 }, (_, index) =>
      line(index + 2, [index, 0], [index + 1, 0]),
    )
    expect(
      analyticalSweepPathSchema.safeParse({
        ...path,
        segments,
        sourceEntityIds: segments.map(({ entityId }) => entityId),
      }).success,
    ).toBe(false)
  })
  it("preserves ordered Loft sections and explicit support identity", () => {
    const first = {
      ...profile(3),
      supportFeatureId: id(300),
      frame: { ...yzFrame, origin: [10, 0, 0] },
    }
    const second = profile(1)
    const prepared = loftFeatureContentParametersSchema.parse({
      sections: [first, second],
      ruled: true,
    })
    expect(prepared.sections.map(({ sketchId }) => sketchId)).toEqual([
      first.sketchId,
      second.sketchId,
    ])
    expect(prepared.sections[0]?.supportFeatureId).toBe(id(300))
  })
  it("accepts a holed profile and an exact G1 line-arc spine", () => {
    const arc = {
      entityId: id(3),
      type: "arc",
      startPointId: id(1003),
      endPointId: id(1004),
      start: [5, 0],
      middle: [5 + 5 / Math.sqrt(2), 5 - 5 / Math.sqrt(2)],
      end: [10, 5],
    }
    const prepared = sweepFeatureContentParametersSchema.parse({
      profile: { ...profile(), holes: [circle(4, 1)] },
      path: { ...path, sourceEntityIds: [id(2), id(3)], segments: [line(2, [0, 0], [5, 0]), arc] },
    })
    expect(prepared.profile.holes).toHaveLength(1)
    expect(prepared.path.segments[1]).toEqual(arc)
  })
  it.each([
    { sections: [profile()], ruled: false },
    { sections: Array.from({ length: 9 }, (_, index) => profile(index + 1)), ruled: false },
    { sections: [profile(), profile()], ruled: false },
    { sections: [{ ...profile(), holes: [circle(4, 1)] }, profile(3)], ruled: false },
    { sections: [profile(), profile(3)], ruled: "false" },
    { sections: [profile(), profile(3)], ruled: false, independentPartId: id(900) },
  ])("rejects invalid or noncanonical Loft input %j", (input) => {
    expect(loftFeatureContentParametersSchema.safeParse(input).success).toBe(false)
  })
  it.each([
    { ...profile(), origin: [0, 0, 0] },
    { ...profile(), sketchId: "cached-face-1" },
    { ...profile(), holes: [circle(1, 1)] },
    {
      ...profile(),
      outer: {
        sourceEntityIds: [id(1)],
        segments: [...circle(1, 2).segments, ...circle(1, 2).segments],
      },
    },
    { ...profile(), frame: { ...yzFrame, normal: [0, 1, 0] } },
  ])("rejects invalid profile source/geometry %j", (input) => {
    expect(analyticalProfileSchema.safeParse(input).success).toBe(false)
  })
  it.each(
    [
      [line(2, [0, 0], [5, 0]), line(3, [6, 0], [10, 0])],
      [line(2, [0, 0], [5, 0]), line(3, [5, 0], [5, 5])],
      [line(2, [0, 0], [5, 0]), line(3, [5, 0], [0, 0])],
      [line(2, [0, 0], [0, 0])],
      [line(2, [0, 0], [5, 0]), line(3, [5, 0], [10, 0]), line(4, [5, 0], [5, 5])],
      [line(2, [0, 0], [5, 0]), line(2, [5, 0], [10, 0])],
      [
        {
          entityId: id(2),
          type: "arc",
          startPointId: id(1002),
          endPointId: id(1003),
          start: [0, 0],
          middle: [5, 0],
          end: [10, 0],
        },
      ],
    ].map((segments) => ({ segments })),
  )("rejects disconnected, branched, degenerate or non-G1 analytical spines", ({ segments }) => {
    expect(
      analyticalSweepPathSchema.safeParse({
        ...path,
        sourceEntityIds: [...new Set(segments.map(({ entityId }) => entityId))].sort(),
        segments,
      }).success,
    ).toBe(false)
  })
  it.each([
    { ...path, startPointId: id(1999) },
    { ...path, sourceEntityIds: [id(3), id(2)] },
    { ...path, segments: circle(2, 2).segments },
    {
      ...path,
      sampledPolyline: [
        [0, 0],
        [10, 0],
      ],
    },
  ])("rejects unsupported or inconsistent path data %j", (input) => {
    expect(analyticalSweepPathSchema.safeParse(input).success).toBe(false)
  })
  it.each([
    { ...profile(), frame: { ...yzFrame, origin: [1, 0, 0] } },
    { ...profile(), frame: xyFrame },
  ])("rejects unaligned placement without repositioning the profile", (input) => {
    expect(sweepFeatureContentParametersSchema.safeParse({ profile: input, path }).success).toBe(
      false,
    )
  })
})
