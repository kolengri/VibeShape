import { describe, expect, it } from "bun:test"
import { patternContentOutputRoles, patternFeatureContentParametersSchema } from "./geometry-worker"

describe("pattern worker intent", () => {
  it("bounds canonical linear displacement and circular spans", () => {
    expect(
      patternFeatureContentParametersSchema.parse({
        kind: "linear",
        count: 256,
        axis: "X",
        spacing: -1,
      }),
    ).toMatchObject({ count: 256 })
    expect(
      patternFeatureContentParametersSchema.parse({
        kind: "circular",
        count: 4,
        axis: "Z",
        angle: 2 * Math.PI,
        center: [0, 0, 0],
      }),
    ).toMatchObject({ count: 4 })
    expect(patternContentOutputRoles(3)).toEqual([
      "pattern.instance.0",
      "pattern.instance.1",
      "pattern.instance.2",
    ])
  })
  it.each([
    { kind: "linear", count: 1, axis: "X", spacing: 1 },
    { kind: "linear", count: 257, axis: "X", spacing: 1 },
    { kind: "linear", count: 2.5, axis: "X", spacing: 1 },
    { kind: "linear", count: 3, axis: "X", spacing: 60000 },
    { kind: "linear", count: 2, axis: "X", spacing: 0 },
    { kind: "linear", count: 2, axis: "x", spacing: 1 },
    { kind: "circular", count: 4, axis: "Z", angle: 0, center: [0, 0, 0] },
    { kind: "circular", count: 4, axis: "Z", angle: 2 * Math.PI + 0.01, center: [0, 0, 0] },
    { kind: "circular", count: 4, axis: "Z", angle: 1, center: [100001, 0, 0] },
    { kind: "circular", count: 4, axis: "Z", angle: 1, center: [0, 0, 0], targetBody: {} },
  ])("rejects unsupported or unbounded parameters %j", (parameters) => {
    expect(patternFeatureContentParametersSchema.safeParse(parameters).success).toBe(false)
  })
})
