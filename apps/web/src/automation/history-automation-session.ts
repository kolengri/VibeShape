import { createDisposableDocumentPreview } from "@vibeshape/application/disposable-document-preview"
import { historyOperationSchema } from "@vibeshape/automation-api/history-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  createHistoryAutomationSession,
  type HistorySessionConfiguration,
} from "@vibeshape/automation-host/history-session"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import type { SourceAssetMaterialization } from "@vibeshape/protocol"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { automationReviews } from "./automation-review-controller"

export function createBrowserHistoryAutomationSession(
  configuration: Omit<HistorySessionConfiguration, "review" | "preview"> & {
    materializeSourceAssets: (document: unknown) => Promise<readonly SourceAssetMaterialization[]>
    previewAssembly: (
      target: Parameters<HistorySessionConfiguration["preview"]>[0],
      baseRevision: number,
    ) => Promise<Awaited<ReturnType<HistorySessionConfiguration["preview"]>>["assembly"]>
  },
) {
  const owner = Symbol("browser-history-review")
  const preview = createDisposableDocumentPreview({
    mesh: PRODUCT_MESH_POLICY,
    createRebuildPort: (documentId) =>
      createDocumentWorkerSession(documentId, {
        materializeSourceAssets: configuration.materializeSourceAssets,
      }),
  })
  const session = createHistoryAutomationSession({
    ...configuration,
    review: (input) => automationReviews.request(owner, input),
    async preview(target, baseRevision) {
      const result = await preview.preview(target.snapshot)
      if (!result.ok) throw new Error(result.code)
      const assembly = await configuration.previewAssembly(target, baseRevision)
      return {
        valid: result.valid,
        measurements: result.evidence,
        ...(assembly ? { assembly } : {}),
      }
    },
  })
  let changing = false
  return {
    async execute(actor: unknown, input: unknown, signal?: AbortSignal) {
      const operation = historyOperationSchema.safeParse(input)
      if (!operation.success)
        return localFailure("invalid-input", "The history operation is invalid.")
      const reviewing = operation.data.tool !== "model_history_state"
      if (reviewing && changing)
        return localFailure("busy", "Another history proposal is pending.", true)
      if (reviewing) changing = true
      const abort = () => {
        session.cancel()
        preview.cancel()
        if (!session.isPersisting()) automationReviews.cancel(owner)
      }
      if (reviewing) signal?.addEventListener("abort", abort, { once: true })
      try {
        const result = await session.execute(actor, operation.data, signal)
        if (reviewing) automationReviews.complete(owner, result)
        return result
      } finally {
        if (reviewing) changing = false
        signal?.removeEventListener("abort", abort)
      }
    },
    cancel(reason?: AutomationHostDiagnosticCode) {
      session.cancel(reason)
      preview.cancel()
      if (!session.isPersisting()) automationReviews.cancel(owner, reason)
    },
    dispose() {
      session.dispose()
      preview.dispose()
      if (!session.isPersisting()) automationReviews.cancel(owner)
    },
  }
}
