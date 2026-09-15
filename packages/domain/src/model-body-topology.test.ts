import { describe, expect, it } from "vitest"
import { featureIdSchema } from "./identifiers"
import {
  bodyTopoRefSchema,
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
  modelBodyTopologyEvidenceSchema,
} from "./model-body-topology"
import { topologyCandidateSchema, topologySignatureSchema, topoRefSchema } from "./topology"

const documentId = "0195b5ac-b218-7a2c-8c33-67a36a7f21ac"
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f21ac")

function signature(kind: "edge" | "face") {
  return topologySignatureSchema.parse({
    kind,
    geometryClass: kind === "edge" ? "LINE" : "PLANE",
    measure: 10,
    centroid: [0, 0, 0],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    ...(kind === "edge" ? { direction: [1, 0, 0], directionMode: "axis" } : {}),
    boundaryCount: kind === "edge" ? 2 : 4,
    adjacentGeometryClasses: [],
  })
}

function candidate(
  candidateId: string,
  kind: "edge" | "face",
  overrides: Record<string, unknown> = {},
) {
  return topologyCandidateSchema.parse({
    candidateId,
    kind,
    lineageTokens: [],
    signature: signature(kind),
    ...overrides,
  })
}

function evidence(
  kind: "edge" | "face" = "edge",
  candidates = [candidate("edge-1", kind, { semanticRole: "body.edge.start" })],
  overrides: Record<string, unknown> = {},
) {
  return modelBodyTopologyEvidenceSchema.parse({
    schemaVersion: 1,
    documentId,
    revision: 3,
    generation: 4,
    rebuildId: "rebuild-1",
    featureId,
    contentHash: "a".repeat(64),
    outputRole: "result",
    kind,
    candidates,
    ...overrides,
  })
}

describe("model body topology", () => {
  it("requires normalized body output roles and rejects v1 refs in v0", () => {
    expect(
      bodyTopoRefSchema.safeParse({
        schemaVersion: 1,
        featureId,
        outputRole: "Body.Result",
        kind: "edge",
        signature: signature("edge"),
      }).success,
    ).toBe(false)

    const reference = bodyTopoRefSchema.parse({
      schemaVersion: 1,
      featureId,
      outputRole: "result",
      kind: "edge",
      signature: signature("edge"),
    })
    expect(topoRefSchema.safeParse(reference).success).toBe(false)
  })

  it("projects semantic and history identity across the complete kind set", () => {
    const allCandidates = [
      candidate("first", "edge", { semanticRole: "edge.same", lineageTokens: ["shared"] }),
      candidate("second", "edge", { semanticRole: "edge.same", lineageTokens: ["shared"] }),
      candidate("third", "edge", { lineageTokens: ["unique"] }),
    ]
    const project = createBodyTopologyReferenceProjector(evidence("edge", allCandidates))
    expect(project(allCandidates[0] as never)).not.toHaveProperty("semanticRole")
    expect(project(allCandidates[0] as never)).not.toHaveProperty("lineageToken")
    expect(project(allCandidates[2] as never)).toMatchObject({ lineageToken: "unique" })
  })

  it("returns ambiguity for duplicate semantic identity", () => {
    const candidates = [
      candidate("left", "edge", { semanticRole: "edge.side" }),
      candidate("right", "edge", { semanticRole: "edge.side" }),
    ]
    const resolve = createBodyTopologyReferenceResolver(evidence("edge", candidates))
    const reference = createBodyTopologyReferenceProjector(evidence("edge", candidates))(
      candidates[0] as never,
    )
    expect(resolve(reference)).toMatchObject({
      status: "ambiguous",
      candidateIds: ["left", "right"],
    })
  })

  it("requires the exact body scope even when edge and face IDs coincide", () => {
    const edgeEvidence = evidence("edge", [candidate("same-id", "edge")])
    const faceEvidence = evidence("face", [candidate("same-id", "face")], {
      featureId: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f21ad"),
      outputRole: "secondary",
    })
    const edgeRef = createBodyTopologyReferenceProjector(edgeEvidence)(
      edgeEvidence.candidates[0] as never,
    )
    expect(createBodyTopologyReferenceResolver(faceEvidence)(edgeRef)).toEqual({
      status: "missing",
      reason: "body-scope-mismatch",
      bestScore: null,
    })
  })

  it.each(["edge", "face"] as const)(
    "isolates congruent %s candidates across roles and producers",
    (kind) => {
      const shared = candidate("same-id", kind, { semanticRole: "side" })
      const original = evidence(kind, [shared], { outputRole: "pattern.instance.0" })
      const reference = createBodyTopologyReferenceProjector(original)(shared)
      expect(createBodyTopologyReferenceResolver(original)(reference).status).toBe("resolved")
      for (const scope of [
        { outputRole: "pattern.instance.1" },
        { featureId: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f21ad") },
      ]) {
        expect(
          createBodyTopologyReferenceResolver({ ...original, ...scope })(reference),
        ).toMatchObject({
          status: "missing",
          reason: "body-scope-mismatch",
        })
      }
    },
  )

  it("does not manufacture scoped references from candidates outside the evidence", () => {
    const original = candidate("owned", "edge")
    const project = createBodyTopologyReferenceProjector(evidence("edge", [original]))
    expect(() => project(candidate("unowned", "edge"))).toThrow(/exact evidence/)
    expect(() => project({ ...original, semanticRole: "forged" })).toThrow(/exact evidence/)
  })

  it("rejects duplicate IDs, mixed kinds, and more than 10000 candidates", () => {
    expect(() => evidence("edge", [candidate("same", "edge"), candidate("same", "edge")])).toThrow()
    expect(() => evidence("edge", [candidate("edge", "edge"), candidate("face", "face")])).toThrow()
    const tooMany = Array.from({ length: 10_001 }, (_, index) => candidate(`edge-${index}`, "edge"))
    expect(() => evidence("edge", tooMany)).toThrow()
  })
})
