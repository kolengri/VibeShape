import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { type DocumentId, type FeatureId, featureIdSchema } from "@vibeshape/domain/identifiers"
import type { ModelBodyTopologyEvidenceResult } from "@vibeshape/domain/model-body-topology"
import type { ModelDiagnosticsEvidence } from "@vibeshape/domain/model-diagnostics"
import type { ModelEdgeEvidenceResult } from "@vibeshape/domain/model-edges"
import type { ModelMeasurementEvidence } from "@vibeshape/domain/model-measurements"
import { type FeatureMeshPolicy, featureMeshPolicySchema } from "@vibeshape/protocol"
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
}>

type PendingPreview = {
  readonly port: DocumentRebuildPort
  readonly resolve: (result: DisposableDocumentPreviewResult) => void
  settled: boolean
  terminated: boolean
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

  async function run(
    operation: PendingPreview,
    snapshot: DocumentSnapshot,
    edgeFeatureId?: FeatureId,
    bodyTopologyTarget?: { featureId: FeatureId; outputRole: string; kind: "edge" | "face" },
  ): Promise<void> {
    try {
      const response = await operation.port.rebuild({ document: snapshot, mesh })
      if (operation.settled) return
      const projected = createModelMeasurementEvidence(snapshot, { ok: true, response })
      if (!projected.ok) {
        settle(operation, failure(projected.code))
        return
      }
      const diagnostics = createModelDiagnosticsEvidence(snapshot, { ok: true, response })
      if (!diagnostics.ok) {
        settle(operation, failure(diagnostics.code))
        return
      }
      const valid =
        diagnostics.evidence.status === "valid" &&
        projected.evidence.features.every(
          (entry) => entry.status !== "failed" && entry.status !== "blocked",
        )
      settle(operation, {
        ok: true,
        evidence: projected.evidence,
        valid,
        diagnostics: diagnostics.evidence,
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
      })
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
