import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { createDisposableDocumentPreview } from "./disposable-document-preview"
import { createModelEdgeEvidence } from "./model-edges"
import type { DocumentRebuildPort } from "./persistent-document-session"

const documentId = "0195b5ac-b220-7a2c-8c33-000000000001"
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000002")
const otherId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000003")
const hash = "a".repeat(64)
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
const candidate = {
  candidateId: "edge:0",
  kind: "edge",
  semanticRole: "primitive.box.edge.x.y-min.z-min",
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
  edgePolyline: [
    [0, 0, 0],
    [10, 0, 0],
  ],
}

const validGeometry = {
  engine: {
    adapter: "replicad",
    adapterVersion: "test-build",
    replicadVersion: "0.23.1",
    opencascadePackageVersion: "0.23.0",
    opencascadeSourceRevision: null,
    wasmBytes: 1,
    initializedInMs: 1,
    featureContentEnvironment: {
      schemaVersion: 0,
      hostApiVersion: "0.1.0",
      geometry: {
        adapterId: "org.vibeshape.geometry.replicad",
        adapterVersion: "test-build",
        kernelId: "org.opencascade.occt",
        kernelVersion: "7.9.2",
        kernelSourceRevision: null,
      },
      modelingTolerancePolicyVersion: 1,
      provider: { kind: "built-in" },
    },
  },
  shape: {
    valid: true,
    volume: 120,
    surfaceArea: 88,
    bounds: { min: [-1, -2, -3], max: [4, 5, 6] },
    faceCount: 6,
    edgeCount: 1,
    solidCount: 1,
  },
  topologyCandidates: [],
  mesh: {
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
    triangleFaceIds: new Uint32Array([1]),
  },
  cache: { brepHit: false },
  timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 21,
    requestId: documentId,
    documentId,
    revision: 4,
    generation: 7,
    type: "documentRebuilt",
    evaluation: {
      records: [{ featureId, status: "succeeded", contentHash: hash }],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: [
      {
        featureId,
        contentHash: hash,
        meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
        geometry: { ...validGeometry, topologyCandidates: [candidate] },
      },
    ],
    sketches: [],
    modelReferenceEvidence: [],
    ...overrides,
  }
}
const inspect = (value: unknown) =>
  createModelEdgeEvidence(snapshot, { ok: true, response: value }, featureId)

function rebuildResponse(value: unknown) {
  const parsed = documentWorkerResponseSchema.parse(value)
  if (parsed.type !== "documentRebuilt") throw new Error("Expected rebuild")
  return parsed
}

function disposablePreview(rebuild: DocumentRebuildPort["rebuild"], terminate: () => void) {
  return createDisposableDocumentPreview({
    mesh: { chordTolerance: 0.01, angularTolerance: 0.1 },
    createRebuildPort: () => ({
      rebuild,
      terminate,
      dispose: async () => undefined,
      exportDocument: async () => {
        throw new Error("Preview must not export")
      },
      solveSketch: async () => {
        throw new Error("Preview must not solve directly")
      },
    }),
  })
}

describe("disposable draft edge evidence", () => {
  it("projects measurements and detached edges from one rebuild before terminating", async () => {
    const raw = rebuildResponse(response())
    let rebuilds = 0
    let terminated = 0
    const preview = disposablePreview(
      async () => {
        rebuilds += 1
        return raw
      },
      () => {
        terminated += 1
      },
    )
    const result = await preview.preview(snapshot, featureId)
    expect(result).toMatchObject({
      ok: true,
      valid: true,
      evidence: { documentId, revision: 4 },
      edges: { ok: true, evidence: { documentId, revision: 4, featureId, rebuildId: documentId } },
    })
    if (!result.ok || !result.edges?.ok) throw new Error("Expected edge evidence")
    expect(JSON.stringify(result.edges)).not.toMatch(/edgePolyline|mesh|referenceGeometry/)
    expect(rebuilds).toBe(1)
    expect(terminated).toBe(1)
    preview.dispose()
    expect(terminated).toBe(1)
    if (raw.type !== "documentRebuilt") throw new Error("Expected rebuild")
    raw.geometry.splice(0)
    expect(result.edges.evidence.candidates).toHaveLength(1)
  })

  it("keeps successful source edges inspectable when a downstream feature fails", async () => {
    const current = documentSnapshotSchema.parse({
      ...snapshot,
      features: [...snapshot.features, { ...snapshot.features[0], id: otherId }],
    })
    const raw = response()
    const preview = disposablePreview(
      async () =>
        rebuildResponse({
          ...raw,
          evaluation: {
            ...raw.evaluation,
            records: [
              ...raw.evaluation.records,
              {
                featureId: otherId,
                status: "failed",
                diagnostics: [{ code: "org.vibeshape.geometry.failed", values: {} }],
              },
            ],
          },
        }),
      () => undefined,
    )
    await expect(preview.preview(current, featureId)).resolves.toMatchObject({
      ok: true,
      valid: false,
      edges: { ok: true, evidence: { featureId } },
    })
    await expect(preview.preview(current, otherId)).resolves.toMatchObject({
      ok: true,
      valid: false,
      edges: { ok: false, code: "geometry-unavailable" },
    })
  })

  it("terminates and rejects incomplete edge evidence without discarding valid measurements", async () => {
    const raw = rebuildResponse(response())
    if (raw.type !== "documentRebuilt") throw new Error("Expected rebuild")
    const geometry = raw.geometry[0]
    if (!geometry) throw new Error("Expected geometry")
    geometry.geometry.topologyCandidates.splice(0)
    let terminated = 0
    const preview = disposablePreview(
      async () => raw,
      () => {
        terminated += 1
      },
    )
    await expect(preview.preview(snapshot, featureId)).resolves.toMatchObject({
      ok: true,
      valid: true,
      edges: { ok: false, code: "invalid-geometry-evidence" },
    })
    expect(terminated).toBe(1)
  })

  it.each(["cancel", "dispose"] as const)(
    "settles %s promptly and ignores late topology without retaining a port",
    async (action) => {
      let complete!: () => void
      const pending = new Promise<void>((resolve) => {
        complete = resolve
      })
      let terminated = 0
      const preview = disposablePreview(
        async () => {
          await pending
          return rebuildResponse(response())
        },
        () => {
          terminated += 1
        },
      )
      const result = preview.preview(snapshot, featureId)
      preview[action]()
      await expect(result).resolves.toEqual({ ok: false, code: "preview-cancelled" })
      expect(terminated).toBe(1)
      complete()
      await Promise.resolve()
      await Promise.resolve()
      expect(terminated).toBe(1)
    },
  )
})

