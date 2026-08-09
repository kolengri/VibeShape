import { describe, expect, it } from "vitest"
import { sketchProfileSelectorSchema } from "./sketch-profile-selector"

const sketchId = "018f0000-0000-7000-8000-000000000001"
const entityA = "018f0000-0000-7000-8000-000000000002"
const entityB = "018f0000-0000-7000-8000-000000000003"
const entityC = "018f0000-0000-7000-8000-000000000004"
const entityD = "018f0000-0000-7000-8000-000000000005"

function entityId(index: number) {
  return `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`
}

function selector() {
  return {
    schemaVersion: 0,
    sketchId,
    outerBoundaryEntityIds: [entityA, entityB],
    holeBoundaryEntityIds: [[entityC], [entityD]],
  }
}

describe("sketch profile selector", () => {
  it("accepts canonical stable boundary intent", () => {
    expect(sketchProfileSelectorSchema.parse(selector())).toMatchObject({
      sketchId,
      outerBoundaryEntityIds: [entityA, entityB],
      holeBoundaryEntityIds: [[entityC], [entityD]],
    })
  })

  it("rejects empty, duplicate, unsorted, overlapping, and unknown selector data", () => {
    expect(
      sketchProfileSelectorSchema.safeParse({ ...selector(), outerBoundaryEntityIds: [] }).success,
    ).toBe(false)
    expect(
      sketchProfileSelectorSchema.safeParse({
        ...selector(),
        outerBoundaryEntityIds: [entityA, entityA],
      }).success,
    ).toBe(false)
    expect(
      sketchProfileSelectorSchema.safeParse({
        ...selector(),
        outerBoundaryEntityIds: [entityB, entityA],
      }).success,
    ).toBe(false)
    expect(
      sketchProfileSelectorSchema.safeParse({
        ...selector(),
        holeBoundaryEntityIds: [[entityD], [entityC]],
      }).success,
    ).toBe(false)
    expect(
      sketchProfileSelectorSchema.safeParse({
        ...selector(),
        holeBoundaryEntityIds: [[entityA]],
      }).success,
    ).toBe(false)
    expect(sketchProfileSelectorSchema.safeParse({ ...selector(), schemaVersion: 1 }).success).toBe(
      false,
    )
    expect(
      sketchProfileSelectorSchema.safeParse({
        ...selector(),
        outerBoundaryEntityIds: [entityId(1)],
        holeBoundaryEntityIds: Array.from({ length: 2_000 }, (_, index) => [entityId(index + 2)]),
      }).success,
    ).toBe(false)
    expect(
      sketchProfileSelectorSchema.safeParse({ ...selector(), transientProfileIndex: 0 }).success,
    ).toBe(false)
  })
})
