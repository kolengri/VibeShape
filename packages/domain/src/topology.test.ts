import { describe, expect, it } from "bun:test"
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

  it.each([1, 10, 100])(
    "resolves one identical annular face beside a similar coplanar land at scale %s",
    (scale) => {
      const annulus = (inner: number, outer: number): TopoRef["signature"] =>
        faceSignature({
          measure: Math.PI * (outer ** 2 - inner ** 2) * scale ** 2,
          centroid: [0, 0, 10 * scale],
          bounds: {
            min: [-outer * scale, -outer * scale, 10 * scale],
            max: [outer * scale, outer * scale, 10 * scale],
          },
          boundaryCount: 2,
          adjacentGeometryClasses: ["cylinder", "cylinder"],
        })
      const signature = annulus(31.6, 32.4)
      const picked = reference({ signature })
      const lands = [
        candidate("neighbor", { signature: annulus(32.5, 33.3) }),
        candidate("picked", { signature }),
      ]
      expect(resolveTopologyReference(picked, lands)).toMatchObject({
        status: "resolved",
        candidateId: "picked",
        method: "signature",
        score: 0,
      })
      expect(resolveTopologyReference(picked, [...lands].reverse())).toMatchObject({
        status: "resolved",
        candidateId: "picked",
      })
      expect(
        resolveTopologyReference(picked, [...lands, candidate("coincident", { signature })]),
      ).toMatchObject({ status: "ambiguous", candidateIds: ["coincident", "picked"] })
      expect(
        resolveTopologyReference(reference({ signature: annulus(31.61, 32.41) }), lands),
      ).toMatchObject({ status: "ambiguous" })
      expect(
        resolveTopologyReference({ ...picked, intent: { nearPoint: [0, 0, 10 * scale] } }, lands),
      ).toMatchObject({ status: "ambiguous" })
    },
  )

  it("restricts identical face precedence to the authoritative lineage descendants", () => {
    const signature = faceSignature()
    const result = resolveTopologyReference(reference({ lineageToken: "face:owned" }), [
      candidate("outside", { signature, lineageTokens: ["face:other"] }),
      candidate("picked", { signature, lineageTokens: ["face:owned"] }),
      candidate("neighbor", {
        signature: faceSignature({ measure: 101 }),
        lineageTokens: ["face:owned"],
      }),
    ])
    expect(result).toMatchObject({
      status: "resolved",
      candidateId: "picked",
      method: "history",
      score: 0,
    })
  })

  it("retains approximate ambiguity for neighboring vertices despite one identical signature", () => {
    const point = (x: number): TopoRef["signature"] => ({
      kind: "vertex",
      geometryClass: "POINT",
      measure: 0,
      centroid: [x, 0, 0],
      bounds: { min: [x, 0, 0], max: [x, 0, 0] },
      boundaryCount: 0,
      adjacentGeometryClasses: ["LINE"],
    })
    expect(
      resolveTopologyReference(reference({ kind: "vertex", signature: point(0) }), [
        candidate("picked", { kind: "vertex", signature: point(0) }),
        candidate("neighbor", { kind: "vertex", signature: point(1e-10) }),
      ]),
    ).toMatchObject({ status: "ambiguous" })
  })

  it.each([1, 5, 100])(
    "resolves a picked circular edge beside a similar ring at radius %s",
    (radius) => {
      const circle = (z: number): TopoRef["signature"] => ({
        kind: "edge",
        geometryClass: "CIRCLE",
        measure: 2 * Math.PI * radius,
        centroid: [0, 0, z],
        bounds: { min: [-radius, -radius, z], max: [radius, radius, z] },
        direction: [0, 0, 1],
        directionMode: "axis",
        boundaryCount: 0,
        adjacentGeometryClasses: ["CYLINDER", "PLANE"],
      })
      const picked = reference({ kind: "edge", signature: circle(0) })
      const rings = [
        candidate("upper", { kind: "edge", signature: circle(radius / 100) }),
        candidate("picked", { kind: "edge", signature: circle(0) }),
      ]
      expect(resolveTopologyReference(picked, rings)).toMatchObject({
        status: "resolved",
        candidateId: "picked",
        method: "signature",
      })
      // Reordering evaluation-local IDs must not determine which ring is selected.
      expect(resolveTopologyReference(picked, [...rings].reverse())).toMatchObject({
        status: "resolved",
        candidateId: "picked",
      })
      expect(
        resolveTopologyReference(picked, [
          ...rings,
          candidate("coincident", { kind: "edge", signature: circle(0) }),
        ]),
      ).toMatchObject({ status: "ambiguous", candidateIds: ["coincident", "picked"] })
      expect(
        resolveTopologyReference(
          reference({ kind: "edge", signature: circle(radius / 200) }),
          rings,
        ),
      ).toMatchObject({ status: "ambiguous" })
    },
  )

  it("matches an edge when optional directions are explicitly undefined", () => {
    const signature = topologySignatureSchema.parse({
      ...faceSignature(),
      kind: "edge",
      geometryClass: "BSPLINE",
      direction: undefined,
      directionMode: undefined,
    })
    const { direction: _direction, directionMode: _mode, ...storedSignature } = signature
    expect(
      resolveTopologyReference(reference({ kind: "edge", signature: storedSignature }), [
        candidate("curve", { kind: "edge", signature }),
      ]),
    ).toMatchObject({ status: "resolved", candidateId: "curve" })
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

it.each(["face", "edge"] as const)(
  "resolves an exact %s catalogue repeatedly without changing duplicate or ownership semantics",
  (kind) => {
    const signature = (n: number): TopoRef["signature"] => ({
      ...faceSignature(),
      kind,
      geometryClass: kind === "face" ? "PLANE" : "LINE",
      centroid: [0, 0, n],
      bounds: { min: [-5, -5, n], max: [5, 5, n] },
    })
    const candidates = Array.from({ length: 128 }, (_, n) =>
      candidate(`item-${n}`, {
        kind,
        signature: signature(n),
      }),
    )
    const resolve = createTopologyReferenceResolver(candidates)
    for (let n = 127; n >= 0; n--) {
      expect(resolve(reference({ kind, signature: signature(n) }))).toMatchObject({
        status: "resolved",
        candidateId: `item-${n}`,
        score: 0,
      })
    }
    const duplicate = createTopologyReferenceResolver([
      ...candidates,
      candidate("coincident", { kind, signature: signature(20) }),
    ])
    expect(duplicate(reference({ kind, signature: signature(20) }))).toMatchObject({
      status: "ambiguous",
      candidateIds: ["coincident", "item-20"],
    })
    expect(resolve(reference({ kind, signature: signature(20) }))).toMatchObject({
      status: "resolved",
      candidateId: "item-20",
    })
  },
)
