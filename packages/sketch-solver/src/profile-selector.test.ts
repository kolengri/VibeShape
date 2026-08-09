import { sketchIdSchema } from "@vibeshape/domain/identifiers"
import { sketchProfileSelectorSchema } from "@vibeshape/domain/sketch-profile-selector"
import { describe, expect, it } from "vitest"
import {
  createSketchProfileSelector,
  resolveSketchProfileSelector,
  selectedProfileLoops,
} from "./profile-selector"
import type { SketchProfileLoop, SketchProfileResult } from "./profiles"

const sketchId = sketchIdSchema.parse("018f0000-0000-7000-8000-000000000001")
const otherSketchId = sketchIdSchema.parse("018f0000-0000-7000-8000-000000000099")
const entityA = "018f0000-0000-7000-8000-000000000002"
const entityB = "018f0000-0000-7000-8000-000000000003"
const entityC = "018f0000-0000-7000-8000-000000000004"
const entityD = "018f0000-0000-7000-8000-000000000005"
const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label}.`)
  return value
}

function parsedSelector() {
  return sketchProfileSelectorSchema.parse({
    schemaVersion: 0,
    sketchId,
    outerBoundaryEntityIds: [entityA, entityB],
    holeBoundaryEntityIds: [[entityC]],
  })
}

function loop(
  loopIndex: number,
  sourceEntityIds: SketchProfileLoop["sourceEntityIds"],
): SketchProfileLoop {
  return {
    loopIndex,
    parentLoopIndex: loopIndex === 0 ? null : 0,
    depth: loopIndex === 0 ? 0 : 1,
    signedArea: 100 - loopIndex,
    perimeter: 40,
    bounds,
    sourceEntityIds,
    segments: sourceEntityIds.map((entityId) => ({ entityId, type: "line", reversed: false })),
  }
}

function profileResult(): SketchProfileResult {
  const selector = parsedSelector()
  return {
    schemaVersion: 0,
    loops: [
      loop(0, selector.outerBoundaryEntityIds),
      loop(1, selector.holeBoundaryEntityIds[0] ?? []),
    ],
    profiles: [
      {
        profileIndex: 0,
        outerLoopIndex: 0,
        holeLoopIndices: [1],
        area: 99,
        perimeter: 80,
        bounds,
      },
    ],
    diagnostics: [],
  }
}

describe("stable sketch profile selectors", () => {
  it("creates canonical boundary intent and resolves it after transient indices change", () => {
    const initial = profileResult()
    const selector = createSketchProfileSelector(sketchId, initial, 0)
    expect(selector).toEqual(parsedSelector())
    if (!selector) throw new Error("Expected a profile selector.")

    const entityDId = sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: [entityD],
      holeBoundaryEntityIds: [],
    }).outerBoundaryEntityIds
    const initialOuter = required(initial.loops[0], "initial outer loop")
    const initialHole = required(initial.loops[1], "initial hole loop")
    const reordered: SketchProfileResult = {
      schemaVersion: 0,
      loops: [
        loop(0, entityDId),
        { ...initialOuter, loopIndex: 1 },
        { ...initialHole, loopIndex: 2, parentLoopIndex: 1 },
      ],
      profiles: [
        {
          profileIndex: 0,
          outerLoopIndex: 0,
          holeLoopIndices: [],
          area: 25,
          perimeter: 20,
          bounds,
        },
        {
          profileIndex: 1,
          outerLoopIndex: 1,
          holeLoopIndices: [2],
          area: 99,
          perimeter: 80,
          bounds,
        },
      ],
      diagnostics: [],
    }

    const resolution = resolveSketchProfileSelector(selector, sketchId, reordered)
    expect(resolution).toEqual({
      status: "resolved",
      profileIndex: 1,
      outerLoopIndex: 1,
      holeLoopIndices: [2],
    })
    if (resolution.status !== "resolved") throw new Error("Expected a resolved selector.")
    expect(selectedProfileLoops(resolution, reordered).map(({ loopIndex }) => loopIndex)).toEqual([
      1, 2,
    ])
  })

  it("fails closed for the wrong sketch, unavailable profiles, and changed boundaries", () => {
    const selector = parsedSelector()
    expect(resolveSketchProfileSelector(selector, otherSketchId, profileResult())).toEqual({
      status: "missing",
      reason: "sketch-mismatch",
    })
    expect(
      resolveSketchProfileSelector(selector, sketchId, {
        schemaVersion: 0,
        profiles: [],
        loops: [],
        diagnostics: [{ code: "open-chain", message: "Open chain.", entityIds: [] }],
      }),
    ).toEqual({ status: "missing", reason: "profiles-unavailable" })
    expect(
      resolveSketchProfileSelector(selector, sketchId, {
        ...profileResult(),
        loops: [loop(0, selector.outerBoundaryEntityIds)],
      }),
    ).toEqual({ status: "missing", reason: "boundary-not-found" })
  })

  it("reports ambiguity instead of choosing between duplicate boundary matches", () => {
    const result = profileResult()
    const profile = required(result.profiles[0], "initial profile")
    const duplicate: SketchProfileResult = {
      ...result,
      profiles: [profile, { ...profile, profileIndex: 1 }],
    }

    expect(resolveSketchProfileSelector(parsedSelector(), sketchId, duplicate)).toEqual({
      status: "ambiguous",
      profileIndices: [0, 1],
    })
  })
})
