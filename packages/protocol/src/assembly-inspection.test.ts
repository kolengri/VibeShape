import { describe, expect, it } from "bun:test"
import { inspectAssemblyInputSchema } from "./assembly-inspection"

const id = (n: number) => `01950000-0000-7000-8000-${String(n).padStart(12, "0")}`
const input = {
  authorityJson: "{}",
  sourceAssets: [],
  mesh: { chordTolerance: 0.1, angularTolerance: 0.1 },
  interferencePairs: Array.from({ length: 33 }, (_, n) => ({
    leftInstanceId: id(1),
    rightInstanceId: id(n + 2),
  })),
}
describe("exact clearance worker request budget", () => {
  it("bounds native distance work per pose without narrowing existing interference requests", () => {
    expect(inspectAssemblyInputSchema.safeParse(input).success).toBe(true)
    expect(inspectAssemblyInputSchema.safeParse({ ...input, measureDistance: true }).success).toBe(
      false,
    )
    expect(
      inspectAssemblyInputSchema.safeParse({
        ...input,
        interferencePairs: input.interferencePairs.slice(0, 32),
        measureDistance: true,
      }).success,
    ).toBe(true)
  })
})
