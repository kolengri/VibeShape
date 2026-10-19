import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import { boxFeatureType, documentSnapshotSchema, type FeatureRecord } from "@vibeshape/domain"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import { extrusionBodyOptions } from "./extrusion-body-options"

export function extrusionBodyFixture(
  edited: FeatureRecord | undefined,
  multiBody = false,
  surface?: "PLANE" | "SPHERE",
) {
  const targetId = "0195b5ac-b220-7a2c-8c33-67a36a7f3602"
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f3610",
    revision: 4,
    name: "Legacy extrusion",
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T00:00:00.000Z",
    features: [
      {
        schemaVersion: 0,
        id: targetId,
        type: boxFeatureType.type,
        parameters: {},
        dependencies: [],
        references: [],
        suppressed: false,
        label: "Producer",
      },
      ...(edited ? [edited] : []),
    ],
  })
  const shape = {
    valid: true,
    volume: 1,
    surfaceArea: 6,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    faceCount: surface ? 1 : 6,
    edgeCount: 12,
    solidCount: 1,
  }
  const mesh = {
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
    triangleFaceIds: new Uint32Array([1]),
  }
  const hash = "a".repeat(64)
  const topologyCandidates = surface
    ? [
        {
          candidateId: "face:end",
          kind: "face",
          meshFaceId: 1,
          signature: {
            kind: "face",
            geometryClass: surface,
            measure: surface === "PLANE" ? 1 : Math.PI,
            centroid: [0.5, 0.5, 1],
            bounds: { min: [0, 0, surface === "PLANE" ? 1 : 0], max: [1, 1, 1] },
            boundaryCount: surface === "PLANE" ? 4 : 1,
            adjacentGeometryClasses: [],
            ...(surface === "PLANE" ? { direction: [0, 0, 1], directionMode: "oriented" } : {}),
          },
          lineageTokens: [],
        },
      ]
    : []
  const environment = {
    schemaVersion: 0,
    hostApiVersion: "0.1.0",
    modelingTolerancePolicyVersion: 1,
    geometry: {
      adapterId: "org.vibeshape.geometry.replicad",
      adapterVersion: "test-build",
      kernelId: "org.opencascade.occt",
      kernelVersion: "7.9.2",
      kernelSourceRevision: null,
    },
    provider: { kind: "built-in" },
  }
  const response = documentWorkerResponseSchema.parse({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f3611",
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: 0,
    type: "documentRebuilt",
    evaluation: {
      records: [
        { featureId: targetId, status: "succeeded", contentHash: hash },
        ...(edited ? [{ featureId: edited.id, status: "blocked", blockedBy: [targetId] }] : []),
      ],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: [
      {
        featureId: targetId,
        contentHash: hash,
        meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
        geometry: {
          engine: {
            adapter: "replicad",
            adapterVersion: "test-build",
            replicadVersion: "0.23.1",
            opencascadePackageVersion: "0.23.0",
            opencascadeSourceRevision: null,
            wasmBytes: 1,
            initializedInMs: 1,
            featureContentEnvironment: environment,
          },
          shape: { ...shape, ...(multiBody ? { solidCount: 2, volume: 2 } : {}) },
          mesh,
          topologyCandidates,
          bodies: (multiBody ? ["compound.input.0", "compound.input.1"] : ["result"]).map(
            (outputRole) => ({ outputRole, shape, mesh, topologyCandidates }),
          ),
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      },
    ],
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("Expected a rebuild fixture.")
  const rebuild: DocumentRebuildOutcome = { ok: true, response }
  const options = extrusionBodyOptions(
    snapshot,
    rebuild,
    edited?.id,
    (name, role) => `${name} · ${role}`,
    (name) => `${name} · all bodies (legacy scope)`,
  )
  return { snapshot, rebuild, options }
}

export function collectedExtrusionOptions(
  edited: FeatureRecord | undefined,
  multiBody = false,
  surface?: "PLANE" | "SPHERE",
) {
  return extrusionBodyFixture(edited, multiBody, surface).options
}
