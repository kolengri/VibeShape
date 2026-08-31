import { describe, expect, it } from "vitest"
import {
  createSketchProfileSet,
  MAX_SKETCH_PROFILE_SET_BOUNDARY_ENTITIES,
  MAX_SKETCH_PROFILE_SET_PROFILES,
  sketchProfileSelectorSchema,
  sketchProfileSetSchema,
} from "./sketch-profile-selector"

const sketchId = "018f0000-0000-7000-8000-000000000001"
const entityA = "018f0000-0000-7000-8000-000000000002"
const entityB = "018f0000-0000-7000-8000-000000000003"
const entityC = "018f0000-0000-7000-8000-000000000004"
const entityD = "018f0000-0000-7000-8000-000000000005"
const entityE = "018f0000-0000-7000-8000-000000000006"

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

  it("canonicalizes a bounded set of stable profile selectors", () => {
    const first = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityA],
      holeBoundaryEntityIds: [],
    })
    const second = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityE],
      holeBoundaryEntityIds: [],
    })
    expect(createSketchProfileSet([second, first])).toEqual({
      schemaVersion: 0,
      profiles: [first, second],
    })
  })

  it("allows adjacent selected regions to share one analytical boundary", () => {
    const outerWithHole = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityA],
      holeBoundaryEntityIds: [[entityB]],
    })
    const innerRegion = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityB],
      holeBoundaryEntityIds: [],
    })
    expect(createSketchProfileSet([outerWithHole, innerRegion]).profiles).toHaveLength(2)
  })

  it("rejects empty, duplicate, noncanonical, and over-budget profile sets", () => {
    const first = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityA],
      holeBoundaryEntityIds: [],
    })
    const second = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityE],
      holeBoundaryEntityIds: [],
    })
    expect(sketchProfileSetSchema.safeParse({ schemaVersion: 0, profiles: [] }).success).toBe(false)
    expect(
      sketchProfileSetSchema.safeParse({ schemaVersion: 0, profiles: [first, first] }).success,
    ).toBe(false)
    expect(
      sketchProfileSetSchema.safeParse({ schemaVersion: 0, profiles: [second, first] }).success,
    ).toBe(false)
    expect(
      sketchProfileSetSchema.safeParse({
        schemaVersion: 0,
        profiles: Array.from({ length: MAX_SKETCH_PROFILE_SET_PROFILES + 1 }, (_, index) => ({
          schemaVersion: 0,
          sketchId,
          outerBoundaryEntityIds: [entityId(index + 1)],
          holeBoundaryEntityIds: [],
        })),
      }).success,
    ).toBe(false)

    const aggregateEntities = Array.from(
      { length: MAX_SKETCH_PROFILE_SET_BOUNDARY_ENTITIES + 1 },
      (_, index) => entityId(index + 1),
    )
    expect(
      sketchProfileSetSchema.safeParse({
        schemaVersion: 0,
        profiles: [
          {
            schemaVersion: 0,
            sketchId,
            outerBoundaryEntityIds: aggregateEntities.slice(0, 1_001),
            holeBoundaryEntityIds: [],
          },
          {
            schemaVersion: 0,
            sketchId,
            outerBoundaryEntityIds: aggregateEntities.slice(1_001),
            holeBoundaryEntityIds: [],
          },
        ],
      }).success,
    ).toBe(false)
  })
})
