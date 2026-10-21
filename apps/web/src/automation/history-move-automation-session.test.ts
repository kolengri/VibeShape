import { afterAll, afterEach, describe, expect, it, mock } from "bun:test"
import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { historyItemRefSchema } from "@vibeshape/domain/document-node"
import {
  type AuthoredDocumentSnapshot,
  documentSnapshotV2Schema,
} from "@vibeshape/domain/document-v2"
import type { MoveHistoryItemCommand } from "@vibeshape/domain/history-document-commands"
import { commandIdSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
} from "@vibeshape/domain/modules"
import { createEmptySketch } from "@vibeshape/domain/sketch-edit"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createAutomationReviewController } from "./automation-review-state"

const worker = { rebuild: vi.fn(), terminate: vi.fn() }
const originalWorker = { ...(await import("@vibeshape/document-worker/session")) }
mock.module("@vibeshape/document-worker/session", () => ({
  ...originalWorker,
  createDocumentWorkerSession: () => worker,
}))
const { createHistoryMoveAutomationSession, historyMoveReviewedInputMatches } = await import(
  "./history-move-automation-session"
)
afterAll(() => mock.module("@vibeshape/document-worker/session", () => originalWorker))
const sessions: ReturnType<typeof createHistoryMoveAutomationSession>[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.resetAllMocks()
})
const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.history",
  sessionId: id(9),
})
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function setup() {
  const reviews = createAutomationReviewController()
  let snapshot: AuthoredDocumentSnapshot = documentSnapshotV2Schema.parse({
    schemaVersion: 2,
    id: id(1),
    revision: 4,
    name: "History move",
    displayUnits: { length: "mm", angle: "deg" },
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
    variables: [],
    features: [],
    parts: [],
    sketches: [2, 3, 4].map((n) =>
      createEmptySketch({ id: sketchIdSchema.parse(id(n)), label: `Sketch ${n}`, plane: "xy" }),
    ),
    history: [2, 3, 4].map((n) => ({ kind: "sketch", id: id(n) })),
    folders: [
      {
        schemaVersion: 0,
        id: id(7),
        name: "Base sketches",
        items: [{ kind: "sketch", id: id(2) }],
      },
    ],
  })
  const registry = success(createModuleRegistry([documentCoreModule, featureCoreModule])).registry
  const queries = success(createQueryDispatcher(registry, documentCoreQueryHandlers)).dispatcher
  worker.rebuild.mockImplementation(async ({ document }) => ({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(50),
    documentId: document.id,
    revision: document.revision,
    generation: 1,
    type: "documentRebuilt",
    evaluation: { records: [], dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
    geometry: [],
    sketches: [],
    modelReferenceEvidence: [],
  }))
  const commit = vi.fn(
    async (
      command: MoveHistoryItemCommand,
      expected: AuthoredDocumentSnapshot,
    ): Promise<unknown> => {
      expect(historyMoveReviewedInputMatches(reviews.getSnapshot(), command, expected)).toBe(true)
      snapshot = expected
      return {
        documentId: command.documentId,
        commandId: command.commandId,
        baseRevision: command.baseRevision,
        revision: expected.revision,
        ...command.payload,
      }
    },
  )
  let active = true
  const session = createHistoryMoveAutomationSession(
    {
      documentId: snapshot.id,
      queries,
      createDraftId: () => id(11),
      isActive: () => active,
      readSnapshot: () => snapshot,
      hasCommandId: async () => false,
      commit,
    },
    reviews,
  )
  sessions.push(session)
  return {
    session,
    commit,
    reviews,
    deactivate: () => {
      active = false
    },
    replace: (next: AuthoredDocumentSnapshot) => {
      snapshot = next
    },
    snapshot: () => snapshot,
    request: {
      documentId: snapshot.id,
      baseRevision: 4,
      commandId: id(10),
      item: historyItemRefSchema.parse({ kind: "sketch", id: id(4) }),
      historyAfter: null,
    },
  }
}
async function reviewReady(reviews: ReturnType<typeof createAutomationReviewController>) {
  await vi.waitFor(() => expect(reviews.getSnapshot()?.status).toBe("ready"))
  const review = reviews.getSnapshot()
  if (!review || "kind" in review.input || !review.input.historyMove)
    throw new Error("Missing History move review")
  return { ...review, input: review.input, move: review.input.historyMove }
}

describe("browser semantic History move review", () => {
  it("uses the exact disposable preview and a visible manual grant before one save", async () => {
    const f = setup()
    const pending = f.session.change(actor, f.request)
    const review = await reviewReady(f.reviews)
    expect(f.commit).not.toHaveBeenCalled()
    expect(worker.rebuild).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(review.move.target.history[0]).toEqual(f.request.item)
    expect(review.move.target.folders).toEqual(f.snapshot().folders)
    expect(historyMoveReviewedInputMatches(review, review.move.command, review.move.target)).toBe(
      false,
    )
    await f.reviews.decide(review.id, "approved")
    expect(await pending).toMatchObject({ ok: true, value: { ...f.request, revision: 5 } })
    expect(f.commit).toHaveBeenCalledTimes(1)
    expect(f.reviews.getSnapshot()).toBeNull()
  })
  it.each(["reject", "abort", "cancel", "dispose", "deactivate", "stale"])(
    "does not save after %s",
    async (action) => {
      const f = setup()
      const controller = new AbortController()
      const pending = f.session.change(actor, f.request, controller.signal)
      const review = await reviewReady(f.reviews)
      if (action === "abort") controller.abort()
      if (action === "cancel") f.session.cancel()
      if (action === "dispose") f.session.dispose()
      if (action === "deactivate") f.deactivate()
      if (action === "stale") f.replace({ ...f.snapshot(), name: "Human rename" })
      await f.reviews.decide(review.id, action === "reject" ? "rejected" : "approved")
      expect(await pending).toMatchObject({ ok: false })
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.snapshot().revision).toBe(4)
    },
  )
  it("settles an accepted save when the browser session closes during persistence", async () => {
    const f = setup()
    let finish = (_result: unknown) => {}
    f.commit.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.session.change(actor, f.request)
    const review = await reviewReady(f.reviews)
    const applied = f.reviews.decide(review.id, "approved")
    await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(1))
    f.session.dispose()
    expect(f.reviews.getSnapshot()?.status).toBe("applying")
    finish({ ...f.request, revision: 5 })
    await applied
    expect(await pending).toMatchObject({ ok: true })
    expect(f.reviews.getSnapshot()).toBeNull()
  })
  it("rejects actor, command, target metadata and expiry substitutions in the controller grant", async () => {
    const f = setup()
    f.commit.mockImplementation(async (command, expected) => {
      const review = f.reviews.getSnapshot()
      expect(historyMoveReviewedInputMatches(review, command, expected)).toBe(true)
      expect(historyMoveReviewedInputMatches(null, command, expected)).toBe(false)
      expect(
        historyMoveReviewedInputMatches(
          review,
          { ...command, commandId: commandIdSchema.parse(id(99)) },
          expected,
        ),
      ).toBe(false)
      expect(
        historyMoveReviewedInputMatches(
          review,
          {
            ...command,
            actor: commandActorSchema.parse({
              type: "mcp",
              clientId: "org.other",
              sessionId: id(98),
            }),
          },
          expected,
        ),
      ).toBe(false)
      expect(
        historyMoveReviewedInputMatches(
          review,
          { ...command, payload: { ...command.payload, historyAfter: f.request.item } },
          expected,
        ),
      ).toBe(false)
      expect(
        historyMoveReviewedInputMatches(review, command, {
          ...expected,
          folders: expected.folders.map((folder) => ({ ...folder, name: "Hidden rename" })),
        }),
      ).toBe(false)
      if (!review || "kind" in review.input) throw new Error("Missing review")
      expect(
        historyMoveReviewedInputMatches(
          review,
          command,
          expected,
          Date.parse(review.input.preview.draft.expiresAt),
        ),
      ).toBe(false)
      expect(
        historyMoveReviewedInputMatches({ ...review, status: "error" }, command, expected),
      ).toBe(false)
      return { ...f.request, revision: 5 }
    })
    const pending = f.session.change(actor, f.request)
    const review = await reviewReady(f.reviews)
    await f.reviews.decide(review.id, "approved")
    expect(await pending).toMatchObject({ ok: true })
  })
})
