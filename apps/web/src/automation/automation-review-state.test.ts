import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import { commandActorSchema } from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAutomationReviewController } from "./automation-review-state"

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

  it("expires an unattended review and rejects a late Apply", async () => {
    vi.useFakeTimers()
    const controller = createAutomationReviewController()
    const decision = controller.request(Symbol(), reviewInput())
    const id = controller.getSnapshot()?.id ?? "missing"
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(decision).resolves.toBe("cancelled")
    await controller.decide(id, "approved")
    expect(controller.getSnapshot()).toMatchObject({ status: "error", diagnostic: "draft-expired" })
    controller.dismiss(id)
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

  it("detaches displayed intent from the calling port's objects", async () => {
    const controller = createAutomationReviewController()
    const owner = Symbol()
    const input = reviewInput()
    const decision = controller.request(owner, input)
    input.preview.summary.data.name = "Changed by caller"
    expect(controller.getSnapshot()?.input.preview.summary.data.name).toBe("Reviewed model")
    controller.cancel(owner)
    await expect(decision).resolves.toBe("cancelled")
  })
})
