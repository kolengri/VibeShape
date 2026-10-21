import { describe, expect, it } from "bun:test"
import { createModelBodyTopologyEvidenceResolver } from "@vibeshape/application/model-body-topology"
import {
  measurementOperationSchema,
  measurementResultContextMatches,
} from "@vibeshape/automation-api/measurement-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { documentIdSchema, featureIdSchema } from "@vibeshape/domain/identifiers"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { DOCUMENT_PROTOCOL_VERSION, type TopologyCandidate } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import {
  executeModelMeasurementQuery,
  type MeasurementPreparationPort,
} from "./local-measurement-query"

const id = (n: number) => `0195b5ac-b281-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(99),
})
const documentId = id(1)
const leftId = featureIdSchema.parse(id(2))
const rightId = featureIdSchema.parse(id(3))
const hash = "a".repeat(64)
type Point = [number, number, number]

function plane(center: Point, direction: Point): TopologyCandidate {
  return {
    candidateId: "face:0",
    kind: "face",
    lineageTokens: [],
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 100,
      centroid: center,
      bounds: { min: [-10, -10, -10], max: [20, 20, 20] },
      direction,
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
  }
}
const line: TopologyCandidate = {
  candidateId: "edge:0",
  kind: "edge",
  lineageTokens: [],
  signature: {
    kind: "edge",
    geometryClass: "LINE",
    measure: 10,
    centroid: [5, 0, 0],
    bounds: { min: [0, 0, 0], max: [10, 0, 0] },
    direction: [1, 0, 0],
    directionMode: "axis",
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
  referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [10, 0, 0] },
  edgePolyline: [
    [0, 0, 0],
    [1, 0, 0],
  ],
}
const circle: TopologyCandidate = {
  candidateId: "edge:1",
  kind: "edge",
  lineageTokens: [],
  signature: {
    kind: "edge",
    geometryClass: "CIRCLE",
    measure: 10 * Math.PI,
    centroid: [0, 0, 0],
    bounds: { min: [-5, -5, 0], max: [5, 5, 0] },
    boundaryCount: 0,
    adjacentGeometryClasses: [],
  },
  referenceGeometry: {
    kind: "circle-edge",
    center: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
    radius: 5,
  },
}
const mesh = {
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array([0, 0, 0]),
  triangleFaceIds: new Uint32Array([0]),
}
function geometry(featureId: string, outputRole: string, candidates: TopologyCandidate[]) {
  const shape = {
    valid: true,
    volume: 120,
    surfaceArea: 100,
    bounds: { min: [-10, -10, -10], max: [20, 20, 20] },
    faceCount: candidates.filter(({ kind }) => kind === "face").length,
    edgeCount: candidates.filter(({ kind }) => kind === "edge").length,
    solidCount: 1,
  }
  const body = { outputRole, shape: { ...shape }, mesh, topologyCandidates: candidates }
  return {
    body,
    record: {
      featureId,
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
        bodies: [body],
        topologyCandidates: [],
        cache: { brepHit: false },
        timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
      },
    },
  }
}
function fixture(duplicateLine = false) {
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Precise measurements",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    features: [leftId, rightId].map((id) => ({
      schemaVersion: 0,
      id,
      type: boxFeatureType.type,
      parameters: {},
      dependencies: [],
      references: [],
      suppressed: false,
    })),
  })
  const left = geometry(leftId, "split.positive", [
    structuredClone(line),
    structuredClone(circle),
    plane([0, 0, 0], [0, 0, 1]),
    ...(duplicateLine ? [{ ...structuredClone(line), candidateId: "edge:2" }] : []),
  ])
  const right = geometry(rightId, "result", [plane([3, 4, 12], [0, 0, -1])])
  const response = {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(50),
    documentId,
    revision: 4,
    generation: 7,
    type: "documentRebuilt",
    geometry: [left.record, right.record],
    sketches: [],
    modelReferenceEvidence: [],
    evaluation: {
      records: [leftId, rightId].map((featureId) => ({
        featureId,
        status: "succeeded",
        contentHash: hash,
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
  }
  const evidenceFor = createModelBodyTopologyEvidenceResolver(snapshot, { ok: true, response })
  function reference(side: "left" | "right", index: number) {
    const { record, body } = side === "left" ? left : right
    const candidate = body.topologyCandidates[index]
    if (!candidate || candidate.kind === "vertex") throw new Error("Expected face or edge fixture.")
    const result = evidenceFor({
      featureId: featureIdSchema.parse(record.featureId),
      outputRole: body.outputRole,
      kind: candidate.kind,
    })
    if (!result.ok) throw new Error(`Invalid fixture: ${result.code}`)
    const exact = result.evidence.candidates.find(
      ({ candidateId }) => candidateId === candidate.candidateId,
    )
    if (!exact) throw new Error("Expected exact topology candidate.")
    return createBodyTopologyReferenceProjector(result.evidence)(exact)
  }
  const readOwnedDraftSnapshot = vi.fn<
    NonNullable<MeasurementPreparationPort["readOwnedDraftSnapshot"]>
  >(async () => ({ ok: true, value: snapshot }))
  const rebuild = vi.fn<MeasurementPreparationPort["rebuild"]>(async () => ({ ok: true, response }))
  const readCommittedContext = vi.fn<MeasurementPreparationPort["readCommittedContext"]>(() => ({
    snapshot,
    rebuild: { ok: true, response },
  }))
  const sideEffects = {
    applyCommand: vi.fn(),
    commitDraft: vi.fn(),
    previewDraft: vi.fn(),
    persist: vi.fn(),
  }
  const port = { readCommittedContext, readOwnedDraftSnapshot, rebuild, ...sideEffects }
  function operation(
    targets: unknown[] = [{ reference: reference("left", 0) }],
    source: "model" | "draft" = "model",
  ) {
    return measurementOperationSchema.parse({
      tool: "measure_model",
      arguments: {
        source,
        revision: 4,
        targets,
        ...(source === "draft" ? { draftId: id(10) } : {}),
      },
    })
  }
  return { snapshot, response, left, right, reference, operation, port, sideEffects }
}
function execute(f: ReturnType<typeof fixture>, operation = f.operation(), signal?: AbortSignal) {
  return executeModelMeasurementQuery(f.port, actor, documentId, operation, signal)
}

describe("exact topology measurement adapter", () => {
  it("reports analytical line and circular values without rebuilding the committed model", async () => {
    const f = fixture()
    const before = canonicalJson(f.snapshot)
    const operation = f.operation([
      { reference: f.reference("left", 0), pointKind: "end" },
      { reference: f.reference("left", 1), pointKind: "center" },
    ])
    const result = await execute(f, operation)
    expect(result).toMatchObject({
      ok: true,
      value: {
        documentId,
        revision: 4,
        generation: 7,
        source: "model",
        targets: [
          {
            lengthMm: 10,
            radiusMm: null,
            diameterMm: null,
            direction: [1, 0, 0],
            pointMm: [10, 0, 0],
          },
          {
            lengthMm: 10 * Math.PI,
            radiusMm: 5,
            diameterMm: 10,
            direction: null,
            pointMm: [0, 0, 0],
          },
        ],
        pair: { pointDistanceMm: 10, directionAngleRad: null, parallelPlaneSeparationMm: null },
      },
    })
    expect(measurementResultContextMatches(operation, result, documentId)).toBe(true)
    expect(f.port.rebuild).not.toHaveBeenCalled()
    expect(f.port.readOwnedDraftSnapshot).not.toHaveBeenCalled()
    expect(canonicalJson(f.snapshot)).toBe(before)
    for (const write of Object.values(f.sideEffects)) expect(write).not.toHaveBeenCalled()
  })

  it("measures across bodies with colliding transient IDs and distinguishes point distance from plane separation", async () => {
    const f = fixture()
    const result = await execute(
      f,
      f.operation(
        [{ reference: f.reference("left", 2) }, { reference: f.reference("right", 0) }],
        "draft",
      ),
    )
    expect(result).toMatchObject({
      ok: true,
      value: {
        source: "draft",
        draftId: id(10),
        targets: [
          { areaMm2: 100, pointKind: "centroid", pointMm: [0, 0, 0] },
          { areaMm2: 100, pointKind: "centroid", pointMm: [3, 4, 12] },
        ],
        pair: { pointDistanceMm: 13, directionAngleRad: 0, parallelPlaneSeparationMm: 12 },
      },
    })
    expect(f.port.rebuild).toHaveBeenCalledTimes(1)
    expect(f.port.rebuild).toHaveBeenCalledWith(f.snapshot, undefined)
    expect(f.port.readOwnedDraftSnapshot).toHaveBeenCalledTimes(2)
    expect(f.port.readOwnedDraftSnapshot).toHaveBeenCalledWith(actor, {
      schemaVersion: 1,
      draftId: id(10),
      revision: 4,
    })
    for (const write of Object.values(f.sideEffects)) expect(write).not.toHaveBeenCalled()
  })

  it("returns null for a single target pair and rejects unavailable analytical points", async () => {
    const f = fixture()
    expect(await execute(f)).toMatchObject({
      ok: true,
      value: { pair: null, targets: [{ pointKind: "centroid", pointMm: [5, 0, 0] }] },
    })
    for (const [index, pointKind] of [
      [0, "middle"],
      [1, "start"],
      [2, "center"],
    ] as const) {
      expect(
        await execute(f, f.operation([{ reference: f.reference("left", index), pointKind }])),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "unsupported-measurement-point" },
      })
    }
  })

  it("uses the acute angle between a line direction and plane normal, without claiming a line-to-plane angle", async () => {
    const f = fixture()
    expect(
      await execute(
        f,
        f.operation([{ reference: f.reference("left", 0) }, { reference: f.reference("left", 2) }]),
      ),
    ).toMatchObject({
      ok: true,
      value: { pair: { directionAngleRad: Math.PI / 2, parallelPlaneSeparationMm: null } },
    })
  })

  it("returns null plane separation for nonparallel faces", async () => {
    const f = fixture()
    const face = f.right.body.topologyCandidates[0]
    if (!face) throw new Error("Expected face fixture.")
    face.signature.direction = [1, 0, 0]
    expect(
      await execute(
        f,
        f.operation([
          { reference: f.reference("left", 2) },
          { reference: f.reference("right", 0) },
        ]),
      ),
    ).toMatchObject({
      ok: true,
      value: { pair: { directionAngleRad: Math.PI / 2, parallelPlaneSeparationMm: null } },
    })
  })

  it("fails closed for ambiguous or missing stable references", async () => {
    const ambiguous = fixture(true)
    expect(await execute(ambiguous)).toMatchObject({
      ok: false,
      diagnostic: { code: "ambiguous-topology-reference" },
    })
    const f = fixture()
    const missing = {
      ...f.reference("left", 0),
      signature: { ...line.signature, geometryClass: "MISSING", centroid: [10000, 10000, 10000] },
    }
    expect(await execute(f, f.operation([{ reference: missing }]))).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-topology-reference" },
    })
    expect(
      await execute(
        f,
        f.operation([{ reference: { ...f.reference("left", 0), outputRole: "missing" } }]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "body-not-found" } })
  })

  it("rejects stale committed revisions, changed generations and wrong-document rebuilds", async () => {
    const f = fixture()
    const operation = f.operation()
    f.port.readCommittedContext.mockReturnValueOnce({
      snapshot: { ...f.snapshot, revision: 5 },
      rebuild: { ok: true, response: f.response },
    })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    f.port.readCommittedContext
      .mockReturnValueOnce({ snapshot: f.snapshot, rebuild: { ok: true, response: f.response } })
      .mockReturnValueOnce({
        snapshot: f.snapshot,
        rebuild: { ok: true, response: { ...f.response, generation: 8 } },
      })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-geometry" },
    })
    f.response.documentId = id(88)
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-geometry" },
    })
  })

  it("rejects incomplete, failed and invalid body geometry", async () => {
    const f = fixture()
    const operation = f.operation()
    f.left.body.shape.valid = false
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence" },
    })
    f.left.body.shape.valid = true
    f.response.evaluation.records.pop()
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence" },
    })
    f.port.readCommittedContext.mockReturnValue({
      snapshot: f.snapshot,
      rebuild: { ok: false, code: "rebuild-failed" },
    })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "rebuild-failed" },
    })
  })
})

describe("owned draft lifetime and cancellation", () => {
  it.each([
    "invalid-automation-actor",
    "draft-not-found",
    "draft-owner-mismatch",
    "draft-expired",
    "stale-query-revision",
  ] as const)("preserves the host's %s failure without rebuilding or writing", async (code) => {
    const f = fixture()
    const operation = f.operation(undefined, "draft")
    f.port.readOwnedDraftSnapshot.mockResolvedValue({
      ok: false,
      diagnostic: { code, message: "Owned draft read failed.", retryable: false, issues: [] },
    })
    const result = await execute(f, operation)
    expect(result).toMatchObject({ ok: false, diagnostic: { code } })
    expect(f.port.rebuild).not.toHaveBeenCalled()
    for (const write of Object.values(f.sideEffects)) expect(write).not.toHaveBeenCalled()
  })

  it("rejects wrong-document snapshots and stale or cancelled rebuilds", async () => {
    const f = fixture()
    const operation = f.operation(undefined, "draft")
    f.port.readOwnedDraftSnapshot.mockResolvedValueOnce({
      ok: true,
      value: { ...f.snapshot, id: documentIdSchema.parse(id(88)) },
    })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    f.port.rebuild.mockResolvedValueOnce({ ok: true, response: { ...f.response, revision: 3 } })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-geometry" },
    })
    f.port.rebuild.mockResolvedValueOnce({ ok: false, code: "preview-cancelled" })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "preview-cancelled" },
    })
    f.port.rebuild.mockRejectedValueOnce(new Error("Worker failed"))
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "measurement-failed" },
    })
  })

  it("rechecks ownership and exact draft revision after rebuilding", async () => {
    const f = fixture()
    const operation = f.operation(undefined, "draft")
    f.port.readOwnedDraftSnapshot
      .mockResolvedValueOnce({ ok: true, value: f.snapshot })
      .mockResolvedValueOnce({ ok: true, value: { ...f.snapshot, revision: 5 } })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    f.port.readOwnedDraftSnapshot
      .mockResolvedValueOnce({ ok: true, value: f.snapshot })
      .mockResolvedValueOnce({
        ok: false,
        diagnostic: {
          code: "draft-not-found",
          message: "Draft expired during measurement.",
          retryable: false,
          issues: [],
        },
      })
    expect(await execute(f, operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-not-found" },
    })
  })

  it.each(["before", "read", "rebuild", "recheck"] as const)(
    "checks cancellation at %s",
    async (stage) => {
      const f = fixture()
      const operation = f.operation(undefined, "draft")
      const controller = new AbortController()
      if (stage === "before") controller.abort()
      if (stage === "read")
        f.port.readOwnedDraftSnapshot.mockImplementationOnce(async () => {
          controller.abort()
          return { ok: true, value: f.snapshot }
        })
      if (stage === "rebuild")
        f.port.rebuild.mockImplementationOnce(async () => {
          controller.abort()
          return { ok: true, response: f.response }
        })
      if (stage === "recheck")
        f.port.readOwnedDraftSnapshot
          .mockResolvedValueOnce({ ok: true, value: f.snapshot })
          .mockImplementationOnce(async () => {
            controller.abort()
            return { ok: true, value: f.snapshot }
          })
      expect(await execute(f, operation, controller.signal)).toMatchObject({
        ok: false,
        diagnostic: { code: "request-cancelled" },
      })
      if (stage === "before") expect(f.port.readOwnedDraftSnapshot).not.toHaveBeenCalled()
      if (stage === "before" || stage === "read") expect(f.port.rebuild).not.toHaveBeenCalled()
      for (const write of Object.values(f.sideEffects)) expect(write).not.toHaveBeenCalled()
    },
  )
})
