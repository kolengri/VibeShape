import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { describe, expect, it } from "vitest"
import { createQueryDispatcher, documentCoreQueryHandlers, modelEdgeViewSchema } from "./queries"

const documentId = "0195b5ac-b220-7a2c-8c33-000000000001"
const featureId = "0195b5ac-b220-7a2c-8c33-000000000002"
const otherId = "0195b5ac-b220-7a2c-8c33-000000000003"
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 4,
  name: "Edges",
  createdAt: "2026-09-07T00:00:00Z",
  updatedAt: "2026-09-07T00:00:00Z",
  features: [
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type: boxFeatureType.type,
      parameters: {},
      dependencies: [],
      references: [],
      suppressed: false,
    }),
  ],
})
const query = {
  kind: "org.vibeshape.model.edges",
  schemaVersion: 1,
  documentId,
  featureId,
  revision: 4,
  limit: 1,
  cursor: null,
}

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    candidateId: id,
    kind: "edge",
    semanticRole: `role.${id}`,
    lineageTokens: [],
    signature: {
      kind: "edge",
      geometryClass: "LINE",
      measure: 10,
      centroid: [5, 0, 0],
      bounds: { min: [0, 0, 0], max: [10, 0, 0] },
      boundaryCount: 2,
      adjacentGeometryClasses: ["PLANE", "PLANE"],
    },
    ...overrides,
  }
}
function evidence(
  candidates: unknown[] = [candidate("edge:0"), candidate("edge:1")],
  overrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    evidence: {
      schemaVersion: 1,
      documentId,
      revision: 4,
      generation: 7,
      rebuildId: "rebuild-a",
      featureId,
      contentHash: "a".repeat(64),
      candidates,
      ...overrides,
    },
  }
}
function dispatch(input: unknown = query, edges: unknown = evidence()) {
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const dispatcher = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
  return dispatcher.dispatcher.dispatch(snapshot, input, { edges })
}
function view(input: unknown = query, edges: unknown = evidence()) {
  const result = dispatch(input, edges)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return modelEdgeViewSchema.parse(result.view)
}

describe("registered model edge inspection", () => {
  it("returns bounded durable references with exact revision and generation", () => {
    const first = view()
    expect(first).toMatchObject({
      documentId,
      featureId,
      revision: 4,
      generation: 7,
      rebuildId: "rebuild-a",
      classification: "derived",
      nextCursor: { rebuildId: "rebuild-a", featureId, offset: 1 },
      data: { total: 2 },
    })
    expect(first.data.edges[0]).toMatchObject({
      resolution: "resolved",
      reference: { featureId, semanticRole: "role.edge:0" },
    })
    expect(first.data.edges[0]?.reference).not.toHaveProperty("candidateId")
    expect(first.data.edges[0]?.reference).not.toHaveProperty("edgePolyline")
    const second = view({ ...query, cursor: first.nextCursor })
    expect(second.data.edges[0]?.reference.semanticRole).toBe("role.edge:1")
    expect(second.nextCursor).toBeNull()
    expect(
      view({ ...query, cursor: { rebuildId: "rebuild-a", featureId, offset: 2 } }).data.edges,
    ).toEqual([])
  })

  it("calculates uniqueness across pages and reports signature ambiguity", () => {
    const duplicates = [
      candidate("edge:0", { semanticRole: "duplicate", lineageTokens: ["shared"] }),
      candidate("edge:1", { semanticRole: "duplicate", lineageTokens: ["shared"] }),
    ]
    const result = view(query, evidence(duplicates))
    expect(result.data.edges[0]?.resolution).toBe("ambiguous")
    expect(result.data.edges[0]?.reference).not.toHaveProperty("semanticRole")
    expect(result.data.edges[0]?.reference).not.toHaveProperty("lineageToken")
    const uniqueLineage = duplicates.map((edge, index) => ({
      ...edge,
      lineageTokens: ["shared", `unique.${index}`],
    }))
    expect(view(query, evidence(uniqueLineage)).data.edges[0]).toMatchObject({
      resolution: "resolved",
      reference: { lineageToken: "unique.0" },
    })
  })

  it.each([
    [{ ...query, revision: 3 }, evidence(), "stale-query-revision"],
    [{ ...query, documentId: otherId }, evidence(), "document-id-mismatch"],
    [{ ...query, featureId: otherId }, evidence(), "feature-not-found"],
    [
      { ...query, cursor: { rebuildId: "rebuild-a", featureId, offset: 3 } },
      evidence(),
      "invalid-query",
    ],
    [{ ...query, cursor: "01" }, evidence(), "invalid-query"],
    [query, evidence(undefined, { revision: 3 }), "stale-geometry"],
    [query, evidence(undefined, { documentId: otherId }), "stale-geometry"],
    [query, evidence(undefined, { featureId: otherId }), "invalid-geometry-evidence"],
    [query, evidence([candidate("edge:0"), candidate("edge:0")]), "invalid-geometry-evidence"],
    [
      query,
      evidence([candidate("edge:0", { edgePolyline: [[0, 0, 0]] })]),
      "invalid-geometry-evidence",
    ],
    [query, { ok: false, code: "geometry-unavailable" }, "geometry-unavailable"],
  ])("rejects invalid or stale query/evidence %#", (input, edges, code) => {
    expect(dispatch(input, edges)).toMatchObject({ ok: false, diagnostic: { code } })
  })

  it("rejects cursor reuse after a rebuild or when switching target features", () => {
    const first = view()
    expect(
      dispatch(
        { ...query, cursor: first.nextCursor },
        evidence(undefined, { rebuildId: "rebuild-b" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry", retryable: true } })
    expect(
      dispatch({ ...query, cursor: { rebuildId: "rebuild-a", featureId: otherId, offset: 1 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  })

  it("limits serialized topology pages without losing smaller pages", () => {
    const candidates = Array.from({ length: 100 }, (_, index) => {
      const edge = candidate(`edge:${index}`)
      return {
        ...edge,
        signature: {
          ...edge.signature,
          adjacentGeometryClasses: Array.from({ length: 256 }, () => "PLANE"),
        },
      }
    })
    expect(dispatch({ ...query, limit: 100 }, evidence(candidates))).toMatchObject({
      ok: false,
      diagnostic: { code: "query-result-too-large" },
    })
    const small = view(query, evidence(candidates))
    expect(small.data.total).toBe(100)
    expect(small.data.edges).toHaveLength(1)
    expect(small.nextCursor).toEqual({ rebuildId: "rebuild-a", featureId, offset: 1 })
  })
})
