import { createDisposableDocumentPreview } from "@vibeshape/application/disposable-document-preview"
import { readAuthoredMetadata } from "@vibeshape/automation-api/authored-metadata"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import {
  createMetadataProposalCoordinator,
  type MetadataProposalConfiguration,
} from "@vibeshape/automation-host/metadata-proposal"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { documentSnapshotV2Schema } from "@vibeshape/domain/document-v2"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { automationReviews } from "./automation-review-controller"

export type MetadataAutomationSessionConfiguration = Omit<
  MetadataProposalConfiguration,
  "actor" | "geometry" | "review"
>

/** First-party metadata shares the editor review surface and ordinary authored commit path. */
export function createMetadataAutomationSession(
  configuration: MetadataAutomationSessionConfiguration,
) {
  const owner = Symbol("browser-metadata-review")
  let closed = false
  let changing = false
  let coordinator: ReturnType<typeof createMetadataProposalCoordinator> | null = null
  const preview = createDisposableDocumentPreview({
    mesh: PRODUCT_MESH_POLICY,
    createRebuildPort: createDocumentWorkerSession,
  })
  return {
    async read(kind: "parts" | "folders" | "history", input: unknown) {
      if (closed || !configuration.isActive())
        return localFailure("session-revoked", "The metadata session is unavailable.")
      const snapshot = documentSnapshotV2Schema.safeParse(await configuration.readSnapshot())
      if (!snapshot.success || snapshot.data.id !== configuration.documentId)
        return localFailure(
          "authored-metadata-unavailable",
          "The paired document has no authored parts or folders.",
        )
      if (closed || !configuration.isActive())
        return localFailure("session-revoked", "The metadata session is unavailable.")
      return readAuthoredMetadata(snapshot.data, kind, input)
    },
    async change(actor: unknown, input: unknown, signal?: AbortSignal) {
      if (changing) return localFailure("busy", "Another metadata proposal is pending.", true)
      if (!coordinator) {
        const parsed = commandActorSchema.safeParse(actor)
        if (!parsed.success || parsed.data.type !== "mcp")
          return localFailure("invalid-automation-actor", "Metadata requires a paired MCP actor.")
        coordinator = createMetadataProposalCoordinator({
          ...configuration,
          actor: parsed.data,
          isActive: () => !closed && configuration.isActive(),
          geometry: {
            async evaluate(snapshot) {
              if (closed) throw new Error("The metadata session is closed.")
              const result = await preview.preview(snapshot)
              if (!result.ok) throw new Error(result.code)
              return result.evidence
            },
          },
          review: {
            confirm: (review) => (closed ? "cancelled" : automationReviews.request(owner, review)),
          },
        })
      }
      changing = true
      const current = coordinator
      const onAbort = () => {
        current.cancel()
        preview.cancel()
        if (!current.isPersisting()) automationReviews.cancel(owner)
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        const result = await current.change(actor, input, signal)
        automationReviews.complete(owner, result)
        return result.ok
          ? result
          : localFailure(
              result.diagnostic.code,
              result.diagnostic.message,
              result.diagnostic.retryable,
            )
      } finally {
        changing = false
        signal?.removeEventListener("abort", onAbort)
      }
    },
    cancel(reason?: AutomationHostDiagnosticCode) {
      coordinator?.cancel(reason)
      preview.cancel()
      if (!coordinator?.isPersisting()) automationReviews.cancel(owner, reason)
    },
    dispose() {
      closed = true
      coordinator?.dispose()
      preview.dispose()
      if (!coordinator?.isPersisting()) automationReviews.cancel(owner)
    },
  }
}
