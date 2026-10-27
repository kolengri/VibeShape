import { afterEach, describe, expect, it } from "bun:test"
import type {
  AssistantBridge,
  AssistantEvent,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type NumericalJobStatus,
  numericalJobStatusSchema,
} from "@vibeshape/automation-api/numerical-jobs"
import {
  lightweightingId as id,
  lightweightingIdentity,
  lightweightingSummary,
} from "../../../../packages/automation-api/src/lightweighting.test-fixtures"
import { quickLightweightingValue } from "../../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { vi } from "../../../../tests/unit/support/bun-test"
import { checkpointFixture } from "./assistant-checkpoints.test-fixture"
import { createNativeChatController } from "./native-chat-controller"
import { numericalCompletionPrompt } from "./native-numerical-jobs"

const projectId = id(3)
const activeJob = numericalJobStatusSchema.parse({
  jobId: id(100),
  tool: "analyze_quick_lightweighting",
  documentId: projectId,
  baseRevision: 4,
  status: "running",
  result: null,
})
const finishedJob = numericalJobStatusSchema.parse({
  ...activeJob,
  status: "completed",
  result: { ok: true, value: quickLightweightingValue() },
})
const controllers: ReturnType<typeof createNativeChatController>[] = []
afterEach(() => {
  for (const chat of controllers.splice(0)) chat.dispose()
  vi.useRealTimers()
})

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function fixture() {
  vi.useFakeTimers()
  let events: ((event: AssistantEvent) => void) | undefined
  const observers = new Set<() => void>()
  let jobs: readonly NumericalJobStatus[] = []
  let snapshot: AssistantSnapshot = {
    projectId,
    sessionToken: "native-session",
    sessionId: "provider-session",
    status: "ready",
    canResume: true,
    modes: [],
    models: [],
    configOptions: [],
    authMethods: [],
    currentModeId: null,
    currentModelId: null,
    attachmentCapabilities: { text: true, images: true },
  }
  const prompts: Parameters<AssistantBridge["prompt"]>[0][] = []
  const pending: (() => void)[] = []
  const response = async () => ({ ok: true as const, value: snapshot })
  function status(value: AssistantSnapshot["status"]) {
    snapshot = { ...snapshot, status: value }
    events?.({ type: "snapshot", projectId, sessionToken: snapshot.sessionToken, snapshot })
  }
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    connect: response,
    disconnect: async () => ({ ok: true, value: { ...snapshot, status: "disconnected" } }),
    async prompt(input) {
      prompts.push(input)
      status("prompting")
      await new Promise<void>((resolve) => pending.push(resolve))
      status("ready")
      return { ok: true, value: snapshot }
    },
    async cancel() {
      status("ready")
      pending.shift()?.()
      return response()
    },
    setMode: response,
    setModel: response,
    setConfigOption: response,
    authenticate: response,
    respondPermission: response,
    respondQuestion: response,
    onEvent(listener) {
      events = listener
      return () => {
        events = undefined
      }
    },
  }
  const model = checkpointFixture()
  const chat = createNativeChatController({
    projectId,
    bridge,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    checkpointHost: model.host,
    automation: {
      getSnapshot: () => ({ connected: true, recovering: false, error: false }),
      subscribe: () => () => {},
      retryRecovery: async () => true,
      ensureConnected: async () => true,
      getNumericalJobs: () => jobs,
      subscribeNumericalJobs(listener) {
        observers.add(listener)
        return () => {
          observers.delete(listener)
        }
      },
      cancelNumericalJobs: vi.fn(),
    },
  })
  controllers.push(chat)
  chat.start()
  return {
    chat,
    prompts,
    model,
    async connect() {
      await chat.connect({ command: "fixture-acp", args: [] })
      await chat.send("Analyze this part")
      await flush()
    },
    update(next: readonly NumericalJobStatus[]) {
      jobs = next
      for (const listener of observers) listener()
    },
    async finish() {
      pending.shift()?.()
      await flush()
    },
  }
}

