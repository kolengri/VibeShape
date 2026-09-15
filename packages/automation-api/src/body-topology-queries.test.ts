import { boxFeatureType, createLengthQuantity } from "@vibeshape/domain"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import {
  modelBodyTopologyEvidenceResultSchema,
  modelBodyTopologyEvidenceSchema,
} from "@vibeshape/domain/model-body-topology"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { topologyCandidateSchema, topologySignatureSchema } from "@vibeshape/domain/topology"
import { describe, expect, it } from "vitest"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ad"
const otherFeatureId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ae"

const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(10),
    depth: createLengthQuantity(20),
    height: createLengthQuantity(30),
    centered: false,
    origin: { x: createLengthQuantity(0), y: createLengthQuantity(0), z: createLengthQuantity(0) },
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Topology fixture",
})

const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 7,
  name: "Topology query fixture",
  createdAt: "2026-09-13T10:00:00Z",
  updatedAt: "2026-09-13T10:00:00Z",
  features: [feature],
})

function signature(kind: "edge" | "face", adjacentGeometryClasses: string[] = []) {
  return topologySignatureSchema.parse({
    kind,
    geometryClass: kind === "edge" ? "LINE" : "PLANE",
    measure: 10,
    centroid: [0, 0, 0],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    ...(kind === "edge" ? { direction: [1, 0, 0], directionMode: "axis" } : {}),
    boundaryCount: kind === "edge" ? 2 : 4,
    adjacentGeometryClasses,
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
    revision: 7,
    generation: 12,
    rebuildId: "rebuild-12",
    featureId,
    contentHash: "a".repeat(64),
    outputRole: "result",
    kind,
    candidates,
    ...overrides,
  })
}

function dispatch() {
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.dispatcher.dispatch
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.model.body-topology",
    schemaVersion: 1,
    documentId,
    revision: 7,
    featureId,
    outputRole: "result",
    topologyKind: "edge",
    ...overrides,
  }
}

