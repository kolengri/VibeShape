import {
  createDisposableDocumentPreview,
  type DisposableDocumentPreviewResult,
} from "@vibeshape/application/disposable-document-preview"
import { createDisposableSketchInspection } from "@vibeshape/application/disposable-sketch-inspection"
import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import type { RenderPreviewArguments } from "@vibeshape/automation-api/render-preview"
import {
  type AutomationDocumentPort,
  type AutomationHostDiagnosticCode,
  createAutomationHost,
  type DraftReviewInput,
} from "@vibeshape/automation-host/host"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import type { CommandDispatcher, ModuleRegistry } from "@vibeshape/domain"
import { type CommandActor, commandActorSchema } from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { SourceAssetMaterialization } from "@vibeshape/protocol"
import { renderModelPreview } from "@vibeshape/viewer/model-preview"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { createAutomationDraftViewport } from "./automation-draft-viewport"
import { automationReviews } from "./automation-review-controller"
import { createCommittedSketchInspection } from "./committed-sketch-inspection"
import { createModelPreviewSession } from "./model-preview-session"
import { mayAutoApplyCadReview } from "./session-auto-apply"

function sameDraftRevision(
  left: DraftReviewInput["preview"]["draft"],
  right: DraftReviewInput["preview"]["draft"],
) {
  return (["draftId", "documentId", "baseRevision", "revision", "commandCount"] as const).every(
    (key) => left[key] === right[key],
  )
}

