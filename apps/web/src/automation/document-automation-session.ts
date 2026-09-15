import { createDisposableDocumentPreview } from "@vibeshape/application/disposable-document-preview"
import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import {
  type AutomationDocumentPort,
  type AutomationHostDiagnosticCode,
  createAutomationHost,
} from "@vibeshape/automation-host/host"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import type { CommandDispatcher, ModuleRegistry } from "@vibeshape/domain"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { automationReviews } from "./automation-review-controller"

// Client identity and pairing remain the transport's responsibility.
export function createDocumentAutomationSession(
  input: Readonly<{
    commands: CommandDispatcher
    modules: ModuleRegistry
    documents: AutomationDocumentPort
    createDraftId: () => string
  }>,
) {
  const queries = createQueryDispatcher(input.modules, documentCoreQueryHandlers)
  if (!queries.ok) return queries
  let closed = false
  let persisting = false
  const reviewOwner = Symbol("browser-automation-review")
  const preview = createDisposableDocumentPreview({
    mesh: PRODUCT_MESH_POLICY,
    createRebuildPort: createDocumentWorkerSession,
  })
  const factory = createAutomationHost({
    commandDispatcher: input.commands,
    queryDispatcher: queries.dispatcher,
    createDraftId: input.createDraftId,
    review: {
      confirm: (review) => (closed ? "cancelled" : automationReviews.request(reviewOwner, review)),
    },
    documents: {
      readSnapshot: (documentId) => {
        if (closed) throw new Error("The browser automation session is closed.")
        return input.documents.readSnapshot(documentId)
      },
      compareAndCommitDraft: async (draft, commands) => {
        if (closed) throw new Error("The browser automation session is closed.")
        persisting = true
        try {
          return await input.documents.compareAndCommitDraft(draft, commands)
        } finally {
          persisting = false
        }
      },
    },
    geometry: {
      async inspectEdges(snapshot, featureId) {
        if (closed) throw new Error("The browser automation session is closed.")
        const result = await preview.preview(snapshot, featureId)
        if (!result.ok) throw new Error(result.code)
        return result.edges
      },
      async evaluate(snapshot) {
        if (closed) throw new Error("The browser automation session is closed.")
        const result = await preview.preview(snapshot)
        if (!result.ok) throw new Error(result.code)
        return result.evidence
      },
    },
  })
  if (!factory.ok) {
    preview.dispose()
    return factory
  }
  return {
    ok: true as const,
    host: {
      ...factory.host,
      async commitDraft(actor: unknown, request: unknown) {
        const committed = await factory.host.commitDraft(actor, request)
        const result =
          closed && !committed.ok && committed.diagnostic.code === "automation-operation-failed"
            ? {
                ok: false as const,
                diagnostic: {
                  code: "draft-review-cancelled" as const,
                  message: "The browser automation session closed before the commit could proceed.",
                  retryable: false,
                  issues: [],
                },
              }
            : committed
        if (!result.ok && result.diagnostic.code === "draft-review-rejected")
          await factory.host.discardDraft(actor, request)
        automationReviews.complete(reviewOwner, result)
        return result
      },
    },
    cancel(reason?: AutomationHostDiagnosticCode) {
      preview.cancel()
      // The ordinary commit publishes its own new revision before its promise returns.
      if (!persisting) automationReviews.cancel(reviewOwner, reason)
    },
    dispose() {
      closed = true
      preview.dispose()
      // An accepted persistence transaction must report its actual outcome after disconnect.
      if (!persisting) automationReviews.cancel(reviewOwner)
    },
  }
}
