import { describe, expect, it } from "vitest"
import {
  authoredTestBody,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../../test-support/authored-tree-fixture"
import { authoredPlacementTarget } from "./authored-part-selection"

const part = requireAuthoredFixture(authoredTreeFixture().authority.parts[0])
const body = authoredTestBody(part)

describe("selected Part exact-operation eligibility", () => {
  it("accepts only the current visible valid single positive-volume exact solid", () => {
    expect(authoredPlacementTarget({ part, body, status: "available" })).toEqual(
      part.bodyHistory.at(-1),
    )
    expect(
      authoredPlacementTarget({
        part,
        body: { ...body, representation: "exact-solid" },
        status: "available",
      }),
    ).toEqual(part.bodyHistory.at(-1))
  })
  it.each([
    { ...body, representation: "triangle-mesh" as const },
    { ...body, shape: { ...body.shape, valid: false } },
    { ...body, shape: { ...body.shape, solidCount: 0 } },
    { ...body, shape: { ...body.shape, solidCount: 2 } },
    { ...body, shape: { ...body.shape, volume: 0 } },
  ])("rejects mesh or invalid exact geometry before exposing a modeling target", (body) => {
    expect(authoredPlacementTarget({ part, body, status: "available" })).toBeNull()
  })
  it.each(["upstream", "consumed", "unavailable"] as const)("rejects a %s fallback", (status) => {
    expect(authoredPlacementTarget({ part, body, status })).toBeNull()
  })
  it("rejects a hidden or missing current body", () => {
    expect(
      authoredPlacementTarget({ part: { ...part, visible: false }, body, status: "available" }),
    ).toBeNull()
    expect(authoredPlacementTarget({ part, body: null, status: "available" })).toBeNull()
    expect(authoredPlacementTarget(undefined)).toBeNull()
  })
})
