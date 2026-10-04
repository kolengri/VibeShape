// @vitest-environment jsdom
import {
  historyCommitViewSchema,
  historyStateViewSchema,
} from "@vibeshape/automation-api/history-tools"
import {
  localConnectResponseSchema,
  localPollRequestSchema,
  localPollResponseSchema,
  localWorkSchema,
} from "@vibeshape/automation-api/local-session"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import {
  type HistoryReviewInput,
  historyRequestSchema,
} from "@vibeshape/automation-host/history-session"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { modelMeasurementEvidenceSchema } from "@vibeshape/domain/model-measurements"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { automationReviews } from "./automation-review-controller"
import type { AutomationReviewState } from "./automation-review-state"
import { createLocalAutomationConnection } from "./local-automation-connection"

const mocks = vi.hoisted(() => ({ request: vi.fn(), createHandle: vi.fn(), execute: vi.fn() }))
vi.mock("./local-automation-http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./local-automation-http")>()),
  localAutomationRequest: mocks.request,
}))
vi.mock("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: mocks.createHandle,
}))
vi.mock("./local-tool-executor", () => ({
  createLocalToolExecutor: () => ({ execute: mocks.execute }),
}))

const id = (n: number) => `0195b5ac-b270-7a2c-8c33-${String(n).padStart(12, "0")}`
const documentId = id(1)
const baseRevision = 4
const credential = localConnectResponseSchema.parse({
  protocolVersion: 1,
  token: "A".repeat(43),
  actor: { type: "mcp", clientId: "org.example.history", sessionId: id(9) },
  expiresAt: Date.parse("2099-01-01T00:00:00Z"),
  client: { name: "History client", version: "1" },
})
const ok = (data: unknown) => ({ ok: true, status: 200, data })
const emptyPoll = localPollResponseSchema.parse({
  protocolVersion: 1,
  work: null,
  cancelledRequestIds: [],
})
let connection: ReturnType<typeof createLocalAutomationConnection>
let review: AutomationReviewState | null

function historyReview(direction: "undo" | "redo"): AutomationReviewState {
  const request = historyRequestSchema.parse({
    documentId,
    baseRevision,
    commandId: id(2),
    direction,
    actor: credential.actor,
    issuedAt: "2026-10-04T00:00:00Z",
  })
  const input: HistoryReviewInput = {
    kind: "history",
    actor: request.actor,
    documentName: "Reviewed history",
    draft: {
      draftId: draftIdSchema.parse(id(3)),
      documentId: request.documentId,
      baseRevision,
      commandId: request.commandId,
      direction,
      targetRevision: 2,
      expiresAt: "2099-01-01T00:00:00Z",
    },
    request,
    preview: {
      valid: true,
      measurements: modelMeasurementEvidenceSchema.parse({
        schemaVersion: 1,
        documentId,
        revision: 2,
        generation: 2,
        features: [],
      }),
    },
    featureCount: 0,
    partCount: 0,
  }
  return { id: "history-review", status: "ready", diagnostic: null, input }
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  vi.clearAllMocks()
  review = null
  vi.spyOn(automationReviews, "getSnapshot").mockImplementation(() => review)
  document.head.innerHTML = '<meta name="vibeshape-local-automation" content="1">'
  mocks.createHandle.mockReturnValue({
    ok: true,
    documentId,
    revision: baseRevision,
    dispose: vi.fn(),
    enableAutoApply: vi.fn(),
    readIdentity: () => ({ id: documentId, name: "Reviewed history", revision: baseRevision }),
    readInfo: () => ({
      summary: { documentId, revision: baseRevision, data: { name: "Reviewed history" } },
    }),
  })
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/status")
      return ok({ protocolVersion: 1, client: credential.client, paired: false })
    if (path === "/connect") return ok(credential)
    if (path === "/poll") return ok(emptyPoll)
    return ok({ ok: true })
  })
  connection = createLocalAutomationConnection()
})
afterEach(() => {
  connection.dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function startPending(operation: unknown) {
  const work = localWorkSchema.parse({
    requestId: id(4),
    operation: localOperationSchema.parse(operation),
  })
  let release: (value: unknown) => void = () => undefined
  mocks.execute.mockReturnValue(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  let delivered = false
  const request = mocks.request.getMockImplementation()
  mocks.request.mockImplementation(async (path: string, body: unknown, ...rest: unknown[]) => {
    if (path !== "/poll") return request?.(path, body, ...rest)
    localPollRequestSchema.parse(body)
    const value = { ...emptyPoll, work: delivered ? null : work }
    delivered = true
    return ok(localPollResponseSchema.parse(value))
  })
  connection.start()
  await connection.status()
  expect(await connection.enable()).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(work.operation, expect.any(AbortSignal))
  return { work, release }
}

async function currentProgress() {
  await vi.advanceTimersByTimeAsync(500)
  const poll = mocks.request.mock.calls.filter(([path]) => path === "/poll").at(-1)
  return localPollRequestSchema.parse(poll?.[1]).progress
}

describe("local history manual review progress", () => {
  it.each(["undo", "redo"] as const)(
    "reports pending %s through executing, review, applying and idle",
    async (direction) => {
      const { work, release } = await startPending({
        tool: `${direction}_model`,
        arguments: { documentId, baseRevision, commandId: id(2) },
      })
      expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "executing" })
      review = historyReview(direction)
      expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "review" })
      review = { ...review, status: "applying" }
      expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "applying" })
      release({
        ok: true,
        value: historyCommitViewSchema.parse({
          documentId,
          baseRevision,
          revision: baseRevision + 1,
          commandId: id(2),
          direction,
          targetRevision: 2,
        }),
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(await currentProgress()).toBeNull()
      expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: false })
    },
  )

  it("keeps history state reads executing while an unrelated review is ready or applying", async () => {
    const { work, release } = await startPending({
      tool: "model_history_state",
      arguments: { documentId, revision: baseRevision },
    })
    review = historyReview("undo")
    expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "executing" })
    review = { ...review, status: "applying" }
    expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "executing" })
    release({
      ok: true,
      value: historyStateViewSchema.parse({
        documentId,
        revision: baseRevision,
        canUndo: true,
        canRedo: true,
      }),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(await currentProgress()).toBeNull()
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: false })
  })
})
