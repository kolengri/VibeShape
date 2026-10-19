import type { LocalPlanarImportOperation } from "@vibeshape/automation-api/planar-imports"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import { inspectPlanarSource } from "../features/planar-import/parser-client"
import { automationReviews } from "./automation-review-controller"
import {
  createPlanarImportUploadSession,
  type PlanarImportSessionConfiguration,
} from "./planar-import-upload-session"

/** Planar inspection and its manual review belong to the captured paired session. */
export function createPlanarImportAutomationSession(
  configuration: Omit<PlanarImportSessionConfiguration, "inspect" | "review">,
  reviews = automationReviews,
) {
  const owner = Symbol("browser-planar-import-review")
  let worker: AbortController | null = null
  const uploads = createPlanarImportUploadSession({
    ...configuration,
    async inspect(prepared) {
      const current = new AbortController()
      worker = current
      try {
        const result = await inspectPlanarSource(prepared.input, current.signal)
        return result
      } finally {
        current.abort()
        if (worker === current) worker = null
      }
    },
    review: (input) => reviews.request(owner, input),
  })
  function cancel(reason?: AutomationHostDiagnosticCode) {
    uploads.cancel()
    worker?.abort()
    worker = null
    if (!uploads.isPersisting()) reviews.cancel(owner, reason)
  }
  return {
    async execute(actor: unknown, operation: LocalPlanarImportOperation, signal?: AbortSignal) {
      const onAbort = () => cancel()
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        const result = await uploads.execute(actor, operation, signal)
        if (operation.tool === "commit_planar_import_upload")
          reviews.complete(
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
