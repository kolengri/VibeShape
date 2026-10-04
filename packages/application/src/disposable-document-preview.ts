import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { type DocumentId, type FeatureId, featureIdSchema } from "@vibeshape/domain/identifiers"
import type { ModelBodyTopologyEvidenceResult } from "@vibeshape/domain/model-body-topology"
import type { ModelDiagnosticsEvidence } from "@vibeshape/domain/model-diagnostics"
import type { ModelEdgeEvidenceResult } from "@vibeshape/domain/model-edges"
import type { ModelMeasurementEvidence } from "@vibeshape/domain/model-measurements"
import {
  type DocumentWorkerTerminalResponse,
  documentWorkerResponseSchema,
  type FeatureMeshPolicy,
  featureMeshPolicySchema,
} from "@vibeshape/protocol"
import { createModelBodyTopologyEvidence } from "./model-body-topology"
import { createModelDiagnosticsEvidence } from "./model-diagnostics"
import { createModelEdgeEvidence } from "./model-edges"
import {
  createModelBodyMeasurementEvidence,
  createModelMeasurementEvidence,
  type ModelBodyMeasurementResult,
} from "./model-measurements"
import type { DocumentRebuildPort } from "./persistent-document-session"

export type DisposableDocumentPreviewFailureCode =
  | "geometry-unavailable"
  | "stale-geometry"
  | "invalid-geometry-evidence"
  | "preview-cancelled"
  | "preview-disposed"
  | "preview-failed"

export type DisposableDocumentPreviewResult =
  | {
      ok: true
      evidence: ModelMeasurementEvidence
      valid: boolean
      diagnostics: ModelDiagnosticsEvidence
      bodyMeasurements: ModelBodyMeasurementResult
      bodyTopology?: ModelBodyTopologyEvidenceResult
      edges?: ModelEdgeEvidenceResult
      rebuild?: Extract<DocumentWorkerTerminalResponse, { type: "documentRebuilt" }>
    }
  | { ok: false; code: DisposableDocumentPreviewFailureCode }

export type DisposableDocumentPreview = Readonly<{
  preview: (
    snapshot: DocumentSnapshot,
    edgeFeatureId?: FeatureId,
    bodyTopologyTarget?: { featureId: FeatureId; outputRole: string; kind: "edge" | "face" },
  ) => Promise<DisposableDocumentPreviewResult>
  cancel: () => void
  dispose: () => void
}>

export type DisposableDocumentPreviewOptions = Readonly<{
  createRebuildPort: (documentId: DocumentId) => DocumentRebuildPort
  mesh: FeatureMeshPolicy
  retainRebuild?: boolean
}>

type PendingPreview = {
  readonly port: DocumentRebuildPort
  readonly resolve: (result: DisposableDocumentPreviewResult) => void
  settled: boolean
  terminated: boolean
}

type RebuildResponse = Extract<DocumentWorkerTerminalResponse, { type: "documentRebuilt" }>

function retainedRebuild(response: RebuildResponse): RebuildResponse {
  function copyMesh(mesh: RebuildResponse["geometry"][number]["geometry"]["mesh"]) {
    return {
      positions: mesh.positions.slice(),
      normals: mesh.normals.slice(),
      indices: mesh.indices.slice(),
      triangleFaceIds: mesh.triangleFaceIds.slice(),
    }
  }
  return {
    ...response,
    geometry: response.geometry.map((record) => ({
      ...record,
      geometry: {
        ...record.geometry,
        mesh: copyMesh(record.geometry.mesh),
        ...(record.geometry.bodies
          ? {
              bodies: record.geometry.bodies.map((body) => ({
                ...body,
                mesh: copyMesh(body.mesh),
              })),
            }
          : {}),
      },
    })),
  }
}

function failure(code: DisposableDocumentPreviewFailureCode): DisposableDocumentPreviewResult {
  return { ok: false, code }
}

