import { describe, expect, it } from "bun:test"
import type { PersistentDocumentSessionReport } from "@vibeshape/application/persistent-document-session"
import { boxFeatureType, createLengthQuantity, featureRecordSchema } from "@vibeshape/domain"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { DOCUMENT_PROTOCOL_VERSION, featureEvaluationEngineResultSchema } from "@vibeshape/protocol"
import { pressPullToolFromSelection } from "./press-pull-selection"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const hash = "a".repeat(64),
  documentId = id(1),
  featureId = id(2)
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20),
    depth: createLengthQuantity(12),
    height: createLengthQuantity(10),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
})
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 1,
  name: "Press Pull",
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
  features: [feature],
})
const bounds = { min: [-10, -6, 0], max: [10, 6, 10] }
const candidates = [0, 1, 2].flatMap((axis) =>
  [false, true].map((positive) => {
    const value = (positive ? bounds.max : bounds.min)[axis] ?? 0
    const centroid = [0, 0, 5],
      min = [...bounds.min],
      max = [...bounds.max]
    centroid[axis] = value
    min[axis] = value
    max[axis] = value
    return {
      candidateId: `face:${axis}:${positive}`,
      kind: "face",
      meshFaceId: axis * 2 + Number(positive),
      semanticRole: `face.${axis}.${positive}`,
      lineageTokens: [],
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: [120, 200, 240][axis],
        centroid,
        bounds: { min, max },
        boundaryCount: 4,
        adjacentGeometryClasses: ["LINE", "LINE", "LINE", "LINE"],
      },
    }
  }),
)
const shape = {
  valid: true,
  solidCount: 1,
  volume: 2400,
  surfaceArea: 1120,
  bounds,
  faceCount: 6,
  edgeCount: 12,
}
const mesh = {
  positions: new Float32Array([0, 0, 10, 1, 0, 10, 0, 1, 10]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([5]),
}
const geometry = featureEvaluationEngineResultSchema.parse({
  engine: {
    adapter: "replicad",
    adapterVersion: "test",
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
        adapterVersion: "test",
        kernelId: "org.opencascade.occt",
        kernelVersion: "7.8.1",
        kernelSourceRevision: null,
      },
      modelingTolerancePolicyVersion: 1,
      provider: { kind: "built-in" },
    },
  },
  shape,
  mesh,
  topologyCandidates: candidates,
  bodies: [{ outputRole: "result", shape, mesh, topologyCandidates: candidates }],
  cache: { brepHit: false },
  timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
})
function report(result = geometry): PersistentDocumentSessionReport {
  return {
    status: "created",
    mode: "read-write",
    snapshot,
    historyItems: null,
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
    rebuild: {
      ok: true,
      response: {
        protocolVersion: DOCUMENT_PROTOCOL_VERSION,
        requestId: id(3),
        type: "documentRebuilt",
        documentId,
        revision: 1,
        generation: 1,
        geometry: [
          {
            featureId,
            contentHash: hash,
            meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
            geometry: result,
          },
        ],
        evaluation: {
          records: [{ featureId, status: "succeeded", contentHash: hash }],
          dirtyFeatureIds: [],
          evaluatedFeatureIds: [featureId],
          reusedFeatureIds: [],
        },
        sketches: [],
        modelReferenceEvidence: [],
      },
    },
  }
}
function selection() {
  const face = geometry.bodies?.[0]?.topologyCandidates.find(
    ({ kind, signature }) => kind === "face" && Math.abs(signature.centroid[2] - 10) < 1e-7,
  )
  if (face?.meshFaceId === undefined) throw new Error("Fixture requires a rendered top face.")
  return { featureId, outputRole: "result", faceId: face.meshFaceId, faceOrdinal: 0 }
}
describe("current viewer selection to durable Press Pull intent", () => {
  it("captures the exact rendered face without persisting native IDs", () => {
    const tool = pressPullToolFromSelection(report(), selection())
    expect(tool).toMatchObject({
      kind: "create-press-pull",
      targetBody: { featureId, outputRole: "result" },
      sourceContentHash: hash,
      face: { kind: "face", signature: { geometryClass: "PLANE" } },
    })
    expect(JSON.stringify(tool)).not.toContain("meshFaceId")
    expect(JSON.stringify(tool)).not.toContain("candidateId")
  })
  it("rejects absent, wrong-role, read-only and stale picks", () => {
    const current = report(),
      pick = selection()
    expect(pressPullToolFromSelection(current, null)).toBeNull()
    expect(pressPullToolFromSelection(current, { ...pick, faceId: -1 })).toBeNull()
    expect(pressPullToolFromSelection(current, { ...pick, outputRole: "other" })).toBeNull()
    expect(pressPullToolFromSelection({ ...current, mode: "read-only" }, pick)).toBeNull()
    expect(
      pressPullToolFromSelection({ ...current, snapshot: { ...snapshot, revision: 2 } }, pick),
    ).toBeNull()
  })
  it("rejects ambiguous mesh mappings and curved geometry", () => {
    const body = geometry.bodies?.[0]
    if (!body) throw new Error("Fixture requires a body.")
    const pick = selection()
    const candidates = body.topologyCandidates.map((candidate) =>
      candidate.meshFaceId === pick.faceId
        ? {
            ...candidate,
            signature: { ...candidate.signature, geometryClass: "CYLINDRE" },
            referenceGeometry: undefined,
          }
        : candidate,
    )
    expect(
      pressPullToolFromSelection(
        report({ ...geometry, bodies: [{ ...body, topologyCandidates: candidates }] }),
        pick,
      ),
    ).toBeNull()
    const selected = body.topologyCandidates.find(
      (candidate) => candidate.meshFaceId === pick.faceId,
    )
    if (!selected) throw new Error("Fixture face is missing.")
    expect(
      pressPullToolFromSelection(
        report({
          ...geometry,
          bodies: [
            {
              ...body,
              topologyCandidates: [
                ...body.topologyCandidates,
                { ...selected, candidateId: "face:duplicate" },
              ],
            },
          ],
        }),
        pick,
      ),
    ).toBeNull()
  })
})
