import { afterEach, describe, expect, it, mock } from "bun:test"
import type { QuickLightweightingResult } from "@vibeshape/structural-optimization/quick-contract"
import { vi } from "../../../../tests/unit/support/bun-test"

import type { LightweightingSource } from "../features/lightweighting/lightweighting-model"

import type { ImportReviewedCommit } from "./import-upload-session"

const mocks = (() => ({ optimize: vi.fn(), inspect: vi.fn(), terminate: vi.fn() }))()
const originalModule1 = { ...(await import("@vibeshape/structural-optimization/quick-client")) }
mock.module("@vibeshape/structural-optimization/quick-client", () => ({
  ...originalModule1,
  generateQuickLightweighting: mocks.optimize,
}))
mock.module("@vibeshape/document-worker/session", () => ({
  createDocumentWorkerSession: () => ({
    inspectMeshImport: mocks.inspect,
    terminate: mocks.terminate,
  }),
}))

const { quickLightweightingOperationSchema } = await import(
  "@vibeshape/automation-api/quick-lightweighting-tools"
)
const { commandActorSchema, commandActorsEqual } = await import("@vibeshape/domain/commands")
const { QuickLightweightingError } = await import("@vibeshape/structural-optimization/quick-client")
const { lightweightingId, lightweightingIdentity } = await import(
  "../../../../packages/automation-api/src/lightweighting.test-fixtures"
)
const {
  quickLightweightingOperation: lightweightingOperation,
  quickLightweightingSummary: lightweightingSummary,
} = await import("../../../../packages/automation-api/src/quick-lightweighting.test-fixtures")
const { meshInspection } = await import("../features/import/import-test-fixtures")
const { automationReviews } = await import("./automation-review-controller")
const { createBrowserQuickLightweightingAutomationSession } = await import(
  "./quick-lightweighting-automation-session"
)
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.lightweighting",
  sessionId: lightweightingId(9),
})
const mesh = {
  vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
}
const sessions: ReturnType<typeof createBrowserQuickLightweightingAutomationSession>[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  const review = automationReviews.getSnapshot()
  if (review) automationReviews.dismiss(review.id)
  vi.resetAllMocks()
  vi.useRealTimers()
})
function setup() {
  let sequence = 100
  const inspectedBody = meshInspection.outputs[0]
  if (!inspectedBody) throw new Error("Expected an inspection body fixture.")
  let source: LightweightingSource = {
    context: {
      documentId: lightweightingId(3),
      revision: 4,
      authorityVersion: 4,
      historyAfter: null,
    },
    ...lightweightingIdentity,
    partName: "Beam",
    body: {
      featureId: lightweightingIdentity.featureId,
      contentHash: lightweightingIdentity.contentHash,
      outputRole: "result",
      representation: "exact-solid",
      shape: { ...inspectedBody.shape, volume: 48, solidCount: 1 },
      mesh: inspectedBody.mesh,
      topologyCandidates: [],
    },
  }
  const result: QuickLightweightingResult = { ...lightweightingSummary(), mesh }
  mocks.optimize.mockResolvedValue(result)
  mocks.inspect.mockResolvedValue({ inspection: structuredClone(meshInspection) })
  const commit = vi.fn(async (input: ImportReviewedCommit) => ({
    ok: true as const,
    value: { revision: input.draft.baseRevision + input.transaction.commands.length },
  }))
  const session = createBrowserQuickLightweightingAutomationSession({
    documentId: source.context.documentId,
    isActive: () => true,
    readContext: () => source.context,
    readSource: () => source,
    createId: () => lightweightingId(sequence++),
    commit,
  })
  sessions.push(session)
  return {
    session,
    commit,
    stale() {
      source = { ...source, context: { ...source.context, revision: 5 } }
    },
    changeBody() {
      source = { ...source, contentHash: "b".repeat(64) }
    },
  }
}
async function reviewReady() {
  await vi.waitFor(() => expect(automationReviews.getSnapshot()?.status).toBe("ready"))
  const review = automationReviews.getSnapshot()
  if (!review) throw new Error("Expected a manual review.")
  return review
}
describe("browser lightweighting snapshot authority", () => {
  it.each([
    { code: "serialization-precision", message: "Move the source closer to the origin." },
    {
      code: "runtime-unavailable",
      message: "The numerical runtime failed during module loading: Failed to fetch pyodide.mjs",
    },
  ] as const)(
    "returns numerical failure causes without review or mutation: %s",
    async (diagnostic) => {
      const test = setup()
      mocks.optimize.mockRejectedValueOnce(
        new QuickLightweightingError(diagnostic.code, diagnostic.message),
      )
      expect(await test.session.execute(actor, lightweightingOperation(true))).toMatchObject({
        ok: false,
        diagnostic: { ...diagnostic, retryable: true },
      })
      expect(test.commit).not.toHaveBeenCalled()
      expect(automationReviews.getSnapshot()).toBeNull()
    },
  )
  it("captures an immutable STL and requires manual preview Apply before one atomic transaction", async () => {
    const test = setup()
    const pending = test.session.execute(actor, lightweightingOperation(true))
    const review = await reviewReady()
    expect(test.commit).not.toHaveBeenCalled()
    expect(review.input).toMatchObject({
      kind: "import",
      actor,
      quickLightweighting: { sourceName: "Beam", summary: { removedPercent: 100 / 3 } },
      source: { representation: "triangle-mesh", upload: { format: "stl" } },
    })
    await automationReviews.decide(review.id, "approved")
    expect(await pending).toMatchObject({
      ok: true,
      value: { snapshot: { baseRevision: 4, revision: 7 } },
    })
    expect(test.commit).toHaveBeenCalledTimes(1)
    const committed = test.commit.mock.calls[0]?.[0]
    expect(committed?.transaction.commands).toHaveLength(3)
    expect(committed?.transaction.commands).toContainEqual(
      expect.objectContaining({
        kind: "org.vibeshape.document.metadata-command",
        payload: {
          kind: "part.set-visibility",
          partId: lightweightingIdentity.partId,
          visible: false,
        },
      }),
    )
    expect(
      committed?.transaction.commands.every((command) => commandActorsEqual(command.actor, actor)),
    ).toBe(true)
    expect(committed?.assetBlobs).toHaveLength(1)
    expect(committed?.assetBlobs[0]?.bytes.byteLength).toBe(284)
    expect(committed?.transaction.commands.some((command) => command.kind.includes("remove"))).toBe(
      false,
    )
    expect(automationReviews.getSnapshot()).toBeNull()
  })
  it.each(["gyroid", "schwarz-p", "schwarz-d"] as const)(
    "captures %s and independent period in worker inputs and manual review",
    async (cellType) => {
      const test = setup()
      const summary = { ...lightweightingSummary(), cellType, latticeCellSizeMm: 9 }
      mocks.optimize.mockResolvedValueOnce({ ...summary, mesh })
      const base = lightweightingOperation(true)
      const operation = quickLightweightingOperationSchema.parse({
        ...base,
        arguments: {
          ...base.arguments,
          settings: { ...base.arguments.settings, cellType, latticeCellSizeMm: 9 },
        },
      })
      const pending = test.session.execute(actor, operation)
      const review = await reviewReady()
      expect(mocks.optimize.mock.calls[0]?.[0]).toMatchObject({
        cellType,
        latticeCellSizeMm: 9,
        cellSizeMm: 1,
      })
      expect(review.input).toMatchObject({
        quickLightweighting: {
          settings: { cellType, latticeCellSizeMm: 9 },
          summary: { cellType, latticeCellSizeMm: 9 },
        },
      })
      await automationReviews.decide(review.id, "rejected")
      expect(await pending).toMatchObject({
        ok: false,
        diagnostic: { code: "import-review-cancelled" },
      })
      expect(test.commit).not.toHaveBeenCalled()
    },
  )
  it("rejects browser refusal without persisting any candidate bytes", async () => {
    const test = setup()
    const pending = test.session.execute(actor, lightweightingOperation(true))
    const review = await reviewReady()
    await automationReviews.decide(review.id, "rejected")
    expect(await pending).toMatchObject({
      ok: false,
      diagnostic: { code: "import-review-cancelled" },
    })
    expect(test.commit).not.toHaveBeenCalled()
  })
  it.each(["stale", "changeBody", "cancel"] as const)(
    "prevents Apply after %s while browser review is pending",
    async (event) => {
      const test = setup()
      const controller = new AbortController()
      const pending = test.session.execute(actor, lightweightingOperation(true), controller.signal)
      const review = await reviewReady()
      if (event === "cancel") controller.abort()
      else test[event]()
      await automationReviews.decide(review.id, "approved")
      expect(await pending).toMatchObject({ ok: false })
      expect(test.commit).not.toHaveBeenCalled()
    },
  )
  it("aborts the shared computation worker before creating any snapshot", async () => {
    const test = setup()
    let workerSignal: AbortSignal | undefined
    mocks.optimize.mockImplementationOnce(
      (_input, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          workerSignal = options.signal
          workerSignal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled.", "AbortError")),
            { once: true },
          )
        }),
    )
    const controller = new AbortController()
    const pending = test.session.execute(actor, lightweightingOperation(true), controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "request-cancelled" } })
    expect(workerSignal?.aborted).toBe(true)
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(test.commit).not.toHaveBeenCalled()
  })
  it("expires manual review without committing captured STL bytes", async () => {
    vi.useFakeTimers()
    const test = setup()
    const pending = test.session.execute(actor, lightweightingOperation(true))
    await reviewReady()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)
    expect(await pending).toMatchObject({
      ok: false,
      diagnostic: { code: "import-review-cancelled" },
    })
    expect(test.commit).not.toHaveBeenCalled()
  })
  it("reports an accepted atomic persistence result after session disposal", async () => {
    const test = setup()
    let finish = (_result: { ok: true; value: { revision: number } }) => {}
    test.commit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = test.session.execute(actor, lightweightingOperation(true))
    const review = await reviewReady()
    const applied = automationReviews.decide(review.id, "approved")
    await vi.waitFor(() => expect(test.commit).toHaveBeenCalledTimes(1))
    test.session.dispose()
    finish({ ok: true, value: { revision: 6 } })
    await applied
    expect(await pending).toMatchObject({ ok: true, value: { snapshot: { revision: 6 } } })
    expect(test.commit).toHaveBeenCalledTimes(1)
  })
})
