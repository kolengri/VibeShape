import { afterEach, describe, expect, it } from "bun:test"
import type {
  AssistantBridge,
  AssistantErrorCode,
  AssistantEvent,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import {
  type NumericalJobStatus,
  numericalJobStatusSchema,
} from "@vibeshape/automation-api/numerical-jobs"
import { vi } from "../../../../tests/unit/support/bun-test"
import { checkpointFixture } from "./assistant-checkpoints.test-fixture"
import { createNativeChatController } from "./native-chat-controller"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const agent = { command: "/fixture/acp", args: ["--fixture"] }
const controllers: ReturnType<typeof createNativeChatController>[] = []
afterEach(() => {
  for (const chat of controllers.splice(0)) chat.dispose()
  vi.useRealTimers()
})

function fixture(resumable = true) {
  vi.useFakeTimers()
  let listener: ((event: AssistantEvent) => void) | undefined
  let snapshot: AssistantSnapshot
  let failure: AssistantErrorCode | undefined
  let resumeFailure: AssistantErrorCode | undefined
  let gate: Promise<void> | undefined
  let authenticationRequired = false
  let sequence = 0
  const connections: Parameters<AssistantBridge["connect"]>[0][] = []
  const prompts: Parameters<AssistantBridge["prompt"]>[0][] = []
  const pending: (() => void)[] = []
  const disconnected: string[] = []
  const storage = new Map<string, string>()
  function emit(event: AssistantEvent) {
    listener?.(event)
  }
  function publish(status: AssistantSnapshot["status"]) {
    snapshot = { ...snapshot, status }
    emit({ projectId, sessionToken: snapshot.sessionToken, type: "snapshot", snapshot })
  }
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    async connect(input) {
      connections.push(input)
      await gate
      if (input.resumeSessionId && resumeFailure) {
        snapshot = {
          ...snapshot,
          sessionToken: `connection-${++sequence}`,
          sessionId: null,
          status: "connecting",
        }
        publish("connecting")
        emit({ projectId, sessionToken: snapshot.sessionToken, type: "error", code: resumeFailure })
        publish("error")
        return { ok: false, code: resumeFailure }
      }
      if (failure) return { ok: false, code: failure }
      snapshot = {
        projectId,
        sessionToken: `connection-${++sequence}`,
        sessionId: input.resumeSessionId ?? "provider-session",
        canResume: resumable,
        status: authenticationRequired ? "authentication-required" : "ready",
        modes: [],
        models: [],
        configOptions: [],
        currentModeId: null,
        currentModelId: null,
        attachmentCapabilities: { text: true, images: true },
        authMethods: [],
      }
      return { ok: true, value: snapshot }
    },
    async disconnect(input) {
      disconnected.push(input.sessionToken)
      return { ok: true, value: { ...snapshot, status: "disconnected" } }
    },
    async prompt(input) {
      prompts.push(input)
      publish("prompting")
      const captured = snapshot
      await new Promise<void>((resolve) =>
        pending.push(() => {
          if (snapshot.sessionToken === captured.sessionToken) publish("ready")
          resolve()
        }),
      )
      return { ok: true, value: { ...captured, status: "ready" } }
    },
    async cancel() {
      publish("ready")
      return { ok: true, value: snapshot }
    },
    setMode: async () => ({ ok: true, value: snapshot }),
    setModel: async () => ({ ok: true, value: snapshot }),
    setConfigOption: async () => ({ ok: true, value: snapshot }),
    authenticate: async () => {
      authenticationRequired = false
      snapshot = { ...snapshot, status: "ready" }
      return { ok: true, value: snapshot }
    },
    respondPermission: async () => ({ ok: true, value: snapshot }),
    respondQuestion: async () => ({ ok: true, value: snapshot }),
    onEvent(callback) {
      listener = callback
      return () => {
        listener = undefined
      }
    },
  }
  const model = checkpointFixture()
  const automationListeners = new Set<() => void>()
  const jobListeners = new Set<() => void>()
  let jobs: readonly NumericalJobStatus[] = []
  let automationState = {
    connected: true,
    recovering: false,
    error: false,
    recoveryFailed: false,
    recoveryBlocked: false,
    recoveryAttempt: 0,
  }
  const automation = {
    getNumericalJobs: () => jobs,
    subscribeNumericalJobs(callback: () => void) {
      jobListeners.add(callback)
      return () => {
        jobListeners.delete(callback)
      }
    },
    cancelNumericalJobs: vi.fn(),
    getSnapshot: () => automationState,
    subscribe(callback: () => void) {
      automationListeners.add(callback)
      return () => {
        automationListeners.delete(callback)
      }
    },
    retryRecovery: vi.fn(async () => {
      automationState = { ...automationState, recovering: true, recoveryFailed: false }
      for (const notify of automationListeners) notify()
      return true
    }),
    ensureConnected: vi.fn(
      ({ signal }: { automatic: boolean; signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          const check = () => {
            if (
              signal.aborted ||
              automationState.recoveryBlocked ||
              automationState.recoveryFailed ||
              automationState.connected
            ) {
              automationListeners.delete(check)
              signal.removeEventListener("abort", check)
              resolve(
                !signal.aborted && automationState.connected && !automationState.recoveryBlocked,
              )
            }
          }
          automationListeners.add(check)
          signal.addEventListener("abort", check, { once: true })
          check()
        }),
    ),
  }
  const chat = createNativeChatController({
    projectId,
    bridge,
    checkpointHost: model.host,
    automation,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value)
      },
      removeItem: (key) => {
        storage.delete(key)
      },
    },
  })
  controllers.push(chat)
  chat.start()
  return {
    chat,
    bridge,
    model,
    connections,
    prompts,
    disconnected,
    retryModel: automation.retryRecovery,
    cancelNumericalJobs: automation.cancelNumericalJobs,
    ensureModel: automation.ensureConnected,
    jobs(value: readonly NumericalJobStatus[]) {
      jobs = value
      for (const listener of jobListeners) listener()
    },
    fail(code?: AssistantErrorCode) {
      failure = code
    },
    failResume(code: AssistantErrorCode) {
      resumeFailure = code
    },
    requireAuthentication() {
      authenticationRequired = true
    },
    gate(value: Promise<void> | undefined) {
      gate = value
    },
    crash() {
      emit({ projectId, sessionToken: snapshot.sessionToken, type: "error", code: "agent-exited" })
    },
    disconnectEvent() {
      publish("disconnected")
    },
    staleText(sessionToken: string) {
      emit({ projectId, sessionToken, type: "text", text: "obsolete" })
    },
    finish(index: number) {
      pending[index]?.()
    },
    automate(value: Partial<typeof automationState>) {
      automationState = { ...automationState, ...value }
      for (const notify of automationListeners) notify()
    },
  }
}

