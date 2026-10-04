import type { LocalImportOperation } from "@vibeshape/automation-api/imports"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { automationReviews } from "./automation-review-controller"
import { createImportUploadSession, type ImportSessionConfiguration } from "./import-upload-session"

/** Native inspection and its manual review belong to the captured paired session. */
export function createImportAutomationSession(
  configuration: Omit<ImportSessionConfiguration, "inspect" | "review">,
) {
  const owner = Symbol("browser-import-review")
  let worker: ReturnType<typeof createDocumentWorkerSession> | null = null
  const uploads = createImportUploadSession({
    ...configuration,
    async inspect(prepared) {
      const current = createDocumentWorkerSession(configuration.documentId)
      worker = current
      try {
        return prepared.representation === "triangle-mesh"
          ? (await current.inspectMeshImport(prepared.input)).inspection
          : (
              await current.inspectSourceImport({
                source: prepared.source,
                bytes: prepared.bytes,
                mesh: PRODUCT_MESH_POLICY,
              })
            ).inspection
      } finally {
        current.terminate()
        if (worker === current) worker = null
      }
    },
    review: (input) => automationReviews.request(owner, input),
  })
  function cancel(reason?: AutomationHostDiagnosticCode) {
    uploads.cancel()
    worker?.terminate()
    worker = null
    if (!uploads.isPersisting()) automationReviews.cancel(owner, reason)
  }
  return {
    async execute(actor: unknown, operation: LocalImportOperation, signal?: AbortSignal) {
      const onAbort = () => cancel()
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        const result = await uploads.execute(actor, operation, signal)
        if (operation.tool === "commit_import_upload")
          automationReviews.complete(
            owner,
            result.ok
              ? result
              : {
                  ok: false,
                  diagnostic: { ...result.diagnostic, code: "document-commit-failed", issues: [] },
                },
          )
        return result
      } finally {
        signal?.removeEventListener("abort", onAbort)
      }
    },
    cancel,
    dispose() {
      uploads.dispose()
      cancel()
    },
  }
}
