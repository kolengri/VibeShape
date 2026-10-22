import { describe, expect, it } from "bun:test"
import type {
  AssistantBridge,
  AssistantEvent,
  AssistantResult,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import { assistantToolTargetsSchema } from "@vibeshape/automation-api/assistant"
import { assistantJevAgentSchema } from "@vibeshape/automation-api/assistant-jev"
import { checkpointFixture } from "./assistant-checkpoints.test-fixture"
import {
  historyStoreFor,
  readChatHistory,
  trackHistoryController,
  writeLegacyChatHistory,
} from "./chat-history.test-fixture"
import { createNativeChatController as createController } from "./native-chat-controller"

function createNativeChatController(options: Parameters<typeof createController>[0]) {
  return trackHistoryController(
    options.storage,
    createController({
      ...options,
      historyStore: options.historyStore ?? historyStoreFor(options.storage),
    }),
  )
}

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const otherProjectId = "0195b5ac-b250-7a2c-8c33-000000000102"
const agent = { command: "/usr/local/bin/example-acp", args: ["--acp"] }
function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(steeringEnabled = false) {
  let listener: ((event: AssistantEvent) => void) | undefined
  let subscriptions = 0
  let sequence = 0
  let snapshot: AssistantSnapshot
  let resolvePrompt: (() => void) | undefined
  let disconnectDelay: Promise<void> | undefined
  let connectDelay: ReturnType<typeof deferred> | undefined
  let connectStarted: ReturnType<typeof deferred> | undefined
  let failPrompt = false
  let failQuestion = false
  let configurationDelay: ReturnType<typeof deferred> | undefined
  let selectedConfiguration = "low"
  const promptedConfigurations: string[] = []
  const prompts: Parameters<AssistantBridge["prompt"]>[0][] = []
  const steers: Parameters<NonNullable<AssistantBridge["steer"]>>[0][] = []
  let steerResponse: Promise<"injected" | "startedNewTurn" | "failed"> | undefined
  const questionResponses: Parameters<AssistantBridge["respondQuestion"]>[0][] = []
  const connects: Parameters<AssistantBridge["connect"]>[0][] = []
  const disconnected: string[] = []
  const permissions: Parameters<AssistantBridge["respondPermission"]>[0][] = []
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    async connect(input) {
      connects.push(input)
      snapshot = {
        projectId: input.projectId,
        sessionToken: `token-${++sequence}`,
        sessionId: `session-${sequence}`,
        canResume: true,
        ...(steeringEnabled ? { canSteer: true } : {}),
        status: "ready",
        modes: [],
        currentModeId: null,
        models: [],
        currentModelId: null,
        configOptions: [],
        attachmentCapabilities: { text: true, images: true },
        authMethods: [],
      }
      const captured = snapshot
      connectStarted?.resolve()
      await connectDelay?.promise
      return { ok: true, value: captured }
    },
    async prompt(input) {
      prompts.push(input)
      promptedConfigurations.push(selectedConfiguration)
      const captured = snapshot
      if (steeringEnabled) {
        snapshot = { ...snapshot, status: "prompting" }
        listener?.({
          projectId: snapshot.projectId,
          sessionToken: snapshot.sessionToken,
          type: "snapshot",
          snapshot,
        })
      }
      const fails = failPrompt
      failPrompt = false
      await new Promise<void>((resolve) => {
        resolvePrompt = () => {
          if (steeringEnabled && snapshot.sessionToken === captured.sessionToken) {
            snapshot = { ...snapshot, status: "ready" }
            listener?.({
              projectId: snapshot.projectId,
              sessionToken: snapshot.sessionToken,
              type: "snapshot",
              snapshot,
            })
          }
          resolvePrompt = undefined
          resolve()
        }
      })
      return fails ? { ok: false, code: "request-failed" } : { ok: true, value: captured }
    },
    async steer(input): Promise<AssistantResult> {
      steers.push(input)
      const captured = snapshot
      const response = steerResponse
      steerResponse = undefined
      const steerOutcome = response ? await response : "injected"
      if (steerOutcome === "failed") return { ok: false, code: "request-failed" }
      if (steerOutcome === "startedNewTurn" && captured.sessionToken === snapshot.sessionToken) {
        snapshot = { ...snapshot, status: "prompting" }
        listener?.({
          projectId: snapshot.projectId,
          sessionToken: snapshot.sessionToken,
          type: "snapshot",
          snapshot,
        })
      }
      return { ok: true, value: captured, steerOutcome }
    },
    async cancel() {
      resolvePrompt?.()
      return { ok: true, value: snapshot }
    },
    async disconnect(input) {
      disconnected.push(input.sessionToken)
      const captured = snapshot
      await disconnectDelay
      return { ok: true, value: { ...captured, status: "disconnected" } }
    },
    async respondPermission(input) {
      permissions.push(input)
      return { ok: true, value: snapshot }
    },
    async setMode() {
      return { ok: true, value: snapshot }
    },
    async setModel() {
      return { ok: true, value: snapshot }
    },
    async setConfigOption(input) {
      await configurationDelay?.promise
      selectedConfiguration = input.value
      return { ok: true, value: snapshot }
    },
    async respondQuestion(input) {
      questionResponses.push(input)
      if (failQuestion) {
        failQuestion = false
        return { ok: false, code: "invalid-request" }
      }
      return { ok: true, value: snapshot }
    },
    async authenticate() {
      return { ok: true, value: snapshot }
    },
    onEvent(callback) {
      subscriptions += 1
      listener = callback
      return () => {
        subscriptions -= 1
        listener = undefined
      }
    },
  }
  return {
    bridge,
    connects,
    disconnected,
    permissions,
    prompts,
    steers,
    questionResponses,
    promptedConfigurations,
    failNextQuestion() {
      failQuestion = true
    },
    deferConfiguration() {
      const waiting = deferred()
      configurationDelay = waiting
      return () => {
        configurationDelay = undefined
        waiting.resolve()
      }
    },
    failNextPrompt() {
      failPrompt = true
    },
    subscriptions: () => subscriptions,
    snapshot: () => snapshot,
    finish: () => resolvePrompt?.(),
    finishExternal() {
      listener?.({
        projectId: snapshot.projectId,
        sessionToken: snapshot.sessionToken,
        type: "completed",
        stopReason: "end_turn",
      })
      snapshot = { ...snapshot, status: "ready" }
      listener?.({
        projectId: snapshot.projectId,
        sessionToken: snapshot.sessionToken,
        type: "snapshot",
        snapshot,
      })
    },
    deferSteer() {
      let resolve!: (outcome: "injected" | "startedNewTurn" | "failed") => void
      let reject!: (error: Error) => void
      steerResponse = new Promise((yes, no) => {
        resolve = yes
        reject = no
      })
      return { resolve, reject }
    },
    emit: (event: AssistantEvent) => listener?.(event),
    deferDisconnect() {
      const waiting = deferred()
      disconnectDelay = waiting.promise
      return () => {
        disconnectDelay = undefined
        waiting.resolve()
      }
    },
    deferConnect() {
      const waiting = deferred(),
        started = deferred()
      connectDelay = waiting
      connectStarted = started
      return {
        started: started.promise,
        release() {
          connectDelay = undefined
          connectStarted = undefined
          waiting.resolve()
        },
      }
    },
  }
}

