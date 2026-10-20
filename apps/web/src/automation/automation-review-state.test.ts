import { afterEach, describe, expect, it } from "bun:test"
import { assemblyDraftStateSchema } from "@vibeshape/automation-api/assembly-tools"
import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import {
  commandActorSchema,
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  partIdSchema,
} from "@vibeshape/domain"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { AutomationDraftViewport } from "./automation-draft-viewport"
import { createAutomationReviewController } from "./automation-review-state"
import { createConnectedAssistantReviews } from "./connected-assistant-reviews"

function reviewInput(): DraftReviewInput {
  const documentId = "0195b5ac-b250-7a2c-8c33-000000000001"
  const timestamp = new Date().toISOString()
  return {
    actor: commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.reviewer",
      sessionId: "0195b5ac-b250-7a2c-8c33-000000000002",
    }),
    commands: [],
    preview: automationDraftPreviewSchema.parse({
      schemaVersion: 2,
      draft: {
        schemaVersion: 1,
        draftId: "0195b5ac-b250-7a2c-8c33-000000000003",
        documentId,
        baseRevision: 1,
        revision: 2,
        commandCount: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      summary: {
        kind: "org.vibeshape.document.summary",
        schemaVersion: 1,
        documentId,
        revision: 2,
        classification: "semantic",
        truncated: false,
        data: { name: "Reviewed model", createdAt: timestamp, updatedAt: timestamp },
      },
      geometry: {
        status: "valid",
        measurements: {
          kind: "org.vibeshape.model.measurements",
          schemaVersion: 1,
          documentId,
          revision: 2,
          generation: 1,
          classification: "derived",
          nextCursor: null,
          units: { length: "mm", area: "mm2", volume: "mm3" },
          data: { features: [], total: 0 },
        },
      },
    }),
  }
}

afterEach(() => vi.useRealTimers())

function draftViewport(input = reviewInput()): AutomationDraftViewport {
  const { draft, geometry } = input.preview
  return {
    draft,
    generation: geometry.measurements.generation,
    preview: {
      status: "ready",
      display: "result",
      assistantDraft: {
        documentId: draft.documentId,
        draftId: draft.draftId,
        baseRevision: draft.baseRevision,
      },
      meshes: [
        {
          featureId: "draft-body",
          appearance: "preview",
          previewMaterial: "model",
          positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          triangleFaceIds: new Uint32Array([1]),
        },
      ],
    },
  }
}

