import { describe, expect, it } from "vitest"
import { holeFeatureContentParametersSchema } from "./geometry-worker"

const frame = {
  origin: [0, 0, 0] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
}

const valid = {
  frame,
  centers: [[0, 0, 1]] as [number, number, number][],
  diameter: 2,
  direction: "forward" as const,
  extent: "blind" as const,
  depth: 5,
}

describe("hole content parameters", () => {
  it("accepts bounded blind and through-all content", () => {
    expect(holeFeatureContentParametersSchema.safeParse(valid).success).toBe(true)
    expect(
      holeFeatureContentParametersSchema.safeParse({ ...valid, diameter: 0.0001, depth: 0.0001 })
        .success,
    ).toBe(true)
    expect(
      holeFeatureContentParametersSchema.safeParse({
        ...valid,
        extent: "through-all",
        depth: undefined,
        supportInputIndex: 1,
      }).success,
    ).toBe(true)
  })

  it.each([
    {
      centers: [
        [0, 0, 1],
        [0, 0, 1],
      ],
    },
    {
      centers: [
        [0, 0, 2],
        [0, 0, 1],
      ],
    },
    { centers: [] },
    { centers: Array.from({ length: 257 }, (_, index) => [index, 0, 0]) },
    { centers: [[Number.NaN, 0, 0]] },
    { supportInputIndex: -1 },
    { supportInputIndex: 2 },
    { diameter: 0 },
    { diameter: 1_000_001 },
    { depth: 0 },
    { extent: "through-all", depth: 2 },
    { direction: "sideways" },
  ])("rejects malformed content %j", (override) => {
    expect(holeFeatureContentParametersSchema.safeParse({ ...valid, ...override }).success).toBe(
      false,
    )
  })
})
