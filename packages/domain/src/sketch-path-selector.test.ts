import { describe, expect, it } from "vitest"
import { sketchPathSelectorKey, sketchPathSelectorSchema } from "./sketch-path-selector"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const selector = {
  schemaVersion: 0,
  sketchId: id(1),
  entityIds: [id(2), id(3)],
  startPointId: id(4),
}

describe("directed sketch path selector", () => {
  it("preserves stable selection and explicit start direction", () => {
    const parsed = sketchPathSelectorSchema.parse(selector)
    expect(parsed).toEqual(selector)
    expect(sketchPathSelectorKey(parsed)).not.toBe(
      sketchPathSelectorKey(sketchPathSelectorSchema.parse({ ...selector, startPointId: id(5) })),
    )
  })
  it.each([
    { entityIds: [] },
    { entityIds: [id(3), id(2)] },
    { entityIds: [id(2), id(2)] },
    { entityIds: Array.from({ length: 2_001 }, (_, index) => id(index + 10)) },
    { startPointId: "point-index-0" },
    { schemaVersion: 1 },
    { transientEdgeIndex: 0 },
  ])("rejects malformed or over-budget selection %j", (replacement) => {
    expect(sketchPathSelectorSchema.safeParse({ ...selector, ...replacement }).success).toBe(false)
  })
})
