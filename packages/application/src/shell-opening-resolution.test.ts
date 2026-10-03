import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { describe, expect, it } from "vitest"
import { resolveShellOpeningCandidates } from "./shell-opening-resolution"

const scope = { featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f7801", outputRole: "result" }
const reference = bodyFaceRefSchema.parse({
  schemaVersion: 1,
  ...scope,
  kind: "face",
  signature: {
    kind: "face",
    geometryClass: "plane",
    measure: 12,
    centroid: [1, 2, 3],
    bounds: { min: [0, 0, 3], max: [3, 4, 3] },
    boundaryCount: 4,
    adjacentGeometryClasses: [],
  },
})
const { featureId: _featureId, ...content } = reference
const candidate = {
  candidateId: "face:exact",
  kind: "face" as const,
  lineageTokens: [],
  signature: reference.signature,
}
describe("conservative shell opening resolution", () => {
  it("resolves only the selected body and rejects identical ambiguous candidates", () => {
    expect(resolveShellOpeningCandidates([content], [candidate], scope)).toEqual({
      ok: true,
      candidateIds: [candidate.candidateId],
    })
    expect(
      resolveShellOpeningCandidates(
        [content],
        [candidate, { ...candidate, candidateId: "face:duplicate" }],
        scope,
      ),
    ).toEqual({ ok: false, reason: "ambiguous" })
    expect(resolveShellOpeningCandidates([content], [], scope)).toEqual({
      ok: false,
      reason: "missing",
    })
    expect(
      resolveShellOpeningCandidates([{ ...content, outputRole: "body.other" }], [candidate], scope),
    ).toEqual({ ok: false, reason: "missing" })
  })
  it("rejects semantic rebinding to changed geometry and duplicate resolution", () => {
    const semantic = { ...content, semanticRole: "top" }
    const changed = {
      ...candidate,
      semanticRole: "top",
      signature: { ...candidate.signature, measure: 13 },
    }
    expect(resolveShellOpeningCandidates([semantic], [changed], scope)).toEqual({
      ok: false,
      reason: "changed",
    })
    expect(resolveShellOpeningCandidates([content, content], [candidate], scope)).toEqual({
      ok: false,
      reason: "duplicate",
    })
  })
})