describe("model body topology query", () => {
  it("dispatches scoped edge and face results with complete provenance", () => {
    const run = dispatch()
    const edge = run(snapshot, query(), { bodyTopology: { ok: true, evidence: evidence() } })
    expect(edge).toMatchObject({
      ok: true,
      view: {
        documentId,
        revision: 7,
        generation: 12,
        rebuildId: "rebuild-12",
        featureId,
        contentHash: "a".repeat(64),
        outputRole: "result",
        topologyKind: "edge",
        data: {
          total: 1,
          topology: [{ reference: { kind: "edge", featureId, outputRole: "result" } }],
        },
      },
    })
    const faceEvidence = evidence("face", [candidate("face-1", "face", { meshFaceId: 4 })])
    const face = run(snapshot, query({ topologyKind: "face" }), {
      bodyTopology: { ok: true, evidence: faceEvidence },
    })
    expect(face).toMatchObject({
      ok: true,
      view: { topologyKind: "face", data: { topology: [{ reference: { kind: "face" } }] } },
    })
  })

  it("validates the dispatcher target, document revision, feature, role, kind, and suppression", () => {
    const run = dispatch()
    expect(
      run(snapshot, query({ featureId: otherFeatureId }), {
        bodyTopology: { ok: true, evidence: evidence() },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "feature-not-found" },
    })
    expect(
      run(snapshot, query({ outputRole: "missing" }), {
        bodyTopology: { ok: true, evidence: evidence() },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence" },
    })
    expect(
      run(snapshot, query({ topologyKind: "face" }), {
        bodyTopology: { ok: true, evidence: evidence() },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence" },
    })
    expect(
      run(snapshot, query({ revision: 6 }), { bodyTopology: { ok: true, evidence: evidence() } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    const suppressedSnapshot = documentSnapshotSchema.parse({
      ...snapshot,
      features: [{ ...feature, suppressed: true }],
    })
    expect(
      run(suppressedSnapshot, query(), { bodyTopology: { ok: true, evidence: evidence() } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "geometry-unavailable" },
    })
  })

  it("fails closed for unavailable, invalid, and failed evidence", () => {
    const run = dispatch()
    expect(run(snapshot, query())).toMatchObject({
      ok: false,
      diagnostic: { code: "geometry-unavailable", retryable: true },
    })
    expect(run(snapshot, query(), { bodyTopology: { nope: true } })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence" },
    })
    expect(
      run(snapshot, query(), { bodyTopology: { ok: false, code: "body-not-found" } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "body-not-found", retryable: true },
    })
    expect(
      run(snapshot, query(), { bodyTopology: { ok: false, code: "invalid-geometry-evidence" } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence", retryable: true },
    })
  })

  it("paginates with all provenance fields and computes uniqueness over the full body", () => {
    const candidates = [
      candidate("edge-1", "edge", { semanticRole: "same-role", lineageTokens: ["same-lineage"] }),
      candidate("edge-2", "edge", { semanticRole: "same-role", lineageTokens: ["same-lineage"] }),
      candidate("edge-3", "edge", {
        semanticRole: "unique-role",
        lineageTokens: ["unique-lineage"],
      }),
    ]
    const run = dispatch()
    const first = run(snapshot, query({ limit: 1 }), {
      bodyTopology: { ok: true, evidence: evidence("edge", candidates) },
    })
    expect(first).toMatchObject({
      ok: true,
      view: {
        nextCursor: {
          offset: 1,
          documentId,
          revision: 7,
          generation: 12,
          rebuildId: "rebuild-12",
          featureId,
          contentHash: "a".repeat(64),
          outputRole: "result",
          topologyKind: "edge",
        },
        data: { total: 3 },
      },
    })
    const firstReference = (
      first as {
        ok: true
        view: { data: { topology: Array<{ reference: Record<string, unknown> }> } }
      }
    ).view.data.topology[0]?.reference
    expect(firstReference).not.toHaveProperty("semanticRole")
    const cursor = (first as { ok: true; view: { nextCursor: unknown } }).view.nextCursor
    const second = run(snapshot, query({ limit: 1, cursor }), {
      bodyTopology: { ok: true, evidence: evidence("edge", candidates) },
    })
    expect(second).toMatchObject({
      ok: true,
      view: {
        nextCursor: expect.anything(),
        data: { topology: [{ reference: { kind: "edge", featureId, outputRole: "result" } }] },
      },
    })
    const foreignCursor = { ...(cursor as Record<string, unknown>), rebuildId: "other-rebuild" }
    expect(
      run(snapshot, query({ cursor: foreignCursor }), {
        bodyTopology: { ok: true, evidence: evidence("edge", candidates) },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-geometry", retryable: true },
    })
  })

  it("enforces page bounds and independently rejects a non-ASCII UTF-8 page over 128 KiB", () => {
    const run = dispatch()
    expect(
      run(snapshot, query({ limit: 101 }), { bodyTopology: { ok: true, evidence: evidence() } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-query" },
    })
    const largeClasses = Array.from({ length: 256 }, () => "é".repeat(64))
    const largeCandidates = Array.from({ length: 100 }, (_, index) =>
      candidate(`large-${index}`, "edge", { signature: signature("edge", largeClasses) }),
    )
    expect(
      run(snapshot, query({ limit: 100 }), {
        bodyTopology: { ok: true, evidence: evidence("edge", largeCandidates) },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "query-result-too-large", retryable: true },
    })
  })

  it("keeps the evidence result schema strict", () => {
    expect(
      modelBodyTopologyEvidenceResultSchema.safeParse({ ok: true, evidence: evidence() }).success,
    ).toBe(true)
    expect(
      modelBodyTopologyEvidenceResultSchema.safeParse({ ok: true, evidence: {} }).success,
    ).toBe(false)
  })
})
