import { describe, expect, it } from "bun:test"
import { type ReferencePickCandidate, resolveReferencePick } from "./reference-picking"

const left: ReferencePickCandidate = {
  id: "left",
  featureId: "split",
  kind: "body",
  outputRole: "left",
}
const right: ReferencePickCandidate = {
  id: "right",
  featureId: "split",
  kind: "body",
  outputRole: "right",
}
const legacy: ReferencePickCandidate = { id: "legacy", featureId: "split", kind: "producer" }
const selection = { featureId: "split", outputRole: "right", faceId: 42, faceOrdinal: 1 }

describe("reference option picking", () => {
  it("distinguishes sibling outputs from one producing feature", () => {
    expect(resolveReferencePick([left, right], selection)?.id).toBe("right")
    expect(resolveReferencePick([right, left], { ...selection, outputRole: "left" })?.id).toBe(
      "left",
    )
  })

  it("accepts a curved face by current mesh evidence without requiring planar support", () => {
    const face: ReferencePickCandidate = {
      id: "cylinder-wall",
      featureId: "split",
      kind: "face",
      outputRole: "right",
      meshFaceId: 42,
    }
    expect(resolveReferencePick([face], selection)?.id).toBe("cylinder-wall")
    expect(resolveReferencePick([face], { ...selection, faceOrdinal: 99 })?.id).toBe(
      "cylinder-wall",
    )
    expect(resolveReferencePick([face], { ...selection, faceId: 43 })).toBeNull()
  })

  it("rejects missing roles instead of inferring the sole candidate", () => {
    expect(
      resolveReferencePick([right], { featureId: "split", faceId: 42, faceOrdinal: 1 }),
    ).toBeNull()
    expect(resolveReferencePick([right], { ...selection, outputRole: "missing" })).toBeNull()
  })

  it("rejects stale features, duplicate bindings, and body-versus-face ambiguity", () => {
    const face: ReferencePickCandidate = {
      id: "face",
      featureId: "split",
      kind: "face",
      outputRole: "right",
      meshFaceId: 42,
    }
    expect(
      resolveReferencePick([right], { ...selection, featureId: "previous-rebuild" }),
    ).toBeNull()
    expect(resolveReferencePick([right, { ...right, id: "other-option" }], selection)).toBeNull()
    expect(resolveReferencePick([right, face], selection)).toBeNull()
  })

  it("permits whole-producer selection only when explicitly authorized", () => {
    expect(
      resolveReferencePick([legacy], { featureId: "split", faceId: 42, faceOrdinal: 1 })?.id,
    ).toBe("legacy")
    expect(resolveReferencePick([legacy], selection)?.id).toBe("legacy")
    expect(resolveReferencePick([legacy, right], selection)?.id).toBe("right")
    expect(resolveReferencePick([legacy, { ...legacy, id: "duplicate" }], selection)).toBeNull()
  })
})
