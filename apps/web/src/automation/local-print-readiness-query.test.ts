import { describe, expect, it } from "bun:test"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import type { MeasurementPreparationPort } from "./local-measurement-query"
import { executePrintReadinessQuery } from "./local-print-readiness-query"

const id = (n: number) => `0195b5ac-b281-7a2c-8c33-${String(n).padStart(12, "0")}`
function fixture() {
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(1),
    revision: 4,
    name: "Print",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    features: [
      {
        schemaVersion: 0,
        id: id(2),
        type: boxFeatureType.type,
        parameters: {},
        dependencies: [],
        references: [],
        suppressed: false,
      },
    ],
  })
  const mesh = {
    positions: new Float32Array([
      0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 2, 10, 0, 2, 10, 10, 2, 0, 10, 2,
    ]),
    normals: new Float32Array(24),
    indices: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
      0, 4, 3, 4, 7,
    ]),
    triangleFaceIds: new Uint32Array(12),
  }
  const shape = {
    valid: true,
    volume: 200,
    surfaceArea: 280,
    bounds: { min: [0, 0, 0], max: [10, 10, 2] },
    faceCount: 6,
    edgeCount: 12,
    solidCount: 1,
  }
  const hash = "a".repeat(64)
  const geometry = {
    featureId: id(2),
    contentHash: hash,
    meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
    geometry: {
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
      shape,
      mesh,
      bodies: [{ outputRole: "result", shape, mesh, topologyCandidates: [] }],
      topologyCandidates: [],
      cache: { brepHit: false },
      timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
    },
  }
  const response = {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(3),
    documentId: id(1),
    revision: 4,
    generation: 7,
    type: "documentRebuilt",
    geometry: [geometry],
    sketches: [],
    modelReferenceEvidence: [],
    evaluation: {
      records: [{ featureId: id(2), status: "succeeded", contentHash: hash }],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
  }
  const context = { snapshot, rebuild: { ok: true as const, response } }
  let current: typeof context | null = context
  const port: MeasurementPreparationPort = {
    readCommittedContext: () => current,
    rebuild: async () => {
      throw new Error("Must reuse committed geometry")
    },
  }
  const operation = localOperationSchema.parse({
    tool: "analyze_print_readiness",
    arguments: { revision: 4, rotationX: 0, rotationY: 0, rotationZ: 0 },
  })
  if (operation.tool !== "analyze_print_readiness") throw new Error("Invalid fixture")
  return {
    port,
    context,
    operation,
    invalidate: () => {
      current = null
    },
  }
}
describe("committed print readiness adapter", () => {
  it("analyzes the current committed body without a document or worker mutation", async () => {
    const { port, operation } = fixture()
    const result = await executePrintReadinessQuery(port, id(1), operation)
    expect(result).toMatchObject({
      ok: true,
      value: {
        revision: 4,
        rotationX: 0,
        status: "no-findings",
        bodies: [{ triangleCount: 12, topology: "closed", unknownTriangles: 0 }],
      },
    })
  })
  it("rejects old revisions, explicit cancellation and a source replaced while pending", async () => {
    const { port, operation, invalidate } = fixture()
    const stale = await executePrintReadinessQuery(port, id(1), {
      ...operation,
      arguments: { ...operation.arguments, revision: 3 },
    })
    expect(stale).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    const abort = new AbortController()
    abort.abort()
    expect(await executePrintReadinessQuery(port, id(1), operation, abort.signal)).toMatchObject({
      ok: false,
      diagnostic: { code: "request-cancelled" },
    })
    const pending = executePrintReadinessQuery(port, id(1), operation)
    invalidate()
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  })
})