async function until(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Expected controller transition did not complete")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

function queuedId(chat: ReturnType<typeof createNativeChatController>, index = 0) {
  const item = chat.getSnapshot().queuedMessages[index]
  if (!item) throw new Error("Missing queued message.")
  return item.id
}

describe("queued native steering", () => {
  it("keeps Jev credentials connection-only while recovery retains the exact built-in descriptor", async () => {
    const f = fixture(),
      disk = storage()
    const jev = assistantJevAgentSchema.parse({ kind: "jev", settings: { model: "jev-test" } })
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(jev, { apiKey: "test-private-key" })
    expect(f.connects[0]).toMatchObject({
      agent: jev,
      jevCredentials: { apiKey: "test-private-key" },
    })
    await chat.flushHistory()
    expect(JSON.stringify(await readChatHistory(projectId, disk))).not.toContain("test-private-key")
    f.emit({
      projectId,
      sessionToken: f.snapshot().sessionToken,
      type: "error",
      code: "agent-exited",
    })
    await until(() => f.connects.length === 2 && !chat.getSnapshot().connecting, 7000)
    expect(f.connects[1]?.agent).toEqual(jev)
    expect(f.connects[1]).not.toHaveProperty("jevCredentials")
    chat.dispose()
  })
  it("applies an idle draft without prompting the native agent and retains checkpoint inspection and Undo", async () => {
    const f = fixture()
    const model = checkpointFixture()
    const chat = createNativeChatController({
      projectId,
      bridge: f.bridge,
      storage: storage(),
      checkpointHost: model.host,
    })
    chat.start()
    await chat.connect(agent)
    const pending = deferred()
    const applied = chat.applyDraft(async () => {
      await pending.promise
      model.save()
      return true
    })
    expect(chat.getSnapshot().settlingCheckpoint).toBe(true)
    expect(
      await chat.applyDraft(async () => {
        throw new Error("Duplicate Apply")
      }),
    ).toBe(false)
    await chat.reset()
    expect(chat.getSnapshot().settlingCheckpoint).toBe(true)
    pending.resolve()
    expect(await applied).toBe(true)
    expect(f.prompts).toEqual([])
    expect(chat.getSnapshot()).toMatchObject({
      settlingCheckpoint: false,
      canUndoAgentChanges: true,
    })
    expect(await chat.viewBefore()).toBe(true)
    expect(await chat.undoAgentChanges()).toBe(true)
    expect(model.restores).toEqual([{ baseline: 1, revision: 2 }])
    chat.dispose()
  })

  it.each([false, true])(
    "waits for a delayed accepted save after Stop (prior save: %s) before capturing another prompt",
    async (priorSave) => {
      const f = fixture(true),
        model = checkpointFixture()
      const chat = createNativeChatController({
        projectId,
        bridge: f.bridge,
        storage: storage(),
        checkpointHost: model.host,
      })
      chat.start()
      await chat.connect(agent)
      expect(await chat.send("Change model")).toBe(true)
      if (priorSave) model.save()
      const save = model.deferSave()
      await chat.cancel()
      await until(() => chat.getSnapshot().settlingCheckpoint)
      model.pair(null)
      expect(await chat.send("Next prompt")).toBe(true)
      expect(f.prompts).toHaveLength(1)
      expect(chat.getSnapshot().queuedMessages).toHaveLength(1)
      expect(await chat.undoAgentChanges()).toBe(false)
      save()
      await until(() => chat.getSnapshot().canUndoAgentChanges)
      expect(f.prompts).toHaveLength(1)
      expect(await chat.undoAgentChanges()).toBe(true)
      expect(model.restores).toEqual([{ baseline: 1, revision: priorSave ? 3 : 2 }])
      chat.dispose()
    },
  )

  it("holds automatic queue draining until the accepted save finishes after ACP prompt completion", async () => {
    const f = fixture(),
      model = checkpointFixture()
    const chat = createNativeChatController({
      projectId,
      bridge: f.bridge,
      storage: storage(),
      checkpointHost: model.host,
    })
    chat.start()
    await chat.connect(agent)
    await chat.send("First")
    await chat.enqueue("Second")
    const save = model.deferSave()
    f.finish()
    await until(() => chat.getSnapshot().settlingCheckpoint)
    expect(f.prompts).toHaveLength(1)
    save()
    await until(() => f.prompts.length === 2)
    expect(model.retained()).toBe(2)
    f.finish()
    await until(() => chat.getSnapshot().canUndoAgentChanges)
    expect(await chat.undoAgentChanges()).toBe(true)
    expect(model.restores).toEqual([{ baseline: 1, revision: 2 }])
    chat.dispose()
  })

  it("captures saved changes through Stop and exposes one internal Undo after settlement", async () => {
    const f = fixture(true),
      model = checkpointFixture()
    const chat = createNativeChatController({
      projectId,
      bridge: f.bridge,
      storage: storage(),
      checkpointHost: model.host,
    })
    chat.start()
    await chat.connect(agent)
    expect(await chat.send("Change model")).toBe(true)
    model.save()
    expect(chat.getSnapshot().canUndoAgentChanges).toBe(false)
    await chat.cancel()
    await until(() => chat.getSnapshot().canUndoAgentChanges)
    expect(await chat.viewBefore()).toBe(true)
    expect(chat.getSnapshot().viewingBefore).toBe(true)
    await chat.cancel()
    expect(chat.getSnapshot()).toMatchObject({ viewingBefore: false, canUndoAgentChanges: true })
    expect(await chat.undoAgentChanges()).toBe(true)
    expect(model.restores).toEqual([{ baseline: 1, revision: 2 }])
    chat.dispose()
  })

  it("refuses to dispatch a model prompt if its saved baseline cannot be captured", async () => {
    const f = fixture(),
      model = checkpointFixture()
    const chat = createNativeChatController({
      projectId,
      bridge: f.bridge,
      storage: storage(),
      checkpointHost: { ...model.host, open: () => null },
    })
    chat.start()
    await chat.connect(agent)
    expect(await chat.send("Must be reversible")).toBe(false)
    expect(f.prompts).toEqual([])
    expect(chat.getSnapshot().checkpointError).toBe("checkpointUnavailable")
    chat.dispose()
  })

  it("claims one item until accepted, preserves its exact payload, and leaves other items in order", async () => {
    const f = fixture(true),
      disk = storage()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    await chat.send("Active")
    f.emit({
      projectId,
      sessionToken: f.snapshot().sessionToken,
      type: "text",
      text: "Before dispatch",
    })
    await chat.enqueue("Earlier")
    const attachments = [
      {
        id: "notes",
        name: "notes.txt",
        type: "text" as const,
        mimeType: "text/plain",
        text: "Exact private payload\nπ",
      },
      {
        id: "view",
        name: "view.png",
        type: "image" as const,
        mimeType: "image/png" as const,
        data: "aGVsbG8=",
      },
    ]
    await chat.enqueue("  Steer exactly\n", attachments)
    await chat.enqueue("Later")
    const id = queuedId(chat, 1),
      pending = f.deferSteer()
    const promoted = chat.steerQueued(id)
    expect(await chat.steerQueued(id)).toBe(false)
    expect(await chat.steerQueued(queuedId(chat))).toBe(false)
    chat.removeQueued(id)
    expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual([
      "Earlier",
      "  Steer exactly\n",
      "Later",
    ])
    expect(f.steers).toEqual([
      {
        projectId,
        sessionToken: f.snapshot().sessionToken,
        requestId: id,
        text: "  Steer exactly\n",
        attachments,
      },
    ])
    f.emit({
      projectId,
      sessionToken: f.snapshot().sessionToken,
      type: "text",
      text: "Before acknowledgement",
    })
    pending.resolve("injected")
    expect(await promoted).toBe(true)
    f.emit({
      projectId,
      sessionToken: f.snapshot().sessionToken,
      type: "text",
      text: " and after acknowledgement",
    })
    expect(chat.getSnapshot().messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Active" },
      { role: "assistant", text: "Before dispatch" },
      { role: "user", text: "  Steer exactly\n" },
      { role: "assistant", text: "Before acknowledgement and after acknowledgement" },
    ])
    expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual(["Earlier", "Later"])
    expect(
      chat
        .getSnapshot()
        .messages.filter(({ role, text }) => role === "user" && text === "  Steer exactly\n"),
    ).toHaveLength(1)
    expect(JSON.stringify(await readChatHistory(projectId, disk))).not.toContain(
      "Exact private payload",
    )
    f.finish()
    await until(() => f.prompts.length === 2)
    expect(f.prompts.map(({ text }) => text)).toEqual(["Active", "Earlier"])
    await chat.cancel()
    chat.dispose()
  })

  it("holds queue draining through completion and truthfully tracks a provider-started new turn", async () => {
    const f = fixture(true),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    await chat.send("Active")
    await chat.enqueue("Promoted")
    await chat.enqueue("Later")
    const pending = f.deferSteer(),
      promoted = chat.steerQueued(queuedId(chat))
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    expect(f.prompts).toHaveLength(1)
    expect(chat.getSnapshot().queuedMessages).toHaveLength(2)
    pending.resolve("startedNewTurn")
    expect(await promoted).toBe(true)
    expect(chat.getSnapshot()).toMatchObject({
      busy: true,
      steerStartedNewTurn: true,
      steeringQueuedId: null,
    })
    f.emit({
      projectId,
      sessionToken: f.snapshot().sessionToken,
      type: "text",
      text: "New turn output",
    })
    expect(chat.getSnapshot().messages.at(-1)?.text).toBe("New turn output")
    expect(f.prompts).toHaveLength(1)
    f.finishExternal()
    await until(() => f.prompts.length === 2)
    expect(f.prompts[1]?.text).toBe("Later")
    expect(
      chat
        .getSnapshot()
        .messages.filter(({ role, text }) => role === "user" && text === "Promoted"),
    ).toHaveLength(1)
    await chat.cancel()
    chat.dispose()
  })

  it.each(["failed", "rejected"])(
    "retains the item without draining or adding history when steering is %s",
    async (outcome) => {
      const f = fixture(true),
        chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
      chat.start()
      await chat.connect(agent)
      await chat.send("Active")
      await chat.enqueue("Retained")
      await chat.enqueue("Later")
      const pending = f.deferSteer(),
        promoted = chat.steerQueued(queuedId(chat))
      f.finish()
      await until(() => !chat.getSnapshot().busy)
      if (outcome === "failed") pending.resolve("failed")
      else pending.reject(new Error("Steering transport failed"))
      expect(await promoted).toBe(false)
      expect(chat.getSnapshot()).toMatchObject({ queuePaused: true, steeringQueuedId: null })
      expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual([
        "Retained",
        "Later",
      ])
      expect(
        chat
          .getSnapshot()
          .messages.filter(({ role }) => role === "user")
          .map(({ text }) => text),
      ).toEqual(["Active"])
      expect(f.prompts).toHaveLength(1)
      chat.dispose()
    },
  )

  it.each(["cancel", "reconnect"] as const)(
    "keeps confirmed delivery single and the remaining queue paused through %s",
    async (action) => {
      const f = fixture(true),
        chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
      chat.start()
      await chat.connect(agent)
      await chat.send("Active")
      await chat.enqueue("Promoted")
      await chat.enqueue("Later")
      const pending = f.deferSteer(),
        promoted = chat.steerQueued(queuedId(chat))
      if (action === "cancel") await chat.cancel()
      else {
        await chat.disconnect()
        await chat.connect(agent)
        f.finish()
      }
      pending.resolve("injected")
      expect(await promoted).toBe(true)
      await until(() => !chat.getSnapshot().busy)
      expect(chat.getSnapshot()).toMatchObject({ queuePaused: true, steeringQueuedId: null })
      expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual(["Later"])
      expect(
        chat
          .getSnapshot()
          .messages.filter(({ role, text }) => role === "user" && text === "Promoted"),
      ).toHaveLength(1)
      expect(f.prompts).toHaveLength(1)
      chat.dispose()
    },
  )

  it("does not steer idle or unsupported sessions or disturb another project's queue", async () => {
    for (const supported of [false, true]) {
      const f = fixture(supported),
        other = fixture(true)
      const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
      const second = createNativeChatController({
        projectId: otherProjectId,
        bridge: other.bridge,
        storage: storage(),
      })
      chat.start()
      second.start()
      await chat.connect(agent)
      await second.connect(agent)
      if (!supported) {
        await chat.send("Active")
        const snapshot = { ...f.snapshot(), status: "prompting" as const }
        f.emit({ projectId, sessionToken: snapshot.sessionToken, type: "snapshot", snapshot })
      }
      await chat.enqueue("Retained")
      await second.send("Other active")
      await second.enqueue("Other queued")
      expect(await chat.steerQueued(queuedId(chat))).toBe(false)
      expect(f.steers).toHaveLength(0)
      expect(second.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual(["Other queued"])
      expect(other.steers).toHaveLength(0)
      await second.cancel()
      chat.dispose()
      second.dispose()
    }
  })
})

describe("project-scoped agent chat", () => {
  it("reports a successful explicit connection and rejects attempts after disposal", async () => {
    const f = fixture()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    expect(await chat.connect(agent)).toBe(true)
    chat.dispose()
    expect(await chat.connect(agent)).toBe(false)
  })

  it.each(["host-rejection", "transport-failure"] as const)(
    "reports an unsuccessful connection on %s without throwing",
    async (failure) => {
      const f = fixture()
      const bridge: AssistantBridge = {
        ...f.bridge,
        async connect() {
          if (failure === "transport-failure") throw new Error("Fixture transport unavailable")
          return { ok: false, code: "mcp-client-conflict" }
        },
      }
      const chat = createNativeChatController({ projectId, bridge, storage: storage() })
      chat.start()
      try {
        expect(await chat.connect(agent)).toBe(false)
        if (failure === "host-rejection")
          expect(chat.getSnapshot().error).toBe("mcp-client-conflict")
      } finally {
        chat.dispose()
      }
    },
  )

  it("reports pending attempts as blocked and a disconnected late result as unsuccessful", async () => {
    const f = fixture()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    const connection = f.deferConnect()
    const pending = chat.connect(agent)
    await connection.started
    expect(await chat.connect(agent)).toBe(false)
    await chat.disconnect()
    connection.release()
    expect(await pending).toBe(false)
    expect(chat.getSnapshot().snapshot).toBeNull()
    chat.dispose()
  })

  it("queues Send until an in-flight configuration change completes without showing inference busy", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const release = f.deferConfiguration()
    const configuring = chat.setConfigOption("reasoning", "high")
    expect(chat.getSnapshot().busy).toBe(false)
    expect(await chat.send("Use the chosen reasoning effort")).toBe(true)
    expect(f.prompts).toHaveLength(0)
    expect(chat.getSnapshot().queuedMessages).toHaveLength(1)
    release()
    await configuring
    await until(() => f.prompts.length === 1)
    expect(f.promptedConfigurations).toEqual(["high"])
    expect(chat.getSnapshot().queuedMessages).toHaveLength(0)
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    chat.dispose()
  })

  it("bounds pending messages and keeps rejected queue input outside the transcript", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    await chat.send("Running")
    for (let index = 0; index < 8; index += 1)
      expect(await chat.enqueue(`Queued ${index}`)).toBe(true)
    expect(await chat.enqueue("Keep this in the composer")).toBe(false)
    expect(chat.getSnapshot().error).toBe("queue-full")
    expect(chat.getSnapshot().queuedMessages).toHaveLength(8)
    expect(chat.getSnapshot().messages.map(({ text }) => text)).toEqual(["Running"])
    const first = chat.getSnapshot().queuedMessages[0]
    if (first) chat.removeQueued(first.id)
    expect(await chat.enqueue("Replacement")).toBe(true)
    await chat.cancel()
    chat.dispose()
  })

  it("rejects an over-budget renderer envelope before sending, queueing, or recording it", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const snapshot: AssistantSnapshot = {
      ...f.snapshot(),
      attachmentCapabilities: {
        text: true,
        images: true,
        imageConstraints: {
          mimeTypes: ["image/png", "image/jpeg"],
          maxCount: 4,
          maxTotalBase64Bytes: 524288,
        },
      },
    }
    f.emit({ projectId, sessionToken: snapshot.sessionToken, type: "snapshot", snapshot })
    const attachments = ["first", "second"].map((id) => ({
      id,
      name: `${id}.png`,
      type: "image" as const,
      mimeType: "image/png" as const,
      data: Buffer.alloc(196609).toString("base64"),
    }))
    expect(await chat.send("Invalid direct prompt", attachments)).toBe(false)
    expect(await chat.enqueue("Invalid queued prompt", attachments)).toBe(false)
    expect(f.prompts).toHaveLength(0)
    expect(chat.getSnapshot().messages).toHaveLength(0)
    expect(chat.getSnapshot().queuedMessages).toHaveLength(0)
    expect(chat.getSnapshot().error).toBe("unsupported")
    expect(await chat.send("One image still fits", attachments.slice(0, 1))).toBe(true)
    expect(f.prompts).toHaveLength(1)
    expect(f.prompts[0]?.attachments).toEqual(attachments.slice(0, 1))
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    chat.dispose()
  })

  it("pauses retained attachments rejected by a new agent before checkpoints, history, or dispatch", async () => {
    const f = fixture(),
      disk = storage(),
      checkpoint = checkpointFixture(),
      port = checkpoint.host.open()
    if (!port) throw new Error("Missing checkpoint port")
    let captures = 0
    const chat = createNativeChatController({
      projectId,
      bridge: f.bridge,
      storage: disk,
      checkpointHost: {
        ...checkpoint.host,
        open: () => ({
          ...port,
          capture(...args: Parameters<typeof port.capture>) {
            captures += 1
            return port.capture(...args)
          },
        }),
      },
    })
    chat.start()
    await chat.connect(agent)
    const attachments = [
      {
        id: "retained-view",
        name: "view.webp",
        type: "image" as const,
        mimeType: "image/webp" as const,
        data: "AAAA",
      },
    ]
    expect(await chat.enqueue("Inspect the retained view", attachments)).toBe(true)
    const queued = chat.getSnapshot().queuedMessages
    await chat.connect(assistantJevAgentSchema.parse({ kind: "jev", settings: { model: "test" } }))
    const snapshot: AssistantSnapshot = {
      ...f.snapshot(),
      attachmentCapabilities: {
        text: true,
        images: true,
        imageConstraints: {
          mimeTypes: ["image/png", "image/jpeg"],
          maxCount: 4,
          maxTotalBase64Bytes: 524288,
        },
      },
    }
    f.emit({ projectId, sessionToken: snapshot.sessionToken, type: "snapshot", snapshot })
    await chat.resumeQueue()
    expect(chat.getSnapshot()).toMatchObject({
      queuePaused: true,
      error: "unsupported",
      messages: [],
      queuedMessages: queued,
    })
    expect(captures).toBe(0)
    expect(f.prompts).toHaveLength(0)
    expect((await readChatHistory(projectId, disk))?.messages ?? []).toHaveLength(0)
    await chat.connect(agent)
    await chat.resumeQueue()
    expect(f.prompts).toHaveLength(1)
    expect(f.prompts[0]?.attachments).toEqual(attachments)
    expect(captures).toBe(1)
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    chat.dispose()
  })

  it("accepts a turn immediately, drains queued messages in order, and persists attachment names without file contents", async () => {
    const f = fixture(),
      disk = storage(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    expect(await chat.send("First")).toBe(true)
    expect(chat.getSnapshot().busy).toBe(true)
    const attachments = [
      {
        id: "attached-file",
        name: "notes.txt",
        type: "text" as const,
        mimeType: "text/plain",
        text: "file bytes remain in memory",
      },
    ]
    expect(await chat.enqueue("Second", attachments)).toBe(true)
    expect(await chat.send("Third")).toBe(true)
    expect(f.prompts.map(({ text }) => text)).toEqual(["First"])
    f.finish()
    await until(() => f.prompts.length === 2)
    expect(f.prompts[1]?.attachments).toEqual(attachments)
    expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual(["Third"])
    f.finish()
    await until(() => f.prompts.length === 3)
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    expect(f.prompts.map(({ text }) => text)).toEqual(["First", "Second", "Third"])
    expect((await readChatHistory(projectId, disk))?.messages[1]?.attachments).toEqual([
      { id: "attached-file", name: "notes.txt" },
    ])
    expect(JSON.stringify(await readChatHistory(projectId, disk))).not.toContain(
      "file bytes remain in memory",
    )
    chat.dispose()
  })

  it("pauses and retains queued work after failure, cancellation and disconnect, then resumes only explicitly", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    await chat.send("First")
    await chat.enqueue("Queued")
    f.failNextPrompt()
    f.finish()
    await until(() => f.prompts.length === 2)
    f.finish()
    await until(() => chat.getSnapshot().queuePaused)
    expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual(["Queued"])
    await chat.reset()
    expect(chat.getSnapshot().queuedMessages).toHaveLength(1)
    await chat.disconnect()
    expect(chat.getSnapshot().queuedMessages).toHaveLength(1)
    expect(await chat.resumeQueue()).toBe(false)
    await chat.connect(agent)
    expect(f.prompts).toHaveLength(2)
    expect(await chat.resumeQueue()).toBe(true)
    await until(() => f.prompts.length === 3)
    await chat.enqueue("After cancellation")
    await chat.cancel()
    await until(() => !chat.getSnapshot().busy)
    expect(chat.getSnapshot().queuePaused).toBe(true)
    expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual([
      "After cancellation",
    ])
    const queued = chat.getSnapshot().queuedMessages[0]
    if (queued) chat.removeQueued(queued.id)
    expect(chat.getSnapshot().queuedMessages).toHaveLength(0)
    chat.dispose()
  })

  it("discards a failed queued answer before retry while preserving earlier history and one user message", async () => {
    const f = fixture(),
      disk = storage(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    const scope = { projectId, sessionToken: f.snapshot().sessionToken }
    await chat.send("First")
    await chat.enqueue("Queued")
    f.emit({ ...scope, type: "text", text: "Earlier answer" })
    f.failNextPrompt()
    f.finish()
    await until(() => f.prompts.length === 2)
    f.emit({ ...scope, type: "thought", text: "Failed plan" })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "failed-work",
      title: "Failed work",
      status: "in_progress",
    })
    f.emit({ ...scope, type: "text", text: "Failed partial" })
    expect(chat.getSnapshot().messages.at(-1)?.text).toBe("Failed partial")
    f.finish()
    await until(() => !chat.getSnapshot().busy && chat.getSnapshot().queuePaused)
    expect(chat.getSnapshot().messages.map(({ text }) => text)).toEqual([
      "First",
      "Earlier answer",
      "Queued",
    ])
    expect(await chat.resumeQueue()).toBe(true)
    await until(() => f.prompts.length === 3)
    f.emit({ ...scope, type: "text", text: "Complete answer" })
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    expect(chat.getSnapshot().messages.map(({ text }) => text)).toEqual([
      "First",
      "Earlier answer",
      "Queued",
      "Complete answer",
    ])
    expect(f.prompts.map(({ text }) => text)).toEqual(["First", "Queued", "Queued"])
    expect((await readChatHistory(projectId, disk))?.messages).toEqual([
      ...chat.getSnapshot().messages,
    ])
    chat.dispose()
  })

  it("keeps a new Send behind a paused failed backlog until explicit resume", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    expect(await chat.send("Active turn")).toBe(true)
    expect(await chat.enqueue("Earlier queued turn")).toBe(true)
    f.failNextPrompt()
    f.finish()
    await until(() => f.prompts.length === 2)
    f.finish()
    await until(() => !chat.getSnapshot().busy && chat.getSnapshot().queuePaused)

    expect(await chat.send("New ordinary Send")).toBe(true)
    expect(chat.getSnapshot().queuePaused).toBe(true)
    expect(f.prompts.map(({ text }) => text)).toEqual(["Active turn", "Earlier queued turn"])
    expect(chat.getSnapshot().queuedMessages.map(({ text }) => text)).toEqual([
      "Earlier queued turn",
      "New ordinary Send",
    ])

    expect(await chat.resumeQueue()).toBe(true)
    await until(() => f.prompts.length === 3)
    expect(f.prompts[2]?.text).toBe("Earlier queued turn")
    f.finish()
    await until(() => f.prompts.length === 4)
    expect(f.prompts[3]?.text).toBe("New ordinary Send")
    f.finish()
    await until(() => !chat.getSnapshot().busy)
    expect(chat.getSnapshot().queuedMessages).toHaveLength(0)
    chat.dispose()
  })

  it("routes protocol questions by request and session and clears them after the agent resolves or disconnects", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const scope = { projectId, sessionToken: f.snapshot().sessionToken }
    const question = {
      requestId: "question",
      message: "Choose",
      expiresAt: Date.now() + 10_000,
      fields: [
        {
          id: "choice",
          label: "Choice",
          required: true,
          secret: false,
          options: [{ id: "Other", name: "Other" }],
        },
        { id: "note", label: "Custom answer", required: false, secret: false },
      ],
    }
    f.emit({ ...scope, type: "question", question })
    expect(chat.getSnapshot().question).toEqual(question)
    f.failNextQuestion()
    expect(await chat.respondQuestion({ choice: "Other" })).toBe(false)
    expect(chat.getSnapshot().error).toBeNull()
    expect(chat.getSnapshot().question).toEqual(question)
    expect(await chat.respondQuestion({ choice: "Other", note: "Use a custom dimension" })).toBe(
      true,
    )
    expect(f.questionResponses).toEqual([
      { ...scope, requestId: "question", answers: { choice: "Other" } },
      {
        ...scope,
        requestId: "question",
        answers: { choice: "Other", note: "Use a custom dimension" },
      },
    ])
    expect(chat.getSnapshot().question).toBeNull()
    f.emit({ ...scope, type: "question", question })
    await chat.disconnect()
    f.emit({ ...scope, type: "question", question })
    expect(chat.getSnapshot().question).toBeNull()
    chat.dispose()
  })

  it.each(["answered", "cancelled", "expired"] as const)(
    "retains queued messages across premature terminal readiness while a question is pending: %s",
    async (reason) => {
      const f = fixture(true)
      const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
      chat.start()
      try {
        await chat.connect(agent)
        await chat.send("Ask before continuing")
        const scope = { projectId, sessionToken: f.snapshot().sessionToken }
        const question = {
          requestId: "blocking-question",
          message: "Choose size",
          expiresAt: Date.now() + 10_000,
          fields: [{ id: "size", label: "Size", required: true, secret: false }],
        }
        f.emit({ ...scope, type: "question", question })
        await chat.enqueue("Dependent queued continuation")
        f.finishExternal()
        f.finish()
        await Promise.resolve()
        await Promise.resolve()
        expect(chat.getSnapshot().question).toEqual(question)
        expect(f.prompts).toHaveLength(1)
        expect(await chat.resumeQueue()).toBe(false)
        expect(await chat.steerQueued(chat.getSnapshot().queuedMessages[0]?.id ?? "")).toBe(false)
        f.emit({ ...scope, type: "question-resolved", requestId: question.requestId, reason })
        f.emit({
          ...scope,
          type: "snapshot",
          snapshot: {
            ...f.snapshot(),
            status: "ready",
            ...(reason === "answered" ? {} : { questionStatus: "paused" as const }),
          },
        })
        await Promise.resolve()
        if (reason === "answered") {
          await until(() => f.prompts.length === 2)
          expect(f.prompts).toHaveLength(2)
          f.finish()
        } else {
          expect(f.prompts).toHaveLength(1)
          expect(chat.getSnapshot()).toMatchObject({
            queuePaused: true,
            queuedMessages: [{ text: "Dependent queued continuation" }],
          })
        }
      } finally {
        chat.dispose()
      }
    },
  )

  it("recovers the exact session without continuing or draining unanswered question work", async () => {
    const f = fixture(true)
    const bridge: AssistantBridge = {
      ...f.bridge,
      async connect(input) {
        const result = await f.bridge.connect(input)
        return result.ok && input.resumeSessionId
          ? { ...result, value: { ...result.value, sessionId: input.resumeSessionId } }
          : result
      },
    }
    const chat = createNativeChatController({ projectId, bridge, storage: storage() })
    chat.start()
    try {
      await chat.connect(agent)
      await chat.send("Question-dependent original")
      const scope = { projectId, sessionToken: f.snapshot().sessionToken }
      f.emit({
        ...scope,
        type: "question",
        question: {
          requestId: "question-before-loss",
          message: "Choose",
          expiresAt: Date.now() + 10_000,
          fields: [{ id: "size", label: "Size", required: true, secret: false }],
        },
      })
      await chat.enqueue("Unsent dependent work")
      f.emit({ ...scope, type: "error", code: "agent-exited" })
      await until(() => f.connects.length === 2 && chat.getSnapshot().recovery === null, 7000)
      expect(f.connects[1]?.resumeSessionId).toBe("session-1")
      expect(f.prompts).toHaveLength(1)
      expect(chat.getSnapshot()).toMatchObject({
        busy: false,
        question: null,
        queuePaused: true,
        queuedMessages: [{ text: "Unsent dependent work" }],
      })
      f.finish()
      expect(await chat.respondQuestion({ size: "late old answer" })).toBe(false)
    } finally {
      chat.dispose()
    }
  })

  it("subscribes only when started and tolerates a React effect restart", () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    expect(f.subscriptions()).toBe(0)
    chat.start()
    chat.start()
    expect(f.subscriptions()).toBe(1)
    chat.dispose()
    chat.start()
    expect(f.subscriptions()).toBe(1)
    chat.dispose()
    expect(f.subscriptions()).toBe(0)
  })
  it("accumulates streamed text, updates one tool card, and persists only this project's history", async () => {
    const f = fixture(),
      disk = storage(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    const sending = chat.send("Build a box")
    const scope = { projectId, sessionToken: f.snapshot().sessionToken }
    f.emit({ ...scope, type: "text", text: "Hello" })
    f.emit({ ...scope, type: "text", text: " world" })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "box",
      title: "Create box",
      status: "running",
      text: "Reviewed geometry",
    })
    f.emit({ ...scope, type: "tool", toolCallId: "box", status: "completed" })
    f.emit({ ...scope, projectId: otherProjectId, type: "text", text: "foreign" })
    f.finish()
    await sending
    expect(chat.getSnapshot().messages.map(({ text }) => text)).toEqual([
      "Build a box",
      "Hello world",
      "Reviewed geometry",
    ])
    expect(chat.getSnapshot().messages[2]?.tool).toEqual({
      title: "Create box",
      status: "completed",
    })
    await until(() => !chat.getSnapshot().busy)
    expect(await readChatHistory(otherProjectId, disk)).toBeNull()
    expect((await readChatHistory(projectId, disk))?.messages).toEqual([
      ...chat.getSnapshot().messages,
    ])
    chat.dispose()
  })
  it("retains per-call target namespaces through partial completion, clears failures and fences sessions", async () => {
    const f = fixture(),
      disk = storage()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    const sending = chat.send("Build")
    const scope = { projectId, sessionToken: f.snapshot().sessionToken }
    const feature = assistantToolTargetsSchema.parse({
      projectId,
      featureIds: [otherProjectId],
      sketchIds: [],
    })
    const sketch = assistantToolTargetsSchema.parse({
      projectId,
      featureIds: [],
      sketchIds: [otherProjectId],
    })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "feature",
      status: "in_progress",
      targets: feature,
      text: "x".repeat(32_768),
    })
    f.emit({ ...scope, type: "tool", toolCallId: "sketch", status: "in_progress", targets: sketch })
    f.emit({ ...scope, type: "tool", toolCallId: "feature", status: "completed" })
    f.emit({
      ...scope,
      sessionToken: "foreign",
      type: "tool",
      toolCallId: "feature",
      targets: sketch,
    })
    const messages = () => chat.getSnapshot().messages.filter(({ role }) => role === "tool")
    expect(messages().map(({ tool }) => tool?.targets)).toEqual([feature, sketch])
    expect(messages()[0]?.text).toHaveLength(32_768)
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "feature",
      targets: { ...feature, featureIds: [] },
    })
    expect(messages()[0]?.tool?.targets?.featureIds).toEqual([])
    f.emit({ ...scope, type: "tool", toolCallId: "sketch", status: "failed" })
    expect(messages()[1]?.tool?.targets).toBeUndefined()
    f.finish()
    await sending
    await until(() => !chat.getSnapshot().busy)
    expect((await readChatHistory(projectId, disk))?.messages).toEqual([
      ...chat.getSnapshot().messages,
    ])
    chat.dispose()
  })
  it("preserves the displayed preview failure across empty partial updates and history persistence", async () => {
    const f = fixture(),
      disk = storage()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    const sending = chat.send("Preview")
    const scope = { projectId, sessionToken: f.snapshot().sessionToken }
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "preview",
      title: "Preview draft",
      status: "in_progress",
      text: "Preparing preview",
    })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "preview",
      status: "failed",
      text: "The preview contains an open shell.",
      hasFailureDetails: true,
    })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "preview",
      status: "failed",
      text: " \n ",
      hasFailureDetails: false,
    })
    f.emit({ ...scope, type: "tool", toolCallId: "preview", status: "failed" })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "no-reason",
      status: "in_progress",
      text: "Preparing preview",
    })
    f.emit({
      ...scope,
      type: "tool",
      toolCallId: "no-reason",
      status: "failed",
      hasFailureDetails: false,
    })
    const messages = chat.getSnapshot().messages.filter(({ role }) => role === "tool")
    expect(messages[0]?.text).toBe("The preview contains an open shell.")
    expect(messages[0]?.tool?.status).toBe("failed")
    expect(messages[0]?.tool?.hasFailureDetails).toBe(true)
    expect(messages[1]?.text).toBe("Preparing preview")
    expect(messages[1]?.tool?.status).toBe("failed")
    expect(messages[1]?.tool?.hasFailureDetails).toBe(false)
    f.finish()
    await sending
    await until(() => !chat.getSnapshot().busy)
    expect((await readChatHistory(projectId, disk))?.messages).toEqual([
      ...chat.getSnapshot().messages,
    ])
    expect(chat.getSnapshot().error).toBeNull()
    chat.dispose()
  })
  it.each(["cancel", "disconnect", "dispose"] as const)(
    "persists cancelled current-turn running tools on %s without changing terminal or historical cards",
    async (action) => {
      const f = fixture(),
        disk = storage()
      const historical = {
        id: crypto.randomUUID(),
        role: "tool" as const,
        text: "Prior turn",
        tool: { title: "Historical", status: "in_progress" },
      }
      expect(writeLegacyChatHistory(projectId, [historical], disk)).toBe(true)
      const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
      chat.start()
      await chat.connect(agent)
      expect(await chat.send("Build a box")).toBe(true)
      const scope = { projectId, sessionToken: f.snapshot().sessionToken }
      for (const status of [
        "pending",
        "in_progress",
        "completed",
        "failed",
        "cancelled",
        "unknown-terminal",
      ]) {
        f.emit({ ...scope, type: "tool", toolCallId: status, title: status, status })
      }
      await chat[action]()
      const statuses = chat
        .getSnapshot()
        .messages.filter(({ role }) => role === "tool")
        .map(({ tool }) => tool?.status)
      expect(statuses).toEqual([
        "in_progress",
        "cancelled",
        "cancelled",
        "completed",
        "failed",
        "cancelled",
        "unknown-terminal",
      ])
      expect((await readChatHistory(projectId, disk))?.messages).toEqual([
        ...chat.getSnapshot().messages,
      ])
      const reopened = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
      await reopened.flushHistory()
      expect(reopened.getSnapshot().messages).toEqual(chat.getSnapshot().messages)
      reopened.dispose()
      chat.dispose()
      f.finish()
    },
  )

  it.each(["event", "prompt-result"] as const)(
    "persists failed current-turn running tools after a failed %s",
    async (failure) => {
      const f = fixture(),
        disk = storage(),
        chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
      chat.start()
      await chat.connect(agent)
      if (failure === "prompt-result") f.failNextPrompt()
      expect(await chat.send("Build a box")).toBe(true)
      const scope = { projectId, sessionToken: f.snapshot().sessionToken }
      f.emit({ ...scope, type: "tool", toolCallId: "waiting", status: "pending" })
      f.emit({ ...scope, type: "tool", toolCallId: "running", status: "in_progress" })
      f.emit({ ...scope, type: "tool", toolCallId: "done", status: "completed" })
      if (failure === "event") f.emit({ ...scope, type: "error", code: "request-failed" })
      else f.finish()
      await until(() => !chat.getSnapshot().busy && chat.getSnapshot().error === "request-failed")
      expect(
        chat
          .getSnapshot()
          .messages.filter(({ role }) => role === "tool")
          .map(({ tool }) => tool?.status),
      ).toEqual(["failed", "failed", "completed"])
      expect((await readChatHistory(projectId, disk))?.messages).toEqual([
        ...chat.getSnapshot().messages,
      ])
      chat.dispose()
      f.finish()
    },
  )

  it("ignores a previous connection's late stream and prompt result", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const old = f.snapshot()
    const sending = chat.send("Old turn")
    await chat.disconnect()
    await chat.connect(agent)
    const current = chat.getSnapshot().snapshot
    f.emit({ projectId, sessionToken: old.sessionToken, type: "text", text: "late" })
    f.finish()
    await sending
    expect(chat.getSnapshot().snapshot).toBe(current)
    expect(chat.getSnapshot().messages).toHaveLength(1)
    chat.dispose()
  })
  it("resumes only an advertised matching agent session and clears it for a new chat", async () => {
    const f = fixture(),
      disk = storage()
    let chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    chat.dispose()
    chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    expect(f.connects.at(-1)?.resumeSessionId).toBe("session-1")
    await chat.reset()
    expect(f.connects.at(-1)?.resumeSessionId).toBeUndefined()
    chat.dispose()
  })
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "starts Codex fresh after nonresumable Jev (reload: %s, retry save: %s)",
    async (reload, retrySave) => {
      const f = fixture()
      const disk = storage()
      const codex = { command: "codex-acp", args: [] }
      const jev = assistantJevAgentSchema.parse({ kind: "jev", settings: {} })
      const bridge: AssistantBridge = {
        ...f.bridge,
        async connect(input) {
          const result = await f.bridge.connect(input)
          if (!result.ok) return result
          return {
            ...result,
            value: { ...result.value, canResume: !("kind" in input.agent) },
          }
        },
      }
      let chat = createNativeChatController({ projectId, bridge, storage: disk })
      chat.start()
      try {
        expect(await chat.connect(codex)).toBe(true)
        await chat.flushHistory()
        const store = historyStoreFor(disk)
        if (retrySave) store.commitFailure = new Error("Temporary history write failure")
        expect(await chat.connect(jev)).toBe(true)
        expect(f.connects.at(-1)?.resumeSessionId).toBeUndefined()
        await chat.flushHistory()
        if (retrySave) {
          expect(chat.getSnapshot().storageFailed).toBe(true)
          store.commitFailure = undefined
          await chat.retryHistory()
          expect(chat.getSnapshot().storageFailed).toBe(false)
        }
        expect((await readChatHistory(projectId, disk))?.agentSession).toBeUndefined()
        if (reload) {
          chat.dispose()
          chat = createNativeChatController({ projectId, bridge, storage: disk })
          chat.start()
        }
        expect(await chat.connect(codex)).toBe(true)
        expect(f.connects.at(-1)?.resumeSessionId).toBeUndefined()
        const sessionId = f.snapshot().sessionId ?? undefined
        expect(sessionId).toBeDefined()
        expect(chat.getSnapshot().snapshot).toHaveProperty("sessionId", sessionId)
        await chat.disconnect()
        expect(await chat.connect(codex)).toBe(true)
        expect(f.connects.at(-1)?.resumeSessionId).toBe(sessionId)
      } finally {
        chat.dispose()
      }
    },
  )
  it("recovers same-agent resume after initial history loading and agent startup both fail", async () => {
    const f = fixture()
    const disk = storage()
    const codex = { command: "codex-acp", args: [] }
    const seed = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    seed.start()
    expect(await seed.connect(codex)).toBe(true)
    await seed.flushHistory()
    const sessionId = f.snapshot().sessionId ?? undefined
    expect(sessionId).toBeDefined()
    seed.dispose()
    const store = historyStoreFor(disk)
    store.failure = new Error("Temporary history read failure")
    let failStartup = true
    const bridge: AssistantBridge = {
      ...f.bridge,
      connect: async (input) =>
        failStartup ? { ok: false, code: "initialization-failed" } : f.bridge.connect(input),
    }
    const chat = createNativeChatController({ projectId, bridge, storage: disk })
    chat.start()
    try {
      expect(await chat.connect(codex)).toBe(false)
      expect(chat.getSnapshot().storageFailed).toBe(true)
      store.failure = undefined
      await chat.retryHistory()
      expect(chat.getSnapshot().storageFailed).toBe(false)
      failStartup = false
      expect(await chat.connect(codex)).toBe(true)
      expect(f.connects.at(-1)?.resumeSessionId).toBe(sessionId)
    } finally {
      chat.dispose()
    }
  })
  it.each(["reset", "reconnect"] as const)(
    "never reconnects disposed project A after its pending %s disconnect releases",
    async (action) => {
      const f = fixture(),
        disk = storage()
      const first = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
      first.start()
      await first.connect(agent)
      f.emit({
        projectId,
        sessionToken: f.snapshot().sessionToken,
        type: "text",
        text: "Saved project A",
      })
      const release = f.deferDisconnect()
      const pending =
        action === "reset" ? first.reset() : first.connect({ ...agent, args: ["--replacement"] })
      if (action === "reconnect") expect(first.getSnapshot().connecting).toBe(true)
      first.dispose()
      const second = createNativeChatController({
        projectId: otherProjectId,
        bridge: f.bridge,
        storage: disk,
      })
      second.start()
      await second.connect(agent)
      const current = second.getSnapshot().snapshot
      if (!current) throw new Error("Expected project B to remain connected.")
      release()
      await pending
      expect(f.connects.map((input) => input.projectId)).toEqual([projectId, otherProjectId])
      expect(second.getSnapshot().snapshot).toBe(current)
      expect(f.snapshot()).toBe(current)
      expect(
        (await readChatHistory(projectId, disk))?.messages.map((message) => message.text),
      ).toEqual(["Saved project A"])
      second.dispose()
    },
  )
  it("keeps a newer settings reconnect and its history when an older reset finishes", async () => {
    const f = fixture(),
      disk = storage()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
    chat.start()
    await chat.connect(agent)
    const release = f.deferDisconnect()
    const reset = chat.reset()
    const replacement = { ...agent, args: ["--new-settings"] }
    await chat.connect(replacement)
    const current = chat.getSnapshot().snapshot
    f.emit({
      projectId,
      sessionToken: f.snapshot().sessionToken,
      type: "text",
      text: "New settings response",
    })
    release()
    await reset
    expect(f.connects).toHaveLength(2)
    expect(f.connects.at(-1)?.agent).toEqual(replacement)
    expect(chat.getSnapshot().snapshot).toBe(current)
    expect(chat.getSnapshot().messages.map((message) => message.text)).toEqual([
      "New settings response",
    ])
    expect((await readChatHistory(projectId, disk))?.agentSession?.agent).toEqual(replacement)
    chat.dispose()
  })
  it("does not let a stale reconnect unlock the newer connection created by reset", async () => {
    const f = fixture()
    const chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const release = f.deferDisconnect()
    const replacement = { ...agent, args: ["--replacement"] }
    const obsolete = chat.connect(replacement)
    const connection = f.deferConnect()
    const reset = chat.reset()
    await connection.started
    release()
    await obsolete
    expect(chat.getSnapshot().connecting).toBe(true)
    await chat.connect(replacement)
    expect(f.connects).toHaveLength(2)
    connection.release()
    await reset
    expect(chat.getSnapshot().connecting).toBe(false)
    expect(f.connects.at(-1)?.resumeSessionId).toBeUndefined()
    await chat.connect(replacement)
    expect(f.connects).toHaveLength(3)
    expect(chat.getSnapshot().connecting).toBe(false)
    chat.dispose()
  })
  it("reports corrupt, cross-project and unavailable legacy storage", async () => {
    const disk = storage()
    expect(
      writeLegacyChatHistory(
        projectId,
        [{ id: crypto.randomUUID(), role: "user", text: "saved" }],
        disk,
      ),
    ).toBe(true)
    const raw = disk.getItem(`vibeshape.project-chat.v1.${projectId}`)
    disk.setItem(`vibeshape.project-chat.v1.${otherProjectId}`, raw ?? "")
    await expect(readChatHistory(otherProjectId, disk)).rejects.toThrow()
    disk.setItem(`vibeshape.project-chat.v1.${projectId}`, "{")
    await expect(readChatHistory(projectId, disk)).rejects.toThrow()
    disk.setItem(`vibeshape.project-chat.v1.${projectId}`, " ".repeat(750_001))
    await expect(readChatHistory(projectId, disk)).rejects.toThrow()
    const denied = {
      ...disk,
      setItem() {
        throw new Error("quota")
      },
    }
    expect(writeLegacyChatHistory(projectId, [], denied)).toBe(false)
  })
  it("queues concurrent permission requests and removes only the resolved request even out of order", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const scope = { projectId, sessionToken: f.snapshot().sessionToken }
    const request = (requestId: string) =>
      f.emit({
        ...scope,
        type: "permission",
        requestId,
        title: requestId,
        canAllow: true,
        expiresAt: Date.now() + 30_000,
      })
    request("A")
    request("B")
    expect(chat.getSnapshot().permission?.requestId).toBe("A")
    f.emit({ ...scope, type: "permission-resolved", requestId: "B" })
    expect(chat.getSnapshot().permission?.requestId).toBe("A")
    request("C")
    f.emit({ ...scope, type: "permission-resolved", requestId: "A" })
    expect(chat.getSnapshot().permission?.requestId).toBe("C")
    await chat.respondPermission(true)
    expect(f.permissions).toEqual([{ ...scope, requestId: "C", allow: true }])
    expect(chat.getSnapshot().permission).toBeNull()
    chat.dispose()
  })
  it("flushes every pending permission on completion, cancellation, reset and disconnect", async () => {
    const f = fixture(),
      chat = createNativeChatController({ projectId, bridge: f.bridge, storage: storage() })
    chat.start()
    await chat.connect(agent)
    const request = () => {
      const scope = { projectId, sessionToken: f.snapshot().sessionToken }
      for (const requestId of ["A", "B"])
        f.emit({
          ...scope,
          type: "permission",
          requestId,
          title: requestId,
          canAllow: true,
          expiresAt: Date.now() + 30_000,
        })
      return scope
    }
    const first = request()
    f.emit({ ...first, type: "completed", stopReason: "end_turn" })
    expect(chat.getSnapshot().permission).toBeNull()
    request()
    await chat.cancel()
    expect(chat.getSnapshot().permission).toBeNull()
    request()
    await chat.reset()
    expect(chat.getSnapshot().permission).toBeNull()
    f.emit({ ...first, type: "permission-resolved", requestId: "A" })
    expect(chat.getSnapshot().permission).toBeNull()
    request()
    await chat.disconnect()
    expect(chat.getSnapshot().permission).toBeNull()
    chat.dispose()
  })
})
