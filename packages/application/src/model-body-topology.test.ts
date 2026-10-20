import { describe, expect, it, spyOn } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { type FeatureId, featureIdSchema } from "@vibeshape/domain/identifiers"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import {
  createModelBodyTopologyEvidence,
  createModelBodyTopologyEvidenceResolver,
} from "./model-body-topology"

const documentId = "0195b5ac-b220-7a2c-8c33-000000000001"
const featureIds: readonly [FeatureId, FeatureId] = [
  featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000002"),
  featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000003"),
]
const hash = "a".repeat(64)

function snapshot() {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Topology",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    features: featureIds.map((id) =>
      featureRecordSchema.parse({
        schemaVersion: 0,
        id,
        type: boxFeatureType.type,
        parameters: {},
        dependencies: [],
        references: [],
        suppressed: false,
      }),
    ),
  })
}

const signature = {
  kind: "edge" as const,
  geometryClass: "LINE",
  measure: 10,
  centroid: [5, 0, 0] as [number, number, number],
  bounds: {
    min: [0, 0, 0] as [number, number, number],
    max: [10, 0, 0] as [number, number, number],
  },
  boundaryCount: 2,
  adjacentGeometryClasses: ["PLANE", "PLANE"],
}

function candidate(candidateId: string, semanticRole?: string) {
  return {
    candidateId,
    kind: "edge" as const,
    ...(semanticRole ? { semanticRole } : {}),
    lineageTokens: [],
    signature,
    edgePolyline: [
      [0, 0, 0],
      [10, 0, 0],
    ],
  }
}

const mesh = {
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array([0, 0, 0]),
  triangleFaceIds: new Uint32Array([0]),
}

const shape = {
  valid: true,
  volume: 120,
  surfaceArea: 88,
  bounds: { min: [0, 0, 0], max: [10, 12, 1] },
  faceCount: 6,
  edgeCount: 2,
  solidCount: 1,
}

function body(outputRole: string, topologyCandidates: unknown[]) {
  return { outputRole, shape, mesh, topologyCandidates }
}

function engineGeometry(bodies: unknown[], rootCandidates: unknown[] = [], rootSolidCount = 1) {
  return {
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
    shape: { ...shape, solidCount: rootSolidCount },
    topologyCandidates: rootCandidates,
    mesh,
    bodies,
    cache: { brepHit: false },
    timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
  }
}

function response(
  geometries: unknown[],
  overrides: Record<string, unknown> = {},
  records: unknown[] = featureIds.map((featureId) => ({
    featureId,
    status: "succeeded",
    contentHash: hash,
  })),
) {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "0195b5ac-b220-7a2c-8c33-000000000010",
    documentId,
    revision: 4,
    generation: 7,
    type: "documentRebuilt",
    evaluation: { records, dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
    geometry: geometries,
    sketches: [],
    modelReferenceEvidence: [],
    ...overrides,
  }
}

function geometry(featureId: string, bodies: unknown[], rootSolidCount = 1) {
  return {
    featureId,
    contentHash: hash,
    meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
    geometry: engineGeometry(bodies, [], rootSolidCount),
  }
}

function validResponse() {
  return response([
    geometry(featureIds[0], [body("result", [candidate("first"), candidate("second")])]),
    geometry(featureIds[1], [body("result", [candidate("other"), candidate("other-second")])]),
  ])
}