export function createDisposableDocumentPreview(
  options: DisposableDocumentPreviewOptions,
): DisposableDocumentPreview {
  const mesh = featureMeshPolicySchema.parse(options.mesh)
  let pending: PendingPreview | null = null
  let disposed = false

  function terminate(operation: PendingPreview) {
    if (operation.terminated) return
    operation.terminated = true
    try {
      operation.port.terminate()
    } catch {
      // Termination is best-effort because the port is already isolated and disposable.
    }
  }

  function settle(operation: PendingPreview, result: DisposableDocumentPreviewResult) {
    if (operation.settled) return
    operation.settled = true
    if (pending === operation) pending = null
    try {
      terminate(operation)
    } finally {
      operation.resolve(result)
    }
  }

  function cancel() {
    const operation = pending
    if (!operation) return
    settle(operation, failure("preview-cancelled"))
  }

  function dispose() {
    if (disposed) return
    disposed = true
    cancel()
  }

  function projectPreview(
    snapshot: DocumentSnapshot,
    response: RebuildResponse,
    edgeFeatureId?: FeatureId,
    bodyTopologyTarget?: { featureId: FeatureId; outputRole: string; kind: "edge" | "face" },
  ): DisposableDocumentPreviewResult {
    const projected = createModelMeasurementEvidence(snapshot, { ok: true, response })
    if (!projected.ok) return failure(projected.code)
    const diagnostics = createModelDiagnosticsEvidence(snapshot, { ok: true, response })
    if (!diagnostics.ok) return failure(diagnostics.code)
    const valid =
      diagnostics.evidence.status === "valid" &&
      projected.evidence.features.every(
        (entry) => entry.status !== "failed" && entry.status !== "blocked",
      )
    return {
      ok: true,
      evidence: projected.evidence,
      valid,
      diagnostics: diagnostics.evidence,
      // Rendering retains caller-owned buffers; ordinary inspections avoid the additional copy.
      ...(options.retainRebuild ? { rebuild: retainedRebuild(response) } : {}),
      bodyMeasurements: createModelBodyMeasurementEvidence(snapshot, { ok: true, response }),
      ...(bodyTopologyTarget === undefined
        ? {}
        : {
            bodyTopology: createModelBodyTopologyEvidence(
              snapshot,
              { ok: true, response },
              bodyTopologyTarget,
            ),
          }),
      ...(edgeFeatureId === undefined
        ? {}
        : { edges: createModelEdgeEvidence(snapshot, { ok: true, response }, edgeFeatureId) }),
    }
  }

  async function run(
    operation: PendingPreview,
    snapshot: DocumentSnapshot,
    edgeFeatureId?: FeatureId,
    bodyTopologyTarget?: { featureId: FeatureId; outputRole: string; kind: "edge" | "face" },
  ): Promise<void> {
    try {
      const rebuilt = await operation.port.rebuild({ document: snapshot, mesh })
      if (operation.settled) return
      const parsed = documentWorkerResponseSchema.safeParse(rebuilt)
      if (!parsed.success || parsed.data.type !== "documentRebuilt") {
        settle(operation, failure("invalid-geometry-evidence"))
        return
      }
      settle(operation, projectPreview(snapshot, parsed.data, edgeFeatureId, bodyTopologyTarget))
    } catch {
      if (!operation.settled) settle(operation, failure("preview-failed"))
    }
  }

  function preview(
    input: DocumentSnapshot,
    edgeFeatureId?: FeatureId,
    bodyTopologyTarget?: { featureId: FeatureId; outputRole: string; kind: "edge" | "face" },
  ): Promise<DisposableDocumentPreviewResult> {
    if (disposed) return Promise.resolve(failure("preview-disposed"))
    cancel()

    const parsed = documentSnapshotSchema.safeParse(input)
    if (!parsed.success) return Promise.resolve(failure("preview-failed"))
    if (edgeFeatureId !== undefined && !featureIdSchema.safeParse(edgeFeatureId).success)
      return Promise.resolve(failure("preview-failed"))

    let port: DocumentRebuildPort
    try {
      port = options.createRebuildPort(parsed.data.id)
    } catch {
      return Promise.resolve(failure("preview-failed"))
    }

    return new Promise<DisposableDocumentPreviewResult>((resolve) => {
      const operation: PendingPreview = {
        port,
        resolve,
        settled: false,
        terminated: false,
      }
      pending = operation
      void run(operation, parsed.data, edgeFeatureId, bodyTopologyTarget)
    })
  }

  return { preview, cancel, dispose }
}