describe("internal native connection recovery", () => {
  it("recovers an interrupted turn with a running job and ignores its old-session completion", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Analyze the part")
    const job = numericalJobStatusSchema.parse({
      jobId: "0195b5ac-b250-7a2c-8c33-000000000111",
      documentId: projectId,
      baseRevision: 1,
      tool: "analyze_lightweighting",
      status: "running",
      result: null,
    })
    f.jobs([job])
    expect(f.chat.getSnapshot().numericalJobs).toHaveLength(1)
    f.crash()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.connections).toHaveLength(2)
    expect(f.prompts).toHaveLength(2)
    expect(f.chat.getSnapshot().recovery).toBeNull()
    expect(f.chat.getSnapshot().error).toBeNull()
    f.jobs([
      numericalJobStatusSchema.parse({
        ...job,
        status: "completed",
        result: {
          ok: false,
          diagnostic: { code: "session-revoked", message: "Old session ended.", retryable: false },
        },
      }),
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(f.chat.getSnapshot().numericalJobs).toEqual([])
    expect(f.prompts).toHaveLength(2)
  })
  it("replaces a definitively missing session only on explicit Connect and preserves the transcript", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    f.staleText("connection-1")
    const messages = f.chat.getSnapshot().messages
    await f.chat.disconnect()
    f.failResume("session-unavailable")
    expect(await f.chat.connect(agent)).toBe(true)
    expect(f.connections.slice(1)).toEqual([
      { projectId, agent, resumeSessionId: "provider-session" },
      { projectId, agent },
    ])
    expect(f.chat.getSnapshot()).toMatchObject({
      projectAccessReady: true,
      recovery: null,
      error: null,
      messages,
    })
    expect(f.prompts).toHaveLength(0)
    expect(f.ensureModel).toHaveBeenCalledTimes(3)
  })

  it.each(["initialization-failed", "authentication-required"] as const)(
    "does not replace saved context after %s",
    async (code) => {
      const f = fixture()
      await f.chat.connect(agent)
      await f.chat.disconnect()
      f.failResume(code)
      expect(await f.chat.connect(agent)).toBe(false)
      expect(f.connections).toHaveLength(2)
      expect(f.connections[1]?.resumeSessionId).toBe("provider-session")
      expect(f.prompts).toHaveLength(0)
    },
  )

  it("stops automatic startup on missing context without replacing it or replaying a prompt", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.disconnect()
    f.failResume("session-unavailable")
    expect(await f.chat.connect(agent, undefined, { automatic: true })).toBe(false)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(f.connections).toHaveLength(2)
    expect(f.connections[1]?.resumeSessionId).toBe("provider-session")
    expect(f.chat.getSnapshot()).toMatchObject({
      error: "session-unavailable",
      recovery: { status: "failed" },
    })
    expect(f.prompts).toHaveLength(0)
  })

  it("keeps ACP readiness pending through slow initial project pairing and publishes access changes", async () => {
    const f = fixture()
    f.automate({ connected: false })
    const connection = f.chat.connect(agent)
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.chat.getSnapshot()).toMatchObject({ connecting: true, projectAccessReady: false })
    expect(await f.chat.send("Inspect this project")).toBe(false)
    expect(f.prompts).toHaveLength(0)
    f.automate({ connected: true })
    expect(await connection).toBe(true)
    expect(f.ensureModel).toHaveBeenCalledWith({
      automatic: false,
      signal: expect.any(AbortSignal),
    })
    expect(f.chat.getSnapshot()).toMatchObject({ connecting: false, projectAccessReady: true })
    f.automate({ connected: false })
    expect(f.chat.getSnapshot().projectAccessReady).toBe(false)
    expect(await f.chat.send("Inspect while unpaired")).toBe(false)
    f.automate({ connected: true })
    expect(await f.chat.send("Inspect after pairing")).toBe(true)
    expect(f.prompts).toHaveLength(1)
  })

  it.each(["crash", "disconnectEvent"] as const)(
    "recovers from %s after ACP readiness while initial model pairing is pending",
    async (event) => {
      const f = fixture()
      f.automate({ connected: false })
      const connecting = f.chat.connect(agent)
      await vi.advanceTimersByTimeAsync(0)
      expect(f.chat.getSnapshot()).toMatchObject({
        connecting: true,
        snapshot: { status: "ready" },
        projectAccessReady: false,
      })
      f[event]()
      f.automate({ connected: true })
      expect(await connecting).toBe(false)
      expect(f.chat.getSnapshot()).toMatchObject({
        recovery: { status: "retrying" },
        projectAccessReady: false,
      })
      expect(f.connections).toHaveLength(1)
      expect(f.prompts).toHaveLength(0)
    },
  )

  it.each(["cancel", "disconnect", "dispose"] as const)(
    "does not complete or dispatch a pending initial pairing after %s",
    async (action) => {
      const f = fixture()
      f.automate({ connected: false })
      const connection = f.chat.connect(agent)
      await vi.advanceTimersByTimeAsync(0)
      await f.chat[action]()
      f.automate({ connected: true })
      expect(await connection).toBe(false)
      expect(f.chat.getSnapshot().snapshot).toBeNull()
      expect(f.prompts).toHaveLength(0)
    },
  )

  it("keeps stopped startup metadata available for explicit Enable AI without granting project access", async () => {
    const f = fixture()
    f.automate({ connected: false, recoveryBlocked: true })
    let release = () => {}
    f.gate(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const connection = f.chat.connect(agent, undefined, { automatic: true })
    await vi.advanceTimersByTimeAsync(0)
    f.automate({ recoveryBlocked: true })
    release()
    expect(await connection).toBe(false)
    expect(f.connections).toHaveLength(1)
    expect(f.ensureModel).not.toHaveBeenCalled()
    expect(f.chat.getSnapshot()).toMatchObject({
      snapshot: { status: "ready" },
      connecting: false,
      projectAccessReady: false,
    })
    expect(await f.chat.send("Inspect while stopped")).toBe(false)
    f.automate({ connected: true, recoveryBlocked: false })
    expect(f.chat.getSnapshot().projectAccessReady).toBe(true)
    expect(await f.chat.send("Inspect after Enable AI")).toBe(true)
    expect(f.connections).toHaveLength(1)
    expect(f.prompts).toHaveLength(1)
  })

  it.each(["during", "after"] as const)(
    "restores ACP recovery after explicitly enabling a stopped session %s startup",
    async (timing) => {
      const f = fixture()
      f.automate({ connected: false, recoveryBlocked: true })
      let release = () => {}
      if (timing === "during")
        f.gate(
          new Promise<void>((resolve) => {
            release = resolve
          }),
        )
      const connection = f.chat.connect(agent, undefined, { automatic: true })
      await vi.advanceTimersByTimeAsync(0)
      if (timing === "after") expect(await connection).toBe(false)
      f.automate({ recoveryBlocked: false })
      expect(f.chat.getSnapshot().projectAccessReady).toBe(false)
      expect(await f.chat.send("Inspect before pairing")).toBe(false)
      f.automate({ connected: true })
      release()
      expect(await connection).toBe(timing === "during")
      f.crash()
      expect(f.chat.getSnapshot().recovery?.status).toBe("retrying")
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.connections).toHaveLength(2)
      expect(f.chat.getSnapshot()).toMatchObject({
        snapshot: { status: "ready", sessionToken: "connection-2" },
        recovery: null,
        projectAccessReady: true,
      })
      expect(f.prompts).toHaveLength(0)
      f.automate({ connected: false, recoveryBlocked: true })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(f.connections).toHaveLength(2)
      expect(f.chat.getSnapshot().snapshot).toBeNull()
    },
  )

  it("honors a new Stop AI while ACP is still starting after explicit Connect", async () => {
    const f = fixture()
    f.automate({ connected: false })
    let release = () => {}
    f.gate(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const connection = f.chat.connect(agent)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.ensureModel).toHaveBeenCalledWith({
      automatic: false,
      signal: expect.any(AbortSignal),
    })
    f.automate({ recoveryBlocked: true })
    release()
    expect(await connection).toBe(false)
    expect(f.chat.getSnapshot().snapshot).toBeNull()
    expect(f.prompts).toHaveLength(0)
  })

  it("waits for a fresh grant on an idle reconnect even when automation is not recovering", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    f.automate({ connected: false })
    f.crash()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.chat.getSnapshot().recovery?.status).toBe("retrying")
    expect(await f.chat.send("Inspect before replacement pairing")).toBe(false)
    f.automate({ connected: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.chat.getSnapshot().recovery).toBeNull()
    expect(f.ensureModel).toHaveBeenLastCalledWith({
      automatic: true,
      signal: expect.any(AbortSignal),
    })
    expect(f.prompts).toHaveLength(0)
  })

  it.each(["transient exhaustion", "permanent client change"] as const)(
    "handles %s after a slow ACP resume",
    async (failure) => {
      const f = fixture()
      await f.chat.connect(agent)
      await f.chat.send("Do work")
      let release = () => {}
      f.gate(
        new Promise<void>((resolve) => {
          release = resolve
        }),
      )
      f.automate({ connected: false, recovering: true, recoveryAttempt: 1 })
      await vi.advanceTimersByTimeAsync(5000)
      f.automate({ recovering: false, recoveryFailed: true, recoveryAttempt: 5, error: true })
      expect(f.chat.getSnapshot().recovery?.status).toBe("retrying")
      if (failure === "permanent client change") f.retryModel.mockResolvedValue(false)
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(f.retryModel).toHaveBeenCalledTimes(1)
      expect(f.retryModel).toHaveBeenCalledWith({ automatic: true })
      expect(f.prompts).toHaveLength(1)
      if (failure === "permanent client change") {
        await vi.advanceTimersByTimeAsync(60_000)
        expect(f.chat.getSnapshot().recovery?.status).toBe("failed")
        expect(f.connections).toHaveLength(2)
        return
      }
      f.automate({ connected: true, recovering: false, recoveryFailed: false, error: false })
      await vi.advanceTimersByTimeAsync(0)
      expect(f.chat.getSnapshot().recovery).toBeNull()
      expect(f.prompts).toHaveLength(2)
      expect(f.connections).toHaveLength(2)
      expect(f.disconnected).not.toContain("connection-2")
    },
  )
  it("bounds an initial configured transport failure", async () => {
    const f = fixture()
    f.fail("launch-failed")
    await f.chat.connect(agent)
    await vi.advanceTimersByTimeAsync(135_000)
    expect(f.connections).toHaveLength(6)
    expect(f.chat.getSnapshot()).toMatchObject({
      configured: true,
      recovery: { attempt: 5, status: "failed" },
    })
  })

  it("continues safely unsent queued work after the recovered turn, without restoring the already sent original", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Original")
    await f.chat.enqueue("Unsent next")
    f.crash()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.prompts).toHaveLength(2)
    f.finish(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(
      f.prompts.map((prompt) => prompt.text).filter((text) => text === "Original"),
    ).toHaveLength(1)
    expect(f.prompts.at(-1)?.text).toBe("Unsent next")
    expect(f.chat.getSnapshot().queuedMessages).toHaveLength(0)
  })
  it("loads the exact session and continues once after authoritative accepted writes settle, without replaying the original prompt", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Create exactly one bracket")
    const token = f.chat.getSnapshot().snapshot?.sessionToken ?? ""
    const save = f.model.deferSave()
    f.crash()
    f.crash()
    expect(f.chat.getSnapshot()).toMatchObject({
      busy: true,
      configured: true,
      recovery: { attempt: 1, status: "retrying" },
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.connections).toHaveLength(2)
    expect(f.connections[1]).toEqual({ projectId, agent, resumeSessionId: "provider-session" })
    expect(f.prompts).toHaveLength(1)
    save()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.prompts).toHaveLength(2)
    expect(f.prompts[1]?.text).toContain("First read model_info")
    expect(f.prompts[1]?.text).not.toContain("Create exactly one bracket")
    expect(f.chat.getSnapshot().messages.filter((m) => m.role === "user")).toHaveLength(1)
    f.staleText(token)
    f.finish(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.chat.getSnapshot().busy).toBe(true)
    expect(f.chat.getSnapshot().messages.some((m) => m.text === "obsolete")).toBe(false)
    f.finish(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.chat.getSnapshot()).toMatchObject({
      busy: false,
      recovery: null,
      canUndoAgentChanges: true,
    })
  })

  it("makes exactly five automatic attempts with bounded backoff, latches failure, and permits one manual restart", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    f.fail("agent-exited")
    f.disconnectEvent()
    for (const [index, delay] of [5000, 10_000, 20_000, 40_000, 60_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(f.connections).toHaveLength(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(f.connections).toHaveLength(index + 2)
    }
    expect(f.chat.getSnapshot()).toMatchObject({
      busy: false,
      recovery: { attempt: 5, status: "failed" },
    })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(f.connections).toHaveLength(6)
    f.fail()
    expect(await f.chat.retryRecovery()).toBe(true)
    expect(await f.chat.retryRecovery()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.chat.getSnapshot().recovery).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    f.disconnectEvent()
    expect(f.chat.getSnapshot().recovery?.attempt).toBe(1)
  })

  it("keeps the same five-attempt episode across idle connection flapping until a healthy idle window", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    for (const delay of [5000, 10_000, 20_000, 40_000, 60_000]) {
      f.crash()
      await vi.advanceTimersByTimeAsync(delay)
      expect(f.chat.getSnapshot().recovery).toBeNull()
    }
    f.crash()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.connections).toHaveLength(6)
    expect(f.chat.getSnapshot().recovery).toEqual({ status: "failed", attempt: 5 })
  })

  it.each(["cancel", "disconnect", "dispose"] as const)(
    "keeps %s authoritative over a late successful reconnect",
    async (action) => {
      const f = fixture()
      await f.chat.connect(agent)
      await f.chat.send("Do work")
      let release = () => {}
      f.gate(
        new Promise<void>((resolve) => {
          release = resolve
        }),
      )
      f.crash()
      await vi.advanceTimersByTimeAsync(5000)
      await f.chat[action]()
      release()
      await vi.advanceTimersByTimeAsync(90_000)
      expect(f.connections).toHaveLength(2)
      expect(f.prompts).toHaveLength(1)
      expect(f.disconnected).toContain("connection-2")
      expect(f.chat.getSnapshot()).toMatchObject({ busy: false, recovery: null, snapshot: null })
    },
  )

  it("stops deterministically for unsupported resume and permanent policy failures", async () => {
    const f = fixture(false)
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    f.crash()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(f.connections).toHaveLength(1)
    expect(f.chat.getSnapshot()).toMatchObject({
      error: "unsupported",
      recovery: { attempt: 0, status: "failed" },
    })
    const g = fixture()
    await g.chat.connect(agent)
    g.fail("settings-recovery-failed")
    g.crash()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(g.connections).toHaveLength(2)
    expect(g.chat.getSnapshot().error).toBe("settings-recovery-failed")
  })

  it("pauses for permanent authentication and resumes the same interrupted session once after explicit authentication", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    f.requireAuthentication()
    f.crash()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.chat.getSnapshot()).toMatchObject({
      error: "authentication-required",
      busy: false,
      recovery: { status: "failed" },
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.connections).toHaveLength(2)
    await f.chat.authenticate("login")
    expect(f.prompts).toHaveLength(2)
    expect(f.chat.getSnapshot()).toMatchObject({ busy: true, error: null, recovery: null })
  })

  it("honors native Stop AI while waiting for the existing automation grant", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    f.automate({ connected: false, recovering: true })
    await vi.advanceTimersByTimeAsync(5000)
    f.automate({ recovering: false, recoveryBlocked: true })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.connections).toHaveLength(2)
    expect(f.prompts).toHaveLength(1)
    expect(f.chat.getSnapshot()).toMatchObject({ busy: false, snapshot: null, recovery: null })
  })

  it("uses the remaining retry budget if the replacement ACP process exits while automation is still recovering", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    f.automate({ connected: false, recovering: true })
    await vi.advanceTimersByTimeAsync(5000)
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.chat.getSnapshot().recovery).toMatchObject({ attempt: 2, status: "retrying" })
    f.automate({ connected: true, recovering: false })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(f.connections).toHaveLength(3)
    expect(f.prompts).toHaveLength(2)
    expect(f.chat.getSnapshot().recovery).toBeNull()
  })

  it("keeps Stop effective if a late transport error follows cancellation of the original turn", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    await f.chat.cancel()
    expect(f.cancelNumericalJobs).toHaveBeenCalledTimes(1)
    f.automate({ connected: true })
    f.crash()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.connections).toHaveLength(1)
    expect(f.chat.getSnapshot().recovery).toBeNull()
  })

  it("waits for recovery of the existing automation grant before continuing and honors its exhausted state", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    f.automate({ connected: false, recovering: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.prompts).toHaveLength(1)
    f.automate({ connected: true, recovering: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.prompts).toHaveLength(2)
    f.automate({ connected: false, recovering: true })
    await vi.advanceTimersByTimeAsync(10_000)
    f.automate({ recovering: false, recoveryFailed: true, error: true, recoveryAttempt: 5 })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(f.prompts).toHaveLength(2)
    expect(f.chat.getSnapshot().recovery?.status).toBe("failed")
    expect(f.chat.getSnapshot().recovery?.automation).toEqual({ attempt: 5, failed: true })
  })

  it("lets the automation owner exhaust its own bounded attempts instead of exposing manual retry on an unrelated wait deadline", async () => {
    const f = fixture()
    await f.chat.connect(agent)
    await f.chat.send("Do work")
    f.automate({ connected: false, recovering: true, recoveryAttempt: 3 })
    await vi.advanceTimersByTimeAsync(40_000)
    expect(f.chat.getSnapshot()).toMatchObject({
      busy: true,
      recovery: { status: "retrying", automation: { attempt: 3 } },
    })
    expect(f.connections).toHaveLength(2)
    f.automate({ recovering: false, recoveryFailed: true, recoveryAttempt: 5, error: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.chat.getSnapshot()).toMatchObject({
      busy: false,
      recovery: { status: "failed", automation: { attempt: 5, failed: true } },
    })
  })
})