describe("createModelBodyTopologyEvidenceResolver", () => {
  it("fully parses once and resolves each exact feature and body independently", () => {
    const current = snapshot()
    const rebuilt = response([
      geometry(
        featureIds[0],
        [
          body("left", [candidate("same"), candidate("left-second")]),
          body("right", [candidate("same"), candidate("right-second")]),
        ],
        2,
      ),
      geometry(featureIds[1], [body("result", [candidate("other"), candidate("other-second")])]),
    ])
    const parse = spyOn(documentWorkerResponseSchema, "safeParse")
    try {
      const resolve = createModelBodyTopologyEvidenceResolver(current, {
        ok: true,
        response: rebuilt,
      })
      for (const [featureId, outputRole, candidateId] of [
        [featureIds[0], "left", "left-second"],
        [featureIds[0], "right", "right-second"],
        [featureIds[1], "result", "other-second"],
      ] as const) {
        expect(resolve({ featureId, outputRole, kind: "edge" })).toMatchObject({
          ok: true,
          evidence: { featureId, outputRole, candidates: [{}, { candidateId }] },
        })
        // A valid edge request must not bypass the separate face count check.
        expect(resolve({ featureId, outputRole, kind: "face" })).toEqual({
          ok: false,
          code: "invalid-geometry-evidence",
        })
      }
      expect(resolve({ featureId: featureIds[0], outputRole: "result", kind: "edge" })).toEqual({
        ok: false,
        code: "body-not-found",
      })
      expect(parse).toHaveBeenCalledTimes(1)
    } finally {
      parse.mockRestore()
    }
  })

  it("rejects incomplete, duplicate and malformed unrelated response data before any target", () => {
    const current = snapshot()
    const valid = validResponse()
    const invalid = [
      undefined,
      { ...valid, protocolVersion: -1 },
      { ...valid, geometry: valid.geometry.slice(0, 1) },
      { ...valid, geometry: [...valid.geometry, valid.geometry[0]] },
      {
        ...valid,
        geometry: [valid.geometry[0], { ...geometry(featureIds[1], []), contentHash: 42 }],
      },
      {
        ...valid,
        evaluation: { ...valid.evaluation, records: valid.evaluation.records.slice(0, 1) },
      },
      {
        ...valid,
        evaluation: {
          ...valid.evaluation,
          records: [valid.evaluation.records[0], valid.evaluation.records[0]],
        },
      },
      response([
        geometry(featureIds[0], [body("result", [candidate("first"), candidate("second")])]),
        geometry(featureIds[1], [body("duplicate", []), body("duplicate", [])], 2),
      ]),
    ]
    for (const rebuilt of invalid) {
      const resolve = createModelBodyTopologyEvidenceResolver(current, {
        ok: true,
        response: rebuilt,
      })
      for (const featureId of featureIds)
        expect(resolve({ featureId, outputRole: "result", kind: "edge" })).toEqual({
          ok: false,
          code: "invalid-geometry-evidence",
        })
    }
  })

  it("keeps per-body evidence schema checks and missing-feature failures", () => {
    const current = snapshot()
    const resolve = createModelBodyTopologyEvidenceResolver(current, {
      ok: true,
      response: response([
        geometry(featureIds[0], [body("result", [candidate("duplicate"), candidate("duplicate")])]),
        geometry(featureIds[1], [body("result", [candidate("other"), candidate("other-second")])]),
      ]),
    })
    expect(resolve({ featureId: featureIds[0], outputRole: "result", kind: "edge" })).toEqual({
      ok: false,
      code: "invalid-geometry-evidence",
    })
    expect(resolve({ featureId: featureIds[1], outputRole: "result", kind: "edge" }).ok).toBe(true)
    expect(
      resolve({
        featureId: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000099"),
        outputRole: "result",
        kind: "edge",
      }),
    ).toEqual({
      ok: false,
      code: "body-not-found",
    })
  })

  it("never reuses evidence across stale, changed, unavailable or suppressed invocations", () => {
    const current = snapshot()
    const target = { featureId: featureIds[0], outputRole: "result", kind: "edge" as const }
    const valid = validResponse()
    const original = createModelBodyTopologyEvidenceResolver(current, { ok: true, response: valid })
    expect(original(target)).toMatchObject({
      ok: true,
      evidence: { generation: 7, contentHash: hash },
    })
    for (const stale of [
      { ...valid, revision: 3 },
      { ...valid, documentId: featureIds[0] },
    ])
      expect(
        createModelBodyTopologyEvidenceResolver(current, { ok: true, response: stale })(target),
      ).toEqual({
        ok: false,
        code: "stale-geometry",
      })
    expect(createModelBodyTopologyEvidenceResolver(current, { ok: false })(target)).toEqual({
      ok: false,
      code: "geometry-unavailable",
    })
    const suppressed = {
      ...current,
      features: current.features.map((feature) => ({ ...feature, suppressed: true })),
    }
    expect(
      createModelBodyTopologyEvidenceResolver(suppressed, { ok: true, response: valid })(target),
    ).toEqual({
      ok: false,
      code: "geometry-unavailable",
    })
    const changedHash = "b".repeat(64)
    const changed = {
      ...valid,
      generation: 8,
      requestId: "new-rebuild",
      geometry: featureIds.map((featureId) => ({
        ...geometry(featureId, [
          body("result", [candidate("changed"), candidate("changed-second")]),
        ]),
        contentHash: changedHash,
      })),
    }
    expect(
      createModelBodyTopologyEvidenceResolver(current, { ok: true, response: changed })(target),
    ).toEqual({
      ok: false,
      code: "invalid-geometry-evidence",
    })
    changed.evaluation = {
      ...valid.evaluation,
      records: featureIds.map((featureId) => ({
        featureId,
        status: "succeeded",
        contentHash: changedHash,
      })),
    }
    expect(
      createModelBodyTopologyEvidenceResolver(current, { ok: true, response: changed })(target),
    ).toMatchObject({
      ok: true,
      evidence: {
        generation: 8,
        rebuildId: "new-rebuild",
        contentHash: changedHash,
        candidates: [{ candidateId: "changed" }, {}],
      },
    })
    expect(original(target)).toMatchObject({
      ok: true,
      evidence: { generation: 7, contentHash: hash },
    })
  })
})