// Client identity and pairing remain the transport's responsibility.
export function createDocumentAutomationSession(
  input: Readonly<{
    commands: CommandDispatcher
    modules: ModuleRegistry
    documents: AutomationDocumentPort
    materializeSourceAssets?: (document: unknown) => Promise<readonly SourceAssetMaterialization[]>
    unsupportedPreviewRepresentation?: (target: RenderPreviewArguments["target"]) => string | null
    createDraftId: () => string
  }>,
  reviews = automationReviews,
) {
  const queries = createQueryDispatcher(input.modules, documentCoreQueryHandlers)
  if (!queries.ok) return queries
  let closed = false
  let persisting = false
  let autoApplyActor: CommandActor | null = null
  let commitActive = false
  let commitGrant: CommandActor | null = null
  let applicationDraft: DraftReviewInput["preview"]["draft"] | null = null
  let previewEpoch = 0
  let reviewEvaluation: {
    snapshot: DocumentSnapshot
    rebuild: NonNullable<Extract<DisposableDocumentPreviewResult, { ok: true }>["rebuild"]>
  } | null = null
  const reviewOwner = Symbol("browser-automation-review")
  const preview = createDisposableDocumentPreview({
    retainRebuild: true,
    mesh: PRODUCT_MESH_POLICY,
    createRebuildPort: (documentId) =>
      createDocumentWorkerSession(
        documentId,
        input.materializeSourceAssets
          ? { materializeSourceAssets: input.materializeSourceAssets }
          : {},
      ),
  })
  const sketchInspection = createDisposableSketchInspection({
    mesh: PRODUCT_MESH_POLICY,
    createInspectionId: () => crypto.randomUUID(),
    createRebuildPort: (documentId) =>
      createDocumentWorkerSession(
        documentId,
        input.materializeSourceAssets
          ? { materializeSourceAssets: input.materializeSourceAssets }
          : {},
      ),
  })
  const renderedPreview = createModelPreviewSession({
    documents: input.documents,
    render: renderModelPreview,
    ...(input.unsupportedPreviewRepresentation
      ? { unsupportedRepresentation: input.unsupportedPreviewRepresentation }
      : {}),
    preview: createDisposableDocumentPreview({
      retainRebuild: true,
      mesh: PRODUCT_MESH_POLICY,
      createRebuildPort: (documentId) =>
        createDocumentWorkerSession(
          documentId,
          input.materializeSourceAssets
            ? { materializeSourceAssets: input.materializeSourceAssets }
            : {},
        ),
    }),
  })
  const committedSketch = createCommittedSketchInspection({
    documents: input.documents,
    queries: queries.dispatcher,
    inspection: sketchInspection,
  })
  async function autoApplyReviewDecision(
    review: DraftReviewInput,
    actor: CommandActor,
    epoch: number,
  ) {
    const base = documentSnapshotSchema.safeParse(
      await input.documents.readSnapshot(review.preview.draft.documentId),
    )
    if (closed || epoch !== previewEpoch) return "cancelled"
    if (!base.success) return null
    if (
      base.data.id !== review.preview.draft.documentId ||
      base.data.revision !== review.preview.draft.baseRevision
    )
      return null
    return mayAutoApplyCadReview(review, actor, base.data.features) ? "approved" : null
  }
  const factory = createAutomationHost({
    commandDispatcher: input.commands,
    queryDispatcher: queries.dispatcher,
    createDraftId: input.createDraftId,
    review: {
      confirm: async (review) => {
        // The serialized host reevaluates this draft immediately before confirming it.
        const evaluated = reviewEvaluation
        reviewEvaluation = null
        const epoch = previewEpoch
        if (closed) return "cancelled"
        // A chat click authorizes only the exact private revision that was displayed.
        if (applicationDraft && !sameDraftRevision(review.preview.draft, applicationDraft))
          return "cancelled"
        if (commitGrant) {
          const decision = await autoApplyReviewDecision(review, commitGrant, epoch)
          if (decision) return decision
        }
        return reviews.request(
          reviewOwner,
          review,
          evaluated
            ? createAutomationDraftViewport(review, evaluated.snapshot, evaluated.rebuild)
            : null,
        )
      },
    },
    documents: {
      readSnapshot: (documentId) => {
        if (closed) throw new Error("The browser automation session is closed.")
        return input.documents.readSnapshot(documentId)
      },
      ...(input.documents.validateDraft
        ? {
            validateDraft: async (
              ...args: Parameters<NonNullable<AutomationDocumentPort["validateDraft"]>>
            ) => {
              if (closed) throw new Error("The browser automation session is closed.")
              const result = await input.documents.validateDraft?.(...args)
              if (closed) throw new Error("The browser automation session is closed.")
              if (!result) throw new Error("The browser draft validation port is unavailable.")
              return result
            },
          }
        : {}),
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
      renderPreview: renderedPreview.renderSnapshot,
      async inspectSketchSolution(snapshot, sketchId) {
        if (closed) return { ok: false, code: "geometry-unavailable" }
        const result = await sketchInspection.inspect(snapshot, sketchId)
        if (result.ok) return result
        return {
          ok: false,
          code: result.code.startsWith("preview-") ? "geometry-unavailable" : result.code,
        }
      },
      async inspectBodyMeasurements(snapshot) {
        if (closed) throw new Error("The browser automation session is closed.")
        const result = await preview.preview(snapshot)
        if (!result.ok) throw new Error(result.code)
        return result.bodyMeasurements
      },
      async inspectBodyTopology(snapshot, target) {
        if (closed) throw new Error("The browser automation session is closed.")
        const result = await preview.preview(snapshot, undefined, target)
        if (!result.ok) throw new Error(result.code)
        return result.bodyTopology
      },
      async inspectEdges(snapshot, featureId) {
        if (closed) throw new Error("The browser automation session is closed.")
        const result = await preview.preview(snapshot, featureId)
        if (!result.ok) throw new Error(result.code)
        return result.edges
      },
      async evaluate(snapshot) {
        reviewEvaluation = null
        const epoch = previewEpoch
        if (closed) throw new Error("The browser automation session is closed.")
        const result = await preview.preview(snapshot)
        if (closed || epoch !== previewEpoch)
          throw new Error("The browser draft preview was cancelled.")
        if (!result.ok) throw new Error(result.code)
        if (!closed && result.rebuild) reviewEvaluation = { snapshot, rebuild: result.rebuild }
        return { measurements: result.evidence, diagnostics: result.diagnostics }
      },
    },
  })
  if (!factory.ok) {
    preview.dispose()
    renderedPreview.dispose()
    committedSketch.dispose()
    return factory
  }
  const host = factory.host
  async function commitDraft(actor: unknown, request: unknown) {
    if (commitActive)
      return {
        ok: false as const,
        diagnostic: {
          code: "automation-operation-failed" as const,
          message: "Another browser commit is in progress.",
          retryable: true,
          issues: [],
        },
      }
    commitActive = true
    reviews.clearDraftViewport(reviewOwner)
    reviewEvaluation = null
    // A later opt-in cannot authorize a commit that already started under manual review.
    commitGrant = autoApplyActor
    try {
      const committed = await host.commitDraft(actor, request)
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
        await host.discardDraft(actor, request)
      reviews.complete(reviewOwner, result)
      return result
    } finally {
      commitActive = false
      commitGrant = null
      reviewEvaluation = null
    }
  }
  async function presentDraftPreview(actor: unknown, request: unknown, epoch: number) {
    const result = await host.previewDraft(actor, request)
    if (closed || epoch !== previewEpoch || !result.ok || commitActive) return result
    const evaluated = reviewEvaluation
    reviewEvaluation = null
    const viewport = evaluated
      ? createAutomationDraftViewport(
          { preview: result.value },
          evaluated.snapshot,
          evaluated.rebuild,
        )
      : null
    if (viewport)
      reviews.presentDraftViewport(reviewOwner, viewport, async () => {
        if (commitActive) return commitDraft(actor, request)
        applicationDraft = viewport.draft
        try {
          return await commitDraft(actor, request)
        } finally {
          applicationDraft = null
        }
      })
    return result
  }
  return {
    ok: true as const,
    readSketchSolution: committedSketch.read,
    readRenderPreview: renderedPreview.read,
    // Trusted browser composition only: this is deliberately absent from the MCP tool surface.
    enableAutoApply(actor: unknown) {
      const parsed = commandActorSchema.safeParse(actor)
      if (
        closed ||
        commitActive ||
        reviews.getSnapshot() ||
        !parsed.success ||
        parsed.data.type !== "mcp"
      )
        return false
      autoApplyActor = parsed.data
      return true
    },
    disableAutoApply() {
      if (closed || commitActive || reviews.getSnapshot()) return false
      autoApplyActor = null
      return true
    },
    host: {
      ...host,
      async applyCommand(actor: unknown, request: unknown) {
        const epoch = previewEpoch
        const result = await host.applyCommand(actor, request)
        if (!result.ok || closed || epoch !== previewEpoch) return result
        reviews.clearDraftViewport(reviewOwner)
        // Drawing is disposable: a failed rebuild must not turn accepted private intent into a
        // failed command or save it. Explicit preview/commit still report validation diagnostics.
        await presentDraftPreview(actor, { schemaVersion: 1, draftId: result.value.draftId }, epoch)
        return result
      },
      async previewDraft(actor: unknown, request: unknown) {
        reviews.clearDraftViewport(reviewOwner)
        return presentDraftPreview(actor, request, previewEpoch)
      },
      async discardDraft(actor: unknown, request: unknown) {
        const result = await host.discardDraft(actor, request)
        if (result.ok) reviews.clearDraftViewport(reviewOwner)
        return result
      },
      commitDraft,
    },
    cancel(reason?: AutomationHostDiagnosticCode) {
      previewEpoch++
      reviewEvaluation = null
      preview.cancel()
      renderedPreview.cancel()
      committedSketch.cancel()
      reviews.clearDraftViewport(reviewOwner)
      // The ordinary commit publishes its own new revision before its promise returns.
      if (!persisting) reviews.cancel(reviewOwner, reason)
    },
    dispose() {
      previewEpoch++
      reviewEvaluation = null
      closed = true
      autoApplyActor = null
      commitGrant = null
      preview.dispose()
      renderedPreview.dispose()
      committedSketch.dispose()
      reviews.clearDraftViewport(reviewOwner)
      // An accepted persistence transaction must report its actual outcome after disconnect.
      if (!persisting) reviews.cancel(reviewOwner)
    },
  }
}