describe("automation draft display ownership", () => {
  it("defaults to Result and publishes display-only snapshots without copying draft geometry", () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const viewport = draftViewport()
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.presentDraftViewport(owner, viewport)
    expect(controller.getDraftViewportSnapshot()).toBe(viewport)
    expect(controller.setDraftViewportDisplay("old-draft", "changes")).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(controller.setDraftViewportDisplay(viewport.draft.draftId, "changes")).toBe(true)
    const changed = controller.getDraftViewportSnapshot()
    expect(changed?.preview.display).toBe("changes")
    expect(changed?.preview.meshes).toBe(viewport.preview.meshes)
    expect(changed?.draft).toBe(viewport.draft)
    expect(changed?.preview.meshes[0]?.appearance).toBe("preview")
    expect(controller.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(controller.setDraftViewportDisplay(viewport.draft.draftId, "changes")).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(controller.setDraftViewportDisplay(viewport.draft.draftId, "result")).toBe(true)
    expect(controller.getDraftViewportSnapshot()?.preview.display).toBe("result")
  })

  it("retains the chosen mode across incremental revisions of the same draft", () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const first = draftViewport()
    controller.presentDraftViewport(owner, first)
    controller.setDraftViewportDisplay(first.draft.draftId, "changes")
    const next = {
      ...first,
      draft: { ...first.draft, revision: first.draft.revision + 1 },
      generation: first.generation + 1,
      preview: { ...first.preview, meshes: [...first.preview.meshes] },
    }
    controller.presentDraftViewport(owner, next)
    const presented = controller.getDraftViewportSnapshot()
    expect(presented?.preview.display).toBe("changes")
    expect(presented?.generation).toBe(next.generation)
    expect(presented?.draft.revision).toBe(next.draft.revision)
    expect(presented?.preview.meshes).toBe(next.preview.meshes)
  })

  it.each(["draft", "project", "base revision", "owner"] as const)(
    "resets Result when the %s changes",
    (source) => {
      const controller = createAutomationReviewController()
      const owner = Symbol()
      const first = draftViewport()
      controller.presentDraftViewport(owner, first)
      controller.setDraftViewportDisplay(first.draft.draftId, "changes")
      const draft = {
        ...first.draft,
        ...(source === "draft"
          ? { draftId: draftIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000009") }
          : {}),
        ...(source === "project"
          ? { documentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000009") }
          : {}),
        ...(source === "base revision" ? { baseRevision: first.draft.baseRevision + 1 } : {}),
      }
      controller.presentDraftViewport(source === "owner" ? Symbol() : owner, {
        ...first,
        draft,
        preview: { ...first.preview, display: "changes", assistantDraft: draft },
      })
      expect(controller.getDraftViewportSnapshot()?.preview.display).toBe("result")
      controller.presentDraftViewport(owner, first)
      expect(controller.getDraftViewportSnapshot()?.preview.display).toBe("result")
    },
  )

  it("isolates controller instances and clears the mode with the owning draft", () => {
    const first = createAutomationReviewController()
    const second = createAutomationReviewController()
    const owner = Symbol()
    const viewport = draftViewport()
    first.presentDraftViewport(owner, viewport)
    second.presentDraftViewport(Symbol(), viewport)
    first.setDraftViewportDisplay(viewport.draft.draftId, "changes")
    expect(second.getDraftViewportSnapshot()?.preview.display).toBe("result")
    first.clearDraftViewport(Symbol())
    expect(first.getDraftViewportSnapshot()?.preview.display).toBe("changes")
    first.clearDraftViewport(owner)
    expect(first.getDraftViewportSnapshot()).toBeNull()
    expect(first.setDraftViewportDisplay(viewport.draft.draftId, "changes")).toBe(false)
    first.presentDraftViewport(owner, viewport)
    expect(first.getDraftViewportSnapshot()?.preview.display).toBe("result")
  })

  it("preserves the manual review decision and persistence lock while changing display", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const input = reviewInput()
    const viewport = draftViewport(input)
    controller.presentDraftViewport(owner, viewport)
    controller.setDraftViewportDisplay(viewport.draft.draftId, "changes")
    const decision = controller.request(owner, input, viewport)
    const original = controller.getSnapshot()
    if (!original) throw new Error("Expected pending manual review.")
    expect(controller.getDraftViewportSnapshot()).toBe(original.draftViewport ?? null)
    expect(controller.getDraftViewportSnapshot()?.preview.display).toBe("changes")
    let decided = false
    void decision.then(() => {
      decided = true
    })
    controller.setDraftViewportDisplay(viewport.draft.draftId, "result")
    await Promise.resolve()
    expect(decided).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({ id: original.id, status: "ready" })
    expect(controller.getSnapshot()?.input).toBe(original.input)
    const applied = controller.decide(original.id, "approved")
    await expect(decision).resolves.toBe("approved")
    controller.setDraftViewportDisplay(viewport.draft.draftId, "changes")
    expect(controller.getSnapshot()?.status).toBe("applying")
    await controller.decide(original.id, "rejected")
    expect(controller.getSnapshot()?.status).toBe("applying")
    controller.complete(owner, { ok: true, value: {} })
    await applied
    expect(controller.getDraftViewportSnapshot()).toBeNull()
    expect(controller.setDraftViewportDisplay(viewport.draft.draftId, "changes")).toBe(false)
  })

  it.each(["document", "draft", "base revision", "revision", "generation", "origin"] as const)(
    "refuses display writes when pending review has a mismatched %s fence",
    async (fence) => {
      const controller = createAutomationReviewController()
      const owner = Symbol()
      const input = reviewInput()
      const viewport = draftViewport(input)
      const mismatched: AutomationDraftViewport = {
        ...viewport,
        draft: {
          ...viewport.draft,
          ...(fence === "document"
            ? { documentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000009") }
            : {}),
          ...(fence === "draft"
            ? { draftId: draftIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000009") }
            : {}),
          ...(fence === "base revision" ? { baseRevision: viewport.draft.baseRevision + 1 } : {}),
          ...(fence === "revision" ? { revision: viewport.draft.revision + 1 } : {}),
        },
        generation: viewport.generation + (fence === "generation" ? 1 : 0),
        preview: {
          ...viewport.preview,
          assistantDraft: {
            ...viewport.preview.assistantDraft,
            ...(fence === "origin" ? { baseRevision: viewport.draft.baseRevision + 1 } : {}),
          },
        },
      }
      const decision = controller.request(owner, input, mismatched)
      expect(controller.getDraftViewportSnapshot()).toBeNull()
      expect(controller.setDraftViewportDisplay(viewport.draft.draftId, "changes")).toBe(false)
      expect(controller.getSnapshot()?.status).toBe("ready")
      controller.cancel(owner)
      await expect(decision).resolves.toBe("cancelled")
    },
  )

  it("does not manufacture preview geometry for a review without retained buffers", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const input = reviewInput()
    const decision = controller.request(owner, input)
    expect(controller.getDraftViewportSnapshot()).toBeNull()
    expect(controller.setDraftViewportDisplay(input.preview.draft.draftId, "changes")).toBe(false)
    expect(controller.getSnapshot()?.status).toBe("ready")
    controller.cancel(owner)
    await expect(decision).resolves.toBe("cancelled")
  })
})

describe("browser automation review ownership", () => {
  it("keeps Apply pending through persistence and accepts a decision only once", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const decision = controller.request(owner, reviewInput())
    const id = controller.getSnapshot()?.id ?? "missing"
    const applied = controller.decide(id, "approved")
    await expect(decision).resolves.toBe("approved")
    expect(controller.getSnapshot()?.status).toBe("applying")
    await controller.decide(id, "rejected")
    expect(controller.getSnapshot()?.status).toBe("applying")
    controller.complete(owner, { ok: true, value: {} })
    await applied
    expect(controller.getSnapshot()).toBeNull()
  })

  it("rejects a draft and ignores its old button when another review opens", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const rejected = controller.request(owner, reviewInput())
    const oldId = controller.getSnapshot()?.id ?? "missing"
    await controller.decide(oldId, "rejected")
    await expect(rejected).resolves.toBe("rejected")
    expect(controller.getSnapshot()).toBeNull()
    const next = controller.request(owner, reviewInput())
    await controller.decide(oldId, "approved")
    expect(controller.getSnapshot()?.status).toBe("ready")
    controller.cancel(owner)
    await expect(next).resolves.toBe("cancelled")
  })

  it("does not let another session replace or cancel the visible review", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const otherOwner = Symbol()
    const decision = controller.request(owner, reviewInput())
    const id = controller.getSnapshot()?.id
    await expect(controller.request(otherOwner, reviewInput())).resolves.toBe("cancelled")
    controller.cancel(otherOwner)
    expect(controller.getSnapshot()?.id).toBe(id)
    controller.cancel(owner, "stale-revision")
    await expect(decision).resolves.toBe("cancelled")
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      diagnostic: "stale-revision",
    })
    controller.complete(owner, { ok: true, value: {} })
    expect(controller.getSnapshot()?.status).toBe("error")
  })

  it("keeps CAD review available after the draft's idle expiry", async () => {
    vi.useFakeTimers()
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const decision = controller.request(owner, reviewInput())
    const id = controller.getSnapshot()?.id ?? "missing"
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(controller.getSnapshot()).toMatchObject({ status: "ready", diagnostic: null })
    const applied = controller.decide(id, "approved")
    await expect(decision).resolves.toBe("approved")
    controller.complete(owner, { ok: true, value: {} })
    await applied
    expect(controller.getSnapshot()).toBeNull()
  })

  it("retains an unconfirmed persistence failure until it is dismissed", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const decision = controller.request(owner, reviewInput())
    const id = controller.getSnapshot()?.id ?? "missing"
    const applied = controller.decide(id, "approved")
    await expect(decision).resolves.toBe("approved")
    controller.complete(owner, {
      ok: false,
      diagnostic: {
        code: "document-commit-failed",
        message: "Unconfirmed",
        retryable: false,
        issues: [],
      },
    })
    await applied
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      diagnostic: "document-commit-failed",
    })
    controller.dismiss(id)
    expect(controller.getSnapshot()).toBeNull()
  })

  it("can cancel CAD review after its idle expiry without approving it", async () => {
    vi.useFakeTimers()
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const decision = controller.request(owner, reviewInput())
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    controller.cancel(owner, "draft-review-cancelled")
    await expect(decision).resolves.toBe("cancelled")
    expect(controller.getSnapshot()).toMatchObject({ status: "error" })
  })

  it("still expires separate history proposals", async () => {
    vi.useFakeTimers()
    const controller = createAutomationReviewController()
    const cad = reviewInput()
    const request = {
      direction: "undo" as const,
      commandId: commandIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000004"),
      documentId: cad.preview.draft.documentId,
      baseRevision: 1,
      issuedAt: new Date().toISOString(),
      actor: cad.actor,
    }
    const decision = controller.request(Symbol(), {
      kind: "history",
      actor: cad.actor,
      documentName: "History target",
      draft: {
        ...request,
        draftId: cad.preview.draft.draftId,
        targetRevision: 0,
        expiresAt: cad.preview.draft.expiresAt,
      },
      request,
      preview: {
        valid: true,
        measurements: {
          schemaVersion: 1,
          documentId: cad.preview.draft.documentId,
          revision: 0,
          generation: 1,
          features: [],
        },
      },
      featureCount: 0,
      partCount: 0,
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(decision).resolves.toBe("cancelled")
    expect(controller.getSnapshot()).toMatchObject({ status: "error", diagnostic: "draft-expired" })
  })

  it("still expires separate metadata proposals", async () => {
    vi.useFakeTimers()
    const controller = createAutomationReviewController()
    const input = reviewInput()
    const decision = controller.request(Symbol(), {
      ...input,
      metadata: {
        change: {
          kind: "part.rename",
          partId: partIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000005"),
          name: "Cover",
        },
        targetName: "Part",
        range: null,
      },
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(decision).resolves.toBe("cancelled")
    expect(controller.getSnapshot()).toMatchObject({ status: "error", diagnostic: "draft-expired" })
  })

  it("detaches displayed intent from the calling port's objects", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const input = reviewInput()
    const decision = controller.request(owner, input)
    input.preview.summary.data.name = "Changed by caller"
    const displayed = controller.getSnapshot()?.input
    if (!displayed || "kind" in displayed) throw new Error("Expected the CAD review input.")
    expect(displayed.preview.summary.data.name).toBe("Reviewed model")
    controller.cancel(owner)
    await expect(decision).resolves.toBe("cancelled")
  })
})

describe("connected assistant model authority", () => {
  it("retains exact detached applying input without opening the visible review", async () => {
    const visible = createAutomationReviewController()
    const connected = createConnectedAssistantReviews(visible, () => true)
    const owner = Symbol()
    const input = reviewInput()
    await expect(connected.request(owner, input)).resolves.toBe("approved")
    expect(visible.getSnapshot()).toBeNull()
    expect(connected.getSnapshot()).toMatchObject({ status: "applying", input })
    expect(connected.getSnapshot()?.input).not.toBe(input)
    await expect(connected.request(Symbol(), reviewInput())).resolves.toBe("cancelled")
    connected.complete(Symbol(), { ok: true, value: {} })
    expect(connected.getSnapshot()?.status).toBe("applying")
    connected.complete(owner, { ok: true, value: {} })
    expect(connected.getSnapshot()).toBeNull()
  })

  it("rejects revoked authority and preserves an external pending review", async () => {
    const visible = createAutomationReviewController()
    const owner = Symbol()
    const pending = visible.request(owner, reviewInput())
    const connected = createConnectedAssistantReviews(visible, () => true)
    await expect(connected.request(Symbol(), reviewInput())).resolves.toBe("cancelled")
    expect(visible.getSnapshot()?.status).toBe("ready")
    connected.cancel(Symbol())
    expect(visible.getSnapshot()?.status).toBe("ready")
    visible.cancel(owner)
    await expect(pending).resolves.toBe("cancelled")
    const revoked = createConnectedAssistantReviews(visible, () => false)
    await expect(revoked.request(Symbol(), reviewInput())).resolves.toBe("cancelled")
    expect(revoked.getSnapshot()).toBe(visible.getSnapshot())
  })

  it("keeps expiry and failure ownership without retaining stale internal approvals", async () => {
    const visible = createAutomationReviewController()
    const connected = createConnectedAssistantReviews(visible, () => true)
    const expired: DraftReviewInput = {
      ...reviewInput(),
      metadata: {
        change: {
          kind: "part.rename",
          partId: partIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000005"),
          name: "Cover",
        },
        targetName: "Part",
        range: null,
      },
    }
    const owner = Symbol()
    vi.useFakeTimers()
    vi.advanceTimersByTime(61_000)
    await expect(connected.request(owner, expired)).resolves.toBe("cancelled")
    expect(connected.getSnapshot()).toBeNull()
    await expect(connected.request(owner, reviewInput())).resolves.toBe("approved")
    connected.complete(owner, {
      ok: false,
      diagnostic: { code: "stale-revision", message: "Changed", retryable: true },
    })
    expect(connected.getSnapshot()).toBeNull()
    await expect(connected.request(owner, reviewInput())).resolves.toBe("approved")
    connected.cancel(owner)
    expect(connected.getSnapshot()).toBeNull()
  })

  it("retains manual review for library publication outside the current model", async () => {
    const visible = createAutomationReviewController()
    const connected = createConnectedAssistantReviews(visible, () => true)
    const owner = Symbol()
    const source = reviewInput()
    const draft = assemblyDraftStateSchema.parse({
      schemaVersion: 1,
      draftId: source.preview.draft.draftId,
      documentId: source.preview.draft.documentId,
      baseRevision: 1,
      draftVersion: 0,
      changeCount: 0,
      expiresAt: source.preview.draft.expiresAt,
    })
    const pending = connected.request(owner, {
      kind: "library",
      actor: source.actor,
      documentName: "Model",
      draft,
      changes: [],
    })
    expect(visible.getSnapshot()?.status).toBe("ready")
    const id = visible.getSnapshot()?.id
    if (!id) throw new Error("Expected the library review.")
    await visible.decide(id, "rejected")
    await expect(pending).resolves.toBe("rejected")
  })
})
