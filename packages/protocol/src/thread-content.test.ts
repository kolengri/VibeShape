import { describe, expect, it } from "bun:test"
import { threadContentParametersSchema } from "./thread-content"

const value = {
  kind: "external",
  axis: "Z",
  origin: [0, 0, 0],
  nominalDiameter: 10,
  pitch: 2,
  length: 8,
  depth: 0.8,
  clearance: 0.1,
  handedness: "right",
  starts: 1,
  phase: 0,
  runIn: 1,
  runOut: 1,
}
describe("modeled thread numeric content boundary", () => {
  it("accepts canonical custom external and internal intent including maximum resource bounds", () => {
    expect(threadContentParametersSchema.safeParse(value).success).toBe(true)
    expect(
      threadContentParametersSchema.safeParse({
        ...value,
        kind: "internal",
        starts: 4,
        phase: -2 * Math.PI,
        length: 32,
        runIn: 0,
        runOut: 0,
      }).success,
    ).toBe(true)
    expect(
      threadContentParametersSchema.safeParse({
        ...value,
        nominalDiameter: 1000,
        pitch: 20,
        depth: 15,
        length: 1000,
        runIn: 340,
        runOut: 340,
      }).success,
    ).toBe(true)
  })
  it("rejects one extra turn for every start count with a repair instruction", () => {
    for (const starts of [1, 2, 3, 4]) {
      const parsed = threadContentParametersSchema.safeParse({
        ...value,
        starts,
        length: 34,
        runIn: 0,
        runOut: 0,
      })
      expect(parsed.success).toBe(false)
      if (parsed.success) throw new Error("Unexpected over-budget thread fixture")
      expect(parsed.error.issues).toContainEqual({
        code: "custom",
        path: ["pitch"],
        message:
          "Modeled threads allow at most 16 total turns. Reduce the band length or increase the pitch.",
      })
    }
  })
  it.each([
    { kind: "cosmetic" },
    { axis: "camera" },
    { origin: [0, 0] },
    { origin: [NaN, 0, 0] },
    { origin: [100_001, 0, 0] },
    { nominalDiameter: 0 },
    { nominalDiameter: 1001 },
    { pitch: 0.19 },
    { pitch: 20.1 },
    { length: 0 },
    { length: 1001 },
    { depth: 0 },
    { depth: 1.51 },
    { clearance: -1 },
    { clearance: 4.3 },
    { starts: 0 },
    { starts: 5 },
    { starts: 1.5 },
    { phase: 2 * Math.PI + 0.01 },
    { phase: Infinity },
    { handedness: "automatic" },
    { runIn: -1 },
    { runOut: -1 },
    { runIn: 4, runOut: 4 },
    { pitch: 0.2, length: 13, runIn: 0, runOut: 0, depth: 0.1 },
    { profile: "ISO" },
    { targetBody: {} },
  ])("rejects unbounded or unsupported content %j", (changes) => {
    expect(threadContentParametersSchema.safeParse({ ...value, ...changes }).success).toBe(false)
  })
})
