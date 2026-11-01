import {
  emitDesignRecipeTypeScript,
  exportDesignRecipe,
} from "@vibeshape/application/design-recipes"
import { createDisposableDocumentPreview } from "@vibeshape/application/disposable-document-preview"
import { readAuthoredMetadata } from "@vibeshape/automation-api/authored-metadata"
import {
  designRecipeExportArgumentsSchema,
  designRecipeExportViewSchema,
  localFailure,
} from "@vibeshape/automation-api/local-tools"
import { utf8StringBytes } from "@vibeshape/automation-api/query-byte-budget"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import {
  createMetadataProposalCoordinator,
  type createReviewedAuthoredProposalCoordinator,
  type MetadataProposalConfiguration,
} from "@vibeshape/automation-host/metadata-proposal"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { authoredDocumentSnapshotSchema } from "@vibeshape/domain/document-v2"
import type { SourceAssetMaterialization } from "@vibeshape/protocol"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { automationReviews } from "./automation-review-controller"

export type MetadataAutomationSessionConfiguration = Omit<
  MetadataProposalConfiguration,
  "actor" | "geometry" | "review"
> & {
  materializeSourceAssets?: (document: unknown) => Promise<readonly SourceAssetMaterialization[]>
}

/** First-party metadata shares the editor review surface and ordinary authored commit path. */
export function createMetadataAutomationSession(
  configuration: MetadataAutomationSessionConfiguration,
  reviews = automationReviews,
) {
  const { isActive, ...session } = createReviewedAuthoredAutomationSession(
    {
      ...configuration,
      createCoordinator: (ports) =>
        createMetadataProposalCoordinator({ ...configuration, ...ports }),
    },
    reviews,
  )
  return {
    ...session,
    async exportRecipe(input: unknown) {
      const request = designRecipeExportArgumentsSchema.safeParse(input)
      if (!request.success)
        return localFailure("invalid-request", "The recipe export request is invalid.")
      if (!isActive())
        return localFailure("session-revoked", "The metadata session is unavailable.")
      const snapshot = authoredDocumentSnapshotSchema.safeParse(await configuration.readSnapshot())
      if (
        !isActive() ||
        !snapshot.success ||
        snapshot.data.id !== configuration.documentId ||
        snapshot.data.revision !== request.data.revision
      )
        return localFailure(
          "stale-revision",
          "Recipe export requires the current paired saved design revision.",
          true,
        )
      const recipe = exportDesignRecipe(snapshot.data)
      if (!recipe.ok) return localFailure("recipe-export-unsupported", recipe.message)
      const source = emitDesignRecipeTypeScript(recipe.recipe)
      if (utf8StringBytes(source, 128 * 1024) > 128 * 1024)
        return localFailure(
          "recipe-export-limit",
          "Export this script from the editor: the MCP source limit is 128 KiB.",
        )
      return {
        ok: true as const,
        value: designRecipeExportViewSchema.parse({
          documentId: snapshot.data.id,
          revision: snapshot.data.revision,
          format: "vibeshape.recipe",
          version: 1,
          source,
        }),
      }
    },
    async read(kind: "parts" | "folders" | "history", input: unknown) {
      if (!isActive())
        return localFailure("session-revoked", "The metadata session is unavailable.")
      const snapshot = authoredDocumentSnapshotSchema.safeParse(await configuration.readSnapshot())
      if (!snapshot.success || snapshot.data.id !== configuration.documentId)
        return localFailure(
          "authored-metadata-unavailable",
          "The paired document has no authored parts or folders.",
        )
      if (!isActive())
        return localFailure("session-revoked", "The metadata session is unavailable.")
      return readAuthoredMetadata(snapshot.data, kind, input)
    },
  }
}

/** Browser review and worker lifetime are shared without widening semantic adapter contracts. */
export function createReviewedAuthoredAutomationSession<Value>(
  configuration: Pick<
    MetadataAutomationSessionConfiguration,
    "isActive" | "materializeSourceAssets"
  > & {
    createCoordinator: (
      ports: Pick<MetadataProposalConfiguration, "actor" | "geometry" | "review" | "isActive">,
    ) => ReturnType<typeof createReviewedAuthoredProposalCoordinator<{ commandId: string }, Value>>
  },
  reviews = automationReviews,
) {
  const owner = Symbol("browser-authored-review")
  let closed = false
  let changing = false
  let coordinator: ReturnType<typeof configuration.createCoordinator> | null = null
  const preview = createDisposableDocumentPreview({
    mesh: PRODUCT_MESH_POLICY,
    createRebuildPort: (documentId) =>
      createDocumentWorkerSession(
        documentId,
        configuration.materializeSourceAssets
          ? { materializeSourceAssets: configuration.materializeSourceAssets }
          : {},
      ),
  })
  return {
    isActive: () => !closed && configuration.isActive(),
    async change(actor: unknown, input: unknown, signal?: AbortSignal) {
      if (changing) return localFailure("busy", "Another authored proposal is pending.", true)
      if (!coordinator) {
        const parsed = commandActorSchema.safeParse(actor)
        if (!parsed.success || parsed.data.type !== "mcp")
          return localFailure(
            "invalid-automation-actor",
            "The proposal requires a paired MCP actor.",
          )
        coordinator = configuration.createCoordinator({
          actor: parsed.data,
          isActive: () => !closed && configuration.isActive(),
          geometry: {
            async evaluate(snapshot) {
              if (closed) throw new Error("The authored proposal session is closed.")
              const result = await preview.preview(snapshot)
              if (!result.ok) throw new Error(result.code)
              return result.evidence
            },
          },
          review: {
            confirm: (review) => (closed ? "cancelled" : reviews.request(owner, review)),
          },
        })
      }
      changing = true
      const current = coordinator
      const onAbort = () => {
        current.cancel()
        preview.cancel()
        if (!current.isPersisting()) reviews.cancel(owner)
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        const result = await current.change(actor, input, signal)
        reviews.complete(owner, result)
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
      if (!coordinator?.isPersisting()) reviews.cancel(owner, reason)
    },
    dispose() {
      closed = true
      coordinator?.dispose()
      preview.dispose()
      if (!coordinator?.isPersisting()) reviews.cancel(owner)
    },
  }
}
