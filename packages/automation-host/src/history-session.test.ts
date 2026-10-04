import { applyVersionedDocumentCommand, projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { commandIdSchema, documentIdSchema } from "@vibeshape/domain/identifiers"
import { describe, expect, it, vi } from "vitest"
import {
  createHistoryAutomationSession,
  HISTORY_REVIEW_TTL_MS,
  type HistoryCommitInput,
  type HistoryReviewInput,
} from "./history-session"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
const started = Date.parse("2026-10-04T00:00:00Z")
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.history",
  sessionId: id(9),
})
function success<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value))
  return value as Extract<T, { ok: true }>
}
function setup() {
  const envelope = {
    documentId: documentIdSchema.parse(id(1)),
    issuedAt: new Date(started).toISOString(),
    actor,
    schemaVersion: 1,
  }
  const authority = success(
    applyVersionedDocumentCommand(null, {
      ...envelope,
      commandId: id(2),
      baseRevision: 0,
      kind: "org.vibeshape.document.create",
      payload: { name: "Before" },
    }),
  ).snapshot
  const changed = success(
    applyVersionedDocumentCommand(authority, {
      ...envelope,
      commandId: id(3),
      baseRevision: 1,
      kind: "org.vibeshape.document.rename",
      payload: { name: "After" },
    }),
  ).snapshot
  let snapshot = success(projectDocumentSnapshotV1ToV0(changed)).snapshot
  let target = {
    targetRevision: authority.revision,
    authority,
    snapshot: success(projectDocumentSnapshotV1ToV0(authority)).snapshot,
  }
  let at = started
  let active = true
  const review = vi.fn(
    async (_input: HistoryReviewInput): Promise<"approved" | "rejected" | "cancelled"> =>
      "approved",
  )
  const preview = vi.fn(async () => ({
    valid: true,
    measurements: {
      schemaVersion: 1 as const,
      documentId: authority.id,
      revision: 1,
      generation: 1,
      features: [],
    },
  }))
  const hasCommandId = vi.fn(async () => false)
  const commit = vi.fn(async ({ review }: HistoryCommitInput) => ({
    ok: true,
    value: {
      documentId: authority.id,
      baseRevision: 2,
      revision: 3,
      commandId: review.request.commandId,
      direction: review.request.direction,
      targetRevision: 1,
    },
  }))
  const session = createHistoryAutomationSession({
    documentId: authority.id,
    isActive: () => active,
    readSnapshot: () => snapshot,
    availability: () => ({ canUndo: true, canRedo: false }),
    readTarget: () => target,
    hasCommandId,
    createId: () => id(10),
    now: () => at,
    preview,
    review,
    commit,
  })
  const operation = {
    tool: "undo_model",
    arguments: {
      documentId: documentIdSchema.parse(id(1)),
      baseRevision: 2,
      commandId: commandIdSchema.parse(id(11)),
    },
  }
  return {
    session,
    operation,
    preview,
    review,
    commit,
    hasCommandId,
    setTime: (time: number) => {
      at = time
    },
    deactivate: () => {
      active = false
    },
    stale: () => {
      snapshot = { ...snapshot, revision: 3 }
    },
    changeTarget: () => {
      target = { ...target, snapshot: { ...target.snapshot, name: "Different saved target" } }
    },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("owned history navigation", () => {
  it("reads only availability and proposes one exact actor-bound restore through manual consent", async () => {
    const f = setup()
    expect(
      await f.session.execute(actor, {
        tool: "model_history_state",
        arguments: { documentId: documentIdSchema.parse(id(1)), revision: 2 },
      }),
    ).toEqual({
      ok: true,
      value: {
        documentId: documentIdSchema.parse(id(1)),
        revision: 2,
        canUndo: true,
        canRedo: false,
      },
    })
    expect(f.preview).not.toHaveBeenCalled()
    const approval = deferred<"approved">()
    f.review.mockImplementation(() => approval.promise)
    const pending = f.session.execute(actor, f.operation)
    await vi.waitFor(() => expect(f.review).toHaveBeenCalledOnce())
    expect(f.commit).not.toHaveBeenCalled()
    const input = f.review.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      kind: "history",
      documentName: "Before",
      actor,
      draft: {
        documentId: documentIdSchema.parse(id(1)),
        baseRevision: 2,
        commandId: commandIdSchema.parse(id(11)),
        direction: "undo",
        targetRevision: 1,
      },
      request: {
        actor,
        direction: "undo",
        baseRevision: 2,
        commandId: commandIdSchema.parse(id(11)),
      },
    })
    expect(input?.draft.expiresAt).toBe(new Date(started + HISTORY_REVIEW_TTL_MS).toISOString())
    approval.resolve("approved")
    expect(await pending).toEqual({
      ok: true,
      value: {
        documentId: documentIdSchema.parse(id(1)),
        baseRevision: 2,
        revision: 3,
        commandId: commandIdSchema.parse(id(11)),
        direction: "undo",
        targetRevision: 1,
      },
    })
    expect(f.commit).toHaveBeenCalledOnce()
  })
  it.each(["rejected", "cancelled"] as const)(
    "does not navigate after %s consent",
    async (decision) => {
      const f = setup()
      f.review.mockResolvedValue(decision)
      expect(await f.session.execute(actor, f.operation)).toMatchObject({
        ok: false,
        diagnostic: {
          code: decision === "rejected" ? "draft-review-rejected" : "draft-review-cancelled",
        },
      })
      expect(f.commit).not.toHaveBeenCalled()
      expect(await f.session.execute(actor, f.operation)).toMatchObject({
        ok: false,
        diagnostic: { code: "duplicate-command-id" },
      })
    },
  )
  it.each(["expiry", "revision", "target", "session", "cancel", "dispose"] as const)(
    "rejects approval after %s changed",
    async (change) => {
      const f = setup()
      f.review.mockImplementation(async () => {
        if (change === "expiry") f.setTime(started + HISTORY_REVIEW_TTL_MS)
        if (change === "revision") f.stale()
        if (change === "target") f.changeTarget()
        if (change === "session") f.deactivate()
        if (change === "cancel") f.session.cancel()
        if (change === "dispose") f.session.dispose()
        return "approved"
      })
      expect(await f.session.execute(actor, f.operation)).toMatchObject({ ok: false })
      expect(f.commit).not.toHaveBeenCalled()
    },
  )
  it("rejects duplicate persisted IDs and a different actor without preview or commit", async () => {
    const f = setup()
    f.hasCommandId.mockResolvedValue(true)
    expect(await f.session.execute(actor, f.operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-command-id" },
    })
    expect(await f.session.execute({ ...actor, sessionId: id(30) }, f.operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-owner-mismatch" },
    })
    expect(f.preview).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
  })
  it("rechecks persisted command identity after approval", async () => {
    const f = setup()
    f.hasCommandId.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await f.session.execute(actor, f.operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-command-id" },
    })
    expect(f.commit).not.toHaveBeenCalled()
  })
  it("settles the actual save once publication entered even when cancelled or disposed", async () => {
    const f = setup()
    const publication = deferred<Awaited<ReturnType<typeof f.commit>>>()
    f.commit.mockImplementation(() => publication.promise)
    const pending = f.session.execute(actor, f.operation)
    await vi.waitFor(() => expect(f.session.isPersisting()).toBe(true))
    f.session.cancel()
    f.session.dispose()
    publication.resolve({
      ok: true,
      value: {
        documentId: documentIdSchema.parse(id(1)),
        baseRevision: 2,
        revision: 3,
        commandId: commandIdSchema.parse(id(11)),
        direction: "undo",
        targetRevision: 1,
      },
    })
    expect(await pending).toMatchObject({ ok: true })
    expect(f.commit).toHaveBeenCalledOnce()
  })
  it("rejects stale, raw, approved-flag and invalid actor requests", async () => {
    const f = setup()
    expect(
      await f.session.execute(actor, {
        ...f.operation,
        arguments: { ...f.operation.arguments, approved: true },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
    expect(await f.session.execute({ type: "user", userId: null }, f.operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-automation-actor" },
    })
    expect(
      await f.session.execute(actor, {
        ...f.operation,
        arguments: { ...f.operation.arguments, baseRevision: 1 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(f.commit).not.toHaveBeenCalled()
  })
  it("keeps one pending proposal and releases the lock after preview rejection", async () => {
    const f = setup()
    const evaluation = deferred<Awaited<ReturnType<typeof f.preview>>>()
    f.preview.mockImplementationOnce(() => evaluation.promise)
    const pending = f.session.execute(actor, f.operation)
    await vi.waitFor(() => expect(f.preview).toHaveBeenCalledOnce())
    expect(
      await f.session.execute(actor, {
        ...f.operation,
        arguments: { ...f.operation.arguments, commandId: id(12) },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "busy" } })
    evaluation.resolve({
      valid: true,
      measurements: {
        schemaVersion: 1,
        documentId: documentIdSchema.parse(id(1)),
        revision: 99,
        generation: 1,
        features: [],
      },
    })
    expect(await pending).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-preview-result" },
    })
    expect(
      await f.session.execute(actor, {
        ...f.operation,
        arguments: { ...f.operation.arguments, commandId: id(13) },
      }),
    ).toMatchObject({ ok: true })
  })
  it("rejects a well-shaped forged publication receipt", async () => {
    const f = setup()
    f.commit.mockImplementation(async ({ review }) => ({
      ok: true,
      value: {
        documentId: documentIdSchema.parse(id(1)),
        baseRevision: 2,
        revision: 3,
        commandId: review.request.commandId,
        direction: "redo",
        targetRevision: 1,
      },
    }))
    expect(await f.session.execute(actor, f.operation)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-commit-port-result" },
    })
  })
})