describe("native numerical completion delivery", () => {
  it("delivers large final results completely as attachments or one completed-result retrieval", () => {
    const summary = lightweightingSummary()
    const originalCase = summary.baseline.cases[0]
    if (!originalCase) throw new Error("Missing load case fixture.")
    const cases = Array.from({ length: 200 }, (_, index) => ({
      ...originalCase,
      name: `Load ${index}`,
    }))
    const job = numericalJobStatusSchema.parse({
      ...finishedJob,
      tool: "analyze_lightweighting",
      result: {
        ok: true,
        value: {
          documentId: projectId,
          baseRevision: 4,
          source: lightweightingIdentity,
          summary: {
            ...summary,
            baseline: { ...summary.baseline, cases },
            optimized: { ...summary.optimized, cases },
          },
        },
      },
    })
    const attached = numericalCompletionPrompt(job, true)
    expect(attached.text.length).toBeLessThanOrEqual(32_768)
    expect(attached.attachments).toHaveLength(1)
    expect(attached.attachments[0]).toMatchObject({ type: "text", text: JSON.stringify(job) })
    const retrieval = numericalCompletionPrompt(job, false)
    expect(retrieval.attachments).toEqual([])
    expect(retrieval.text).toContain(`Retrieve completed job ${job.jobId} once`)
  })
  it("shows running work, waits without polling, then sends one automatic result continuation", async () => {
    const f = fixture()
    await f.connect()
    f.update([activeJob])
    await f.finish()
    expect(f.chat.getSnapshot().numericalJobs).toEqual([activeJob])
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(f.prompts).toHaveLength(1)
    expect(f.chat.getSnapshot().numericalJobs[0]?.status).toBe("running")
    f.update([finishedJob])
    await flush()
    expect(f.prompts).toHaveLength(2)
    expect(f.prompts[1]?.text).toContain(JSON.stringify(finishedJob))
    expect(f.prompts[1]?.text).toContain("Do not poll")
    f.update([finishedJob])
    await flush()
    expect(f.prompts).toHaveLength(2)
    expect(f.chat.getSnapshot().messages.filter(({ role }) => role === "user")).toHaveLength(1)
    await f.finish()
    expect(f.prompts).toHaveLength(2)
  })

  it("defers a fast completion until the original model turn returns", async () => {
    const f = fixture()
    await f.connect()
    f.update([activeJob])
    f.update([finishedJob])
    await flush()
    expect(f.prompts).toHaveLength(1)
    await f.finish()
    expect(f.prompts).toHaveLength(2)
  })

  it("keeps the initiating checkpoint open until background persistence finishes", async () => {
    const f = fixture()
    await f.connect()
    f.update([activeJob])
    await f.finish()
    f.model.save()
    f.update([finishedJob])
    await flush()
    await f.finish()
    expect(f.chat.getSnapshot().canUndoAgentChanges).toBe(true)
    expect(await f.chat.undoAgentChanges()).toBe(true)
    expect(f.model.restores).toEqual([{ baseline: 1, revision: 2 }])
  })

  it("delivers physical failure as data without silently retrying the calculation", async () => {
    const f = fixture()
    await f.connect()
    f.update([activeJob])
    await f.finish()
    const failed = numericalJobStatusSchema.parse({
      ...activeJob,
      status: "completed",
      result: localFailure("infeasible-baseline", "Displacement 2 mm exceeds 1 mm.", true),
    })
    f.update([failed])
    await flush()
    expect(f.prompts).toHaveLength(2)
    expect(f.prompts[1]?.text).toContain("infeasible-baseline")
    expect(f.prompts[1]?.text).toContain("Do not weaken")
  })

  it.each(["stop", "disconnect", "dispose", "connection-lost"] as const)(
    "does not resume a model after %s",
    async (end) => {
      const f = fixture()
      await f.connect()
      f.update([activeJob])
      await f.finish()
      if (end === "stop") await f.chat.cancel()
      else if (end === "disconnect") await f.chat.disconnect()
      else if (end === "dispose") f.chat.dispose()
      else f.update([])
      f.update([finishedJob])
      await flush()
      expect(f.prompts).toHaveLength(1)
    },
  )

  it("does not claim a job that predates its current model turn or belongs to another project", async () => {
    const f = fixture()
    f.update([activeJob])
    await f.connect()
    f.update([
      activeJob,
      numericalJobStatusSchema.parse({ ...activeJob, jobId: id(101), documentId: id(8) }),
    ])
    await f.finish()
    f.update([finishedJob])
    await flush()
    expect(f.chat.getSnapshot().numericalJobs).toEqual([])
    expect(f.prompts).toHaveLength(1)
  })
})
