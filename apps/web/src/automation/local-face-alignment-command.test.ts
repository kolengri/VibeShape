import { describe, expect, it } from "bun:test"
import { createModelBodyTopologyEvidenceResolver } from "@vibeshape/application/model-body-topology"
import {
  applyAutomationDraftCommandRequestSchema,
  automationDraftStateSchema,
} from "@vibeshape/automation-api/drafts"
import { faceAlignmentOperationSchema } from "@vibeshape/automation-api/face-alignment-tools"
import type { AutomationHost, AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain/commands"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import {
  placementFeatureParametersSchema,
  placementFeatureType,
} from "@vibeshape/domain/part-design-placement"
import type { TopologyCandidate } from "@vibeshape/domain/topology"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import {
  executeFaceAlignedPlacementCommand,
  type FaceAlignmentPreparationPort,
} from "./local-face-alignment-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(99),
})
const documentId = id(1)
const sourceId = featureIdSchema.parse(id(2))
const targetId = featureIdSchema.parse(id(3))
const hash = "a".repeat(64)
const shape = {
  valid: true,
  volume: 120,
  surfaceArea: 88,
  bounds: { min: [-10, -10, -10], max: [40, 40, 40] },
  faceCount: 1,
  edgeCount: 0,
  solidCount: 1,
}
const mesh = {
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array([0, 0, 0]),
  triangleFaceIds: new Uint32Array([0]),
}
function candidate(
  normal: [number, number, number],
  center: [number, number, number],
): TopologyCandidate {
  return {
    candidateId: "face:7",
    kind: "face" as const,
    semanticRole: "cap",
    lineageTokens: [],
    signature: {
      kind: "face" as const,
      geometryClass: "PLANE",
      measure: 100,
      centroid: center,
      bounds: {
        min: [center[0] - 5, center[1] - 5, center[2] - 5],
        max: [center[0] + 5, center[1] + 5, center[2] + 5],
      },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
      direction: normal,
      directionMode: "oriented" as const,
    },
  }
}
function geometry(featureId: string, outputRole: string, face: ReturnType<typeof candidate>) {
  return {
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
      shape: { ...shape },
      mesh,
      topologyCandidates: [],
      bodies: [{ outputRole, shape: { ...shape }, mesh, topologyCandidates: [face] }],
      cache: { brepHit: false },
      timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
    },
  }
}
function fixture() {
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Face placement",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    features: [sourceId, targetId].map((id) => ({
      schemaVersion: 0,
      id,
      type: boxFeatureType.type,
      parameters: {},
      dependencies: [],
      references: [],
      suppressed: false,
    })),
  })
  const response = {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(50),
    documentId,
    revision: 4,
    generation: 7,
    type: "documentRebuilt",
    evaluation: {
      records: [sourceId, targetId].map((featureId) => ({
        featureId,
        status: "succeeded",
        contentHash: hash,
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: [
      geometry(sourceId, "split.positive", candidate([0, 0, -1], [1, 2, 3])),
      geometry(targetId, "result", candidate([0, 0, 1], [10, 20, 30])),
    ],
    sketches: [],
    modelReferenceEvidence: [],
  }
  const evidenceFor = createModelBodyTopologyEvidenceResolver(snapshot, { ok: true, response })
  function reference(featureId: typeof sourceId, outputRole: string) {
    const evidence = evidenceFor({ featureId, outputRole, kind: "face" })
    if (!evidence.ok || !evidence.evidence.candidates[0])
      throw new Error("Expected exact face evidence.")
    return createBodyTopologyReferenceProjector(evidence.evidence)(evidence.evidence.candidates[0])
  }
  const operation = faceAlignmentOperationSchema.parse({
    tool: "create_face_aligned_placement",
    arguments: {
      draftId: id(10),
      commandId: id(11),
      baseRevision: 4,
      featureId: id(12),
      label: "Aligned source",
      sourceFace: reference(sourceId, "split.positive"),
      targetFace: reference(targetId, "result"),
      orientation: "opposed",
      offsetMm: -4,
    },
  })
  const readOwnedDraftSnapshot = vi.fn<
    NonNullable<FaceAlignmentPreparationPort["readOwnedDraftSnapshot"]>
  >(async () => ({ ok: true, value: snapshot }))
  const rebuild = vi.fn<FaceAlignmentPreparationPort["rebuild"]>(async () => ({
    ok: true,
    response,
  }))
  const applyCommand = vi.fn<AutomationHost["applyCommand"]>(async (_actor, request) => {
    const parsed = parseDocumentCommand(
      applyAutomationDraftCommandRequestSchema.parse(request).command,
    )
    if (!parsed.ok || parsed.command.kind !== "org.vibeshape.feature.add")
      throw new Error("Expected an ordinary placement add command.")
    return {
      ok: true as const,
      value: automationDraftStateSchema.parse({
        schemaVersion: 1,
        draftId: id(10),
        documentId,
        baseRevision: 2,
        revision: 5,
        commandCount: 3,
        expiresAt: "2026-10-21T12:00:00.000Z",
      }),
    }
  })
  const preparation = { readOwnedDraftSnapshot, rebuild }
  const host = { applyCommand }
  return {
    snapshot,
    response,
    operation,
    host,
    preparation,
    run: (signal?: AbortSignal) =>
      executeFaceAlignedPlacementCommand(host, actor, documentId, operation, preparation, signal),
  }
}
function staged(s: ReturnType<typeof fixture>) {
  const call = s.host.applyCommand.mock.calls[0]
  if (!call) throw new Error("Expected one staged command.")
  const parsed = parseDocumentCommand(
    applyAutomationDraftCommandRequestSchema.parse(call[1]).command,
  )
  if (!parsed.ok || parsed.command.kind !== "org.vibeshape.feature.add")
    throw new Error("Expected feature add.")
  return parsed.command
}
function failure(code: AutomationHostDiagnosticCode) {
  return {
    ok: false as const,
    diagnostic: { code, message: "Owned draft unavailable.", retryable: true, issues: [] },
  }
}

function targetEvidence(s: ReturnType<typeof fixture>) {
  const record = s.response.geometry[1]
  const body = record?.geometry.bodies[0]
  const face = body?.topologyCandidates[0]
  if (!record || !body || !face) throw new Error("Missing fixture body.")
  return { body, face }
}

const invalidFaceEvidence: Record<string, (s: ReturnType<typeof fixture>) => void> = {
  missing: (s) => {
    s.operation.arguments.targetFace.semanticRole = "absent-cap"
  },
  ambiguous: (s) => {
    const { body, face } = targetEvidence(s)
    delete s.operation.arguments.targetFace.semanticRole
    const { semanticRole: _semanticRole, ...unidentified } = face
    body.topologyCandidates = [unidentified, { ...unidentified, candidateId: "face:8" }]
    body.shape.faceCount = 2
  },
  curved: (s) => {
    targetEvidence(s).face.signature.geometryClass = "CYLINDER"
  },
  unoriented: (s) => {
    targetEvidence(s).face.signature.directionMode = "axis"
  },
  "nonunit-normal": (s) => {
    targetEvidence(s).face.signature.direction = [0, 0, 2]
  },
  "invalid-body": (s) => {
    targetEvidence(s).body.shape.valid = false
  },
  "foreign-role": (s) => {
    s.operation.arguments.targetFace.outputRole = "split.negative"
  },
  incomplete: (s) => {
    s.response.geometry.pop()
  },
  "stale-rebuild": (s) => {
    s.response.revision = 5
  },
  "foreign-rebuild": (s) => {
    s.response.documentId = id(60)
  },
  "same-body": (s) => {
    s.operation.arguments.targetFace = s.operation.arguments.sourceFace
  },
}

describe("owned draft face alignment", () => {
  it.each([-4, 0, 6])(
    "stages one numerical placement using signed target-normal offset %s",
    async (offsetMm) => {
      const s = fixture()
      s.operation.arguments.offsetMm = offsetMm
      expect(await s.run()).toMatchObject({ ok: true, value: { revision: 5, commandCount: 3 } })
      expect(s.preparation.rebuild).toHaveBeenCalledTimes(1)
      expect(s.preparation.readOwnedDraftSnapshot).toHaveBeenCalledTimes(2)
      expect(s.preparation.readOwnedDraftSnapshot).toHaveBeenCalledWith(actor, {
        schemaVersion: 1,
        draftId: id(10),
        revision: 4,
      })
      expect(s.host.applyCommand).toHaveBeenCalledTimes(1)
      const command = staged(s)
      expect(command).toMatchObject({ commandId: id(11), documentId, actor, baseRevision: 4 })
      expect(command.payload.feature).toMatchObject({
        id: id(12),
        type: placementFeatureType.type,
        label: "Aligned source",
        dependencies: [sourceId],
        references: [],
        suppressed: false,
      })
      const parameters = placementFeatureParametersSchema.parse(command.payload.feature.parameters)
      expect(parameters.targetBody).toEqual({
        schemaVersion: 0,
        featureId: sourceId,
        outputRole: "split.positive",
      })
      expect(Object.values(parameters.translation).map(({ value }) => value)).toEqual([
        9,
        18,
        27 + offsetMm,
      ])
      for (const quantity of Object.values(parameters.translation)) expect(quantity.unit).toBe("mm")
      for (const quantity of Object.values(parameters.rotation)) {
        expect(quantity.value).toBeCloseTo(0, 10)
        expect(quantity.unit).toBe("rad")
      }
      expect(Object.keys(parameters).sort()).toEqual(["rotation", "targetBody", "translation"])
    },
  )

  it("uses resolved exact normals and centers, rather than editable reference signatures", async () => {
    const s = fixture()
    s.operation.arguments.sourceFace.signature.direction = [1, 0, 0]
    s.operation.arguments.sourceFace.signature.centroid = [999, 0, 0]
    expect(await s.run()).toMatchObject({ ok: true })
    const parameters = placementFeatureParametersSchema.parse(staged(s).payload.feature.parameters)
    expect(Object.values(parameters.translation).map(({ value }) => value)).toEqual([9, 18, 23])
  })

  it("resolves sibling body roles independently within one multi-body feature", async () => {
    const s = fixture()
    const source = s.response.geometry[0]
    const target = s.response.geometry[1]?.geometry.bodies[0]
    if (!source || !target) throw new Error("Missing fixture bodies.")
    source.geometry.bodies.push({ ...target, outputRole: "split.negative" })
    source.geometry.shape.solidCount = 2
    s.operation.arguments.targetFace.featureId = sourceId
    s.operation.arguments.targetFace.outputRole = "split.negative"
    expect(await s.run()).toMatchObject({ ok: true })
    const feature = staged(s).payload.feature
    expect(feature.dependencies).toEqual([sourceId])
    expect(placementFeatureParametersSchema.parse(feature.parameters).targetBody.outputRole).toBe(
      "split.positive",
    )
  })

  it("aligns same normals using the Placement world-origin rotation convention", async () => {
    const s = fixture()
    s.operation.arguments.orientation = "same"
    expect(await s.run()).toMatchObject({ ok: true })
    const p = placementFeatureParametersSchema.parse(staged(s).payload.feature.parameters)
    // The deterministic half turn about Y maps -Z onto +Z and [1,2,3] onto [-1,2,-3].
    expect(p.rotation.y.value).toBeCloseTo(0, 10)
    expect(Math.abs(p.rotation.x.value)).toBeCloseTo(Math.PI, 10)
    expect(Math.abs(p.rotation.z.value)).toBeCloseTo(Math.PI, 10)
    expect(p.translation.x.value).toBeCloseTo(11, 10)
    expect(p.translation.y.value).toBeCloseTo(18, 10)
    expect(p.translation.z.value).toBeCloseTo(29, 10)
  })

  it.each([
    "draft-owner-mismatch",
    "draft-expired",
    "draft-not-found",
    "stale-query-revision",
  ] as const)("rejects %s before rebuilding or staging", async (code) => {
    const s = fixture()
    s.preparation.readOwnedDraftSnapshot.mockResolvedValueOnce(failure(code))
    expect(await s.run()).toMatchObject({ ok: false, diagnostic: { code } })
    expect(s.preparation.rebuild).not.toHaveBeenCalled()
    expect(s.host.applyCommand).not.toHaveBeenCalled()
  })

  it.each(Object.entries(invalidFaceEvidence))(
    "rejects %s evidence without staging",
    async (_kind, invalidate) => {
      const s = fixture()
      invalidate(s)
      expect(await s.run()).toMatchObject({ ok: false })
      expect(s.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it.each(["stale-query-revision", "draft-not-found", "draft-owner-mismatch"] as const)(
    "rejects %s after the asynchronous rebuild",
    async (code) => {
      const s = fixture()
      s.preparation.readOwnedDraftSnapshot
        .mockResolvedValueOnce({ ok: true, value: s.snapshot })
        .mockResolvedValueOnce(failure(code))
      expect(await s.run()).toMatchObject({ ok: false, diagnostic: { code } })
      expect(s.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it.each(["before-read", "after-read", "during-rebuild", "before-apply"])(
    "does not stage when cancelled %s",
    async (phase) => {
      const s = fixture()
      const controller = new AbortController()
      if (phase === "before-read") controller.abort()
      if (phase === "after-read")
        s.preparation.readOwnedDraftSnapshot.mockImplementationOnce(async () => {
          controller.abort()
          return { ok: true, value: s.snapshot }
        })
      if (phase === "during-rebuild")
        s.preparation.rebuild.mockImplementationOnce(async () => {
          controller.abort()
          return { ok: true, response: s.response }
        })
      if (phase === "before-apply")
        s.preparation.readOwnedDraftSnapshot
          .mockResolvedValueOnce({ ok: true, value: s.snapshot })
          .mockImplementationOnce(async () => {
            controller.abort()
            return { ok: true, value: s.snapshot }
          })
      expect(await s.run(controller.signal)).toMatchObject({
        ok: false,
        diagnostic: { code: "request-cancelled" },
      })
      expect(s.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it("retains normal command-authority rejection without an alternate mutation path", async () => {
    const s = fixture()
    s.host.applyCommand.mockResolvedValueOnce(failure("stale-query-revision"))
    expect(await s.run()).toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision" } })
    expect(s.host.applyCommand).toHaveBeenCalledTimes(1)
  })

  it("fails closed when owned-draft preparation is unavailable", async () => {
    const s = fixture()
    expect(
      await executeFaceAlignedPlacementCommand(s.host, actor, documentId, s.operation, {
        rebuild: s.preparation.rebuild,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "face-alignment-unavailable" } })
    expect(s.preparation.rebuild).not.toHaveBeenCalled()
    expect(s.host.applyCommand).not.toHaveBeenCalled()
  })
})