describe("createModelBodyTopologyEvidence", () => {
  it.each([{ valid: false }, { volume: 0 }])(
    "rejects inconsistent root metrics %j despite a valid body catalog",
    (metrics) => {
      const owned = geometry(featureIds[0], [
        body("result", [candidate("first"), candidate("second")]),
      ])
      const malformed = {
        ...owned,
        geometry: { ...owned.geometry, shape: { ...owned.geometry.shape, ...metrics } },
      }
      const result = createModelBodyTopologyEvidence(
        snapshot(),
        {
          ok: true,
          response: response([
            malformed,
            geometry(featureIds[1], [
              body("result", [candidate("other"), candidate("other-second")]),
            ]),
          ]),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      )
      expect(result).toEqual({ ok: false, code: "geometry-unavailable" })
    },
  )

  it("selects the exact role and strips display-only candidate fields", () => {
    const result = createModelBodyTopologyEvidence(
      snapshot(),
      {
        ok: true,
        response: response([
          geometry(
            featureIds[0],
            [
              body("left", [candidate("same"), candidate("left-second")]),
              body("right", [candidate("same", "edge.result"), candidate("right-second")]),
            ],
            2,
          ),
          geometry(featureIds[1], [
            body("result", [candidate("other"), candidate("other-second")]),
          ]),
        ]),
      },
      { featureId: featureIds[0], outputRole: "right", kind: "edge" },
    )

    expect(result).toMatchObject({ ok: true, evidence: { outputRole: "right", kind: "edge" } })
    if (result.ok) {
      expect(result.evidence.candidates).toHaveLength(2)
      expect(result.evidence.candidates[0]).toEqual({
        candidateId: "same",
        kind: "edge",
        semanticRole: "edge.result",
        lineageTokens: [],
        signature,
      })
    }
  })

  it("keeps coincident candidate IDs scoped to their selected body", () => {
    const result = createModelBodyTopologyEvidence(
      snapshot(),
      {
        ok: true,
        response: response([
          geometry(
            featureIds[0],
            [
              body("left", [candidate("same"), candidate("left-second")]),
              body("right", [candidate("same"), candidate("right-second")]),
            ],
            2,
          ),
          geometry(featureIds[1], [
            body("result", [candidate("other"), candidate("other-second")]),
          ]),
        ]),
      },
      { featureId: featureIds[0], outputRole: "right", kind: "edge" },
    )
    expect(result.ok && result.evidence.candidates[0]?.candidateId).toBe("same")
  })

  it("rejects missing or legacy body catalogs without aggregate fallback", () => {
    const current = snapshot()
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response([
            geometry(featureIds[0], []),
            geometry(featureIds[1], [
              body("result", [candidate("other"), candidate("other-second")]),
            ]),
          ]),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "body-not-found" })
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response([
            geometry(featureIds[0], [body("source", [candidate("same"), candidate("second")])]),
            geometry(featureIds[1], [
              body("result", [candidate("other"), candidate("other-second")]),
            ]),
          ]),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "body-not-found" })
  })

  it("rejects stale, wrong-hash, failed, and incomplete evidence", () => {
    const current = snapshot()
    const valid = response([
      geometry(featureIds[0], [body("result", [candidate("same"), candidate("second")])]),
      geometry(featureIds[1], [body("result", [candidate("other"), candidate("other-second")])]),
    ])
    expect(
      createModelBodyTopologyEvidence(
        current,
        { ok: true, response: { ...valid, revision: 3 } },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "stale-geometry" })
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response(
            [
              geometry(featureIds[0], [body("result", [candidate("same"), candidate("second")])]),
              geometry(featureIds[1], [
                body("result", [candidate("other"), candidate("other-second")]),
              ]),
            ],
            {},
            [
              { featureId: featureIds[0], status: "succeeded", contentHash: "b".repeat(64) },
              { featureId: featureIds[1], status: "succeeded", contentHash: hash },
            ],
          ),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response(
            [
              geometry(featureIds[1], [
                body("result", [candidate("other"), candidate("other-second")]),
              ]),
            ],
            {},
            [
              {
                featureId: featureIds[0],
                status: "failed",
                diagnostics: [{ code: "vibeshape.failure", values: {} }],
              },
              { featureId: featureIds[1], status: "succeeded", contentHash: hash },
            ],
          ),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "geometry-unavailable" })
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response([
            geometry(featureIds[0], [body("result", [candidate("same")])]),
            geometry(featureIds[1], [
              body("result", [candidate("other"), candidate("other-second")]),
            ]),
          ]),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })

  it("rejects duplicate geometry records and duplicate body roles", () => {
    const current = snapshot()
    const first = geometry(featureIds[0], [
      body("result", [candidate("same"), candidate("second")]),
    ])
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response([
            first,
            first,
            geometry(featureIds[1], [
              body("result", [candidate("other"), candidate("other-second")]),
            ]),
          ]),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      createModelBodyTopologyEvidence(
        current,
        {
          ok: true,
          response: response([
            geometry(
              featureIds[0],
              [
                body("result", [candidate("same"), candidate("second")]),
                body("result", [candidate("other"), candidate("other-second")]),
              ],
              2,
            ),
            geometry(featureIds[1], [body("result", [candidate("third"), candidate("fourth")])]),
          ]),
        },
        { featureId: featureIds[0], outputRole: "result", kind: "edge" },
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })
})