describe("model edge evidence projection", () => {
  it("detaches only exact edge evidence and omits display and native data", () => {
    const raw = response()
    const result = inspect(raw)
    expect(result).toMatchObject({
      ok: true,
      evidence: { documentId, revision: 4, generation: 7, featureId, contentHash: hash },
    })
    if (!result.ok) throw new Error(result.code)
    expect(result.evidence.candidates).toHaveLength(1)
    expect(result.evidence.candidates[0]).not.toHaveProperty("edgePolyline")
    expect(result.evidence).not.toHaveProperty("mesh")
    const projected = result.evidence.candidates[0]
    if (!projected) throw new Error("Expected edge")
    projected.signature.centroid[0] = 99
    expect(candidate.signature.centroid[0]).toBe(5)
  })
  it("reports unavailable geometry without trusting a successful envelope alone", () => {
    expect(createModelEdgeEvidence(snapshot, { ok: false }, featureId)).toEqual({
      ok: false,
      code: "geometry-unavailable",
    })
    for (const status of ["suppressed", "blocked", "failed"] as const) {
      const record =
        status === "blocked"
          ? { featureId, status, blockedBy: [otherId] }
          : status === "failed"
            ? {
                featureId,
                status,
                diagnostics: [{ code: "org.vibeshape.geometry.failed", values: {} }],
              }
            : { featureId, status }
      expect(
        inspect(
          response({
            evaluation: {
              records: [record],
              dirtyFeatureIds: [],
              evaluatedFeatureIds: [],
              reusedFeatureIds: [],
            },
            geometry: [],
          }),
        ),
      ).toEqual({ ok: false, code: "geometry-unavailable" })
    }
  })
  it.each([
    [{ revision: 3 }, "stale-geometry"],
    [{ documentId: otherId }, "stale-geometry"],
    [{ geometry: [] }, "invalid-geometry-evidence"],
    [
      {
        evaluation: {
          records: [],
          dirtyFeatureIds: [],
          evaluatedFeatureIds: [],
          reusedFeatureIds: [],
        },
        geometry: [],
      },
      "invalid-geometry-evidence",
    ],
  ])("rejects inconsistent rebuild evidence %#", (overrides, code) => {
    expect(inspect(response(overrides))).toEqual({ ok: false, code })
  })
  it("rejects partial edge catalogs even when the worker envelope is valid", () => {
    const geometry = response().geometry[0]
    if (!geometry) throw new Error("Expected geometry")
    expect(
      inspect(
        response({
          geometry: [{ ...geometry, geometry: { ...geometry.geometry, topologyCandidates: [] } }],
        }),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      inspect(
        response({
          geometry: [
            {
              ...geometry,
              geometry: {
                ...geometry.geometry,
                shape: { ...geometry.geometry.shape, edgeCount: 12 },
              },
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })

  it("rejects mismatched content hashes and malformed candidates", () => {
    const original = response().geometry[0]
    if (!original) throw new Error("Expected geometry")
    expect(inspect(response({ geometry: [{ ...original, contentHash: "b".repeat(64) }] }))).toEqual(
      { ok: false, code: "invalid-geometry-evidence" },
    )
    expect(
      inspect(
        response({
          geometry: [
            {
              ...original,
              geometry: {
                ...original.geometry,
                topologyCandidates: [
                  { ...candidate, signature: { ...candidate.signature, measure: -1 } },
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      inspect(
        response({
          geometry: [
            {
              ...original,
              geometry: { ...original.geometry, topologyCandidates: [candidate, candidate] },
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })
})
