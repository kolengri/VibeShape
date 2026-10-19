import { describe, expect, it } from "bun:test"
import { featureIdSchema } from "@vibeshape/domain"
import { extrusionBodyOptionKey } from "./extrusion-body-options"
import { collectedExtrusionOptions } from "./extrusion-body-test-fixtures"
import {
  extrusionEndBodyPickCandidates,
  extrusionEndFacePickCandidates,
  extrusionEndFaceSelection,
  extrusionTargetPickCandidates,
} from "./extrusion-reference-picking"

describe("Extrude viewport reference adaptation", () => {
  it("keeps exact sibling output roles separate from explicit legacy producer scope", () => {
    const options = collectedExtrusionOptions(undefined, true)
    const legacy = {
      id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3690"),
      label: "Legacy producer",
    }
    const expectedBodies = options.map((option) => {
      const outputRole = option.outputRole
      if (outputRole === undefined) throw new Error("Expected explicit sibling body roles.")
      return {
        id: extrusionBodyOptionKey(option),
        kind: "body" as const,
        featureId: option.id,
        outputRole,
      }
    })
    expect(extrusionTargetPickCandidates([...options, legacy])).toEqual([
      ...expectedBodies,
      { id: legacy.id, kind: "producer" as const, featureId: legacy.id },
    ])
    expect(extrusionEndBodyPickCandidates([...options, legacy])).toHaveLength(2)
    expect(
      extrusionEndBodyPickCandidates(options.map((option) => ({ ...option, contentHash: "" }))),
    ).toEqual([])
  })

  it("maps a curved face click to its exact body, current hash and stable reference", () => {
    const options = collectedExtrusionOptions(undefined, true, "SPHERE")
    const candidates = extrusionEndFacePickCandidates(options)
    const picked = candidates[1]
    const target = options[1]
    if (!picked || !target?.contentHash)
      throw new Error("Expected two selectable curved-face outputs.")
    expect(picked).toMatchObject({
      kind: "face",
      outputRole: "compound.input.1",
      meshFaceId: 1,
    })
    expect(picked.id).not.toBe(candidates[0]?.id)
    expect(picked.id).not.toContain("meshFaceId")
    expect(extrusionEndFaceSelection(options, picked.id)).toEqual({
      endTarget: extrusionBodyOptionKey(target),
      endSourceHash: target.contentHash,
      endFace: JSON.stringify(target.faces?.[0]?.reference),
    })
  })

  it("does not offer a face without current transient hit evidence", () => {
    const options = collectedExtrusionOptions(undefined, false, "PLANE")
    const withoutHits = options.map((option) => ({
      ...option,
      faces: option.faces?.map(({ label, reference }) => ({ label, reference })) ?? [],
    }))
    expect(extrusionEndFacePickCandidates(withoutHits)).toEqual([])
  })

  it("rejects unknown or ambiguous stable face keys instead of choosing the first body", () => {
    const options = collectedExtrusionOptions(undefined, true, "PLANE")
    const candidate = extrusionEndFacePickCandidates(options)[0]
    if (!candidate) throw new Error("Expected a selectable planar face.")
    expect(extrusionEndFaceSelection(options, "missing")).toBeUndefined()
    expect(extrusionEndFaceSelection([...options, ...options], candidate.id)).toBeUndefined()
  })
})
