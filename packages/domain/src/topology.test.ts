import { describe, expect, it } from "vitest"
import { featureIdSchema } from "./identifiers"
import {
  createTopologyReferenceResolver,
  resolveTopologyReference,
  type TopologyCandidate,
  type TopoRef,
  topologySignatureSchema,
} from "./topology"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f21ac")

function faceSignature(overrides: Partial<TopoRef["signature"]> = {}): TopoRef["signature"] {
  return topologySignatureSchema.parse({
    kind: "face",
    geometryClass: "plane",
    measure: 100,
    centroid: [0, 0, 10],
    bounds: { min: [-5, -5, 10], max: [5, 5, 10] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["plane", "plane", "plane", "plane"],
    ...overrides,
  })
}

function reference(overrides: Partial<TopoRef> = {}): TopoRef {
  return {
    schemaVersion: 0,
    featureId,
    kind: "face",
    signature: faceSignature(),
    ...overrides,
  }
}

function candidate(
  candidateId: string,
  overrides: Partial<TopologyCandidate> = {},
): TopologyCandidate {
  return {
    candidateId,
    kind: "face",
    lineageTokens: [],
    signature: faceSignature(),
    ...overrides,
  }
}

describe("resolveTopologyReference", () => {
  it("reuses one validated candidate index across multiple references", () => {
    const resolve = createTopologyReferenceResolver([
      candidate("first", { semanticRole: "extrude.cap.start" }),
      candidate("second", { semanticRole: "extrude.cap.end" }),
    ])

    expect(resolve(reference({ semanticRole: "extrude.cap.start" }))).toMatchObject({
      status: "resolved",
      candidateId: "first",
    })
    expect(resolve(reference({ semanticRole: "extrude.cap.end" }))).toMatchObject({
      status: "resolved",
      candidateId: "second",
    })
  })

  it("prefers one exact semantic role across large parameter changes", () => {
    const result = resolveTopologyReference(reference({ semanticRole: "extrude.cap.end" }), [
      candidate("side", { semanticRole: "extrude.side.profile-edge-1" }),
      candidate("cap", {
        semanticRole: "extrude.cap.end",
        signature: faceSignature({ measure: 400, centroid: [0, 0, 40] }),
      }),
    ])

    expect(result).toMatchObject({ status: "resolved", candidateId: "cap", method: "semantic" })
  })

  it("returns ambiguity for a duplicated semantic output instead of scoring silently", () => {
    const result = resolveTopologyReference(reference({ semanticRole: "pattern.instance.side" }), [
      candidate("left", { semanticRole: "pattern.instance.side" }),
      candidate("right", { semanticRole: "pattern.instance.side" }),
    ])

    expect(result).toEqual({
      status: "ambiguous",
      candidateIds: ["left", "right"],
      method: "semantic",
      bestScore: null,
      confidenceMargin: null,
    })
  })

  it("treats a missing authoritative semantic output as missing", () => {
    const result = resolveTopologyReference(reference({ semanticRole: "hole.wall" }), [
      candidate("similar-face"),
    ])

    expect(result).toEqual({
      status: "missing",
      reason: "semantic-role-missing",
      bestScore: null,
    })
  })

  it("resolves one exact operation-history descendant", () => {
    const result = resolveTopologyReference(reference({ lineageToken: "face:source:4" }), [
      candidate("unrelated"),
      candidate("modified", { lineageTokens: ["face:source:4"] }),
    ])

    expect(result).toMatchObject({
      status: "resolved",
      candidateId: "modified",
      method: "history",
    })
  })

  it("indexes a repeated lineage token from one candidate only once", () => {
    const resolve = createTopologyReferenceResolver([
      candidate("modified", { lineageTokens: ["face:source:4", "face:source:4"] }),
    ])

    expect(resolve(reference({ lineageToken: "face:source:4" }))).toMatchObject({
      status: "resolved",
      candidateId: "modified",
      method: "history",
    })
  })

  it("treats a missing authoritative lineage token as missing", () => {
    const result = resolveTopologyReference(reference({ lineageToken: "face:source:4" }), [
      candidate("similar-face"),
    ])

    expect(result).toEqual({
      status: "missing",
      reason: "lineage-missing",
      bestScore: null,
    })
  })

  it("uses intent to distinguish split history descendants", () => {
    const result = resolveTopologyReference(
      reference({ lineageToken: "face:source:4", intent: { nearPoint: [4, 0, 10] } }),
      [
        candidate("left", {
          lineageTokens: ["face:source:4"],
          signature: faceSignature({ centroid: [-4, 0, 10] }),
        }),
        candidate("right", {
          lineageTokens: ["face:source:4"],
          signature: faceSignature({ centroid: [4, 0, 10] }),
        }),
      ],
    )

    expect(result).toMatchObject({ status: "resolved", candidateId: "right", method: "history" })
  })

  it("keeps symmetric signature candidates ambiguous", () => {
    const result = resolveTopologyReference(reference(), [candidate("left"), candidate("right")])

    expect(result).toMatchObject({
      status: "ambiguous",
      candidateIds: ["left", "right"],
      method: "signature",
    })
  })

  it("returns missing when the only candidate exceeds the conservative threshold", () => {
    const result = resolveTopologyReference(reference(), [
      candidate("distant", {
        signature: faceSignature({
          measure: 1,
          centroid: [1_000, 1_000, 1_000],
          bounds: { min: [999, 999, 999], max: [1_001, 1_001, 1_001] },
          direction: [0, 0, -1],
          boundaryCount: 1,
          adjacentGeometryClasses: ["cylinder"],
        }),
      }),
    ])

    expect(result).toMatchObject({ status: "missing", reason: "score-threshold" })
  })

  it("returns missing when no candidate has the referenced topology kind", () => {
    const result = resolveTopologyReference(reference(), [
      candidate("edge", {
        kind: "edge",
        signature: topologySignatureSchema.parse({
          kind: "edge",
          geometryClass: "line",
          measure: 10,
          centroid: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [10, 0, 0] },
          direction: [1, 0, 0],
          directionMode: "axis",
          boundaryCount: 2,
          adjacentGeometryClasses: ["plane"],
        }),
      }),
    ])

    expect(result).toEqual({
      status: "missing",
      reason: "no-candidate-of-kind",
      bestScore: null,
    })
  })

  it("rejects duplicate evaluation-local candidate identifiers", () => {
    expect(() =>
      resolveTopologyReference(reference(), [candidate("duplicate"), candidate("duplicate")]),
    ).toThrow(/unique/)
  })

  it("rejects non-finite or non-normalized signatures at the boundary", () => {
    expect(() => faceSignature({ measure: Number.NaN })).toThrow()
    expect(() => faceSignature({ direction: [0, 0, 2] })).toThrow(/normalized/)
  })
})
