import { describe, expect, it } from "bun:test"
import type {
  AssistantBridge,
  AssistantEvent,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import { readChatHistory, writeChatHistory } from "./chat-history"
import { createNativeChatController } from "./native-chat-controller"

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
function fixture() {
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
      const fails = failPrompt
      failPrompt = false
      await new Promise<void>((resolve) => {
        resolvePrompt = resolve
      })
      return fails ? { ok: false, code: "request-failed" } : { ok: true, value: captured }
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

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Expected controller transition did not complete")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe("project-scoped agent chat", () => {
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
    expect(readChatHistory(projectId, disk)?.messages[1]?.attachments).toEqual([
      { id: "attached-file", name: "notes.txt" },
    ])
    expect(JSON.stringify(readChatHistory(projectId, disk))).not.toContain(
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
    expect(readChatHistory(otherProjectId, disk)).toBeNull()
    expect(readChatHistory(projectId, disk)?.messages).toEqual([...chat.getSnapshot().messages])
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
      expect(writeChatHistory(projectId, [historical], disk)).toBe(true)
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
      expect(readChatHistory(projectId, disk)?.messages).toEqual([...chat.getSnapshot().messages])
      const reopened = createNativeChatController({ projectId, bridge: f.bridge, storage: disk })
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
      expect(readChatHistory(projectId, disk)?.messages).toEqual([...chat.getSnapshot().messages])
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
      expect(readChatHistory(projectId, disk)?.messages.map((message) => message.text)).toEqual([
        "Saved project A",
      ])
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
    expect(readChatHistory(projectId, disk)?.agentSession?.agent).toEqual(replacement)
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
  it("handles corrupt, cross-project, oversized and unavailable storage", () => {
    const disk = storage()
    expect(
      writeChatHistory(projectId, [{ id: crypto.randomUUID(), role: "user", text: "saved" }], disk),
    ).toBe(true)
    const raw = disk.getItem(`vibeshape.project-chat.v1.${projectId}`)
    disk.setItem(`vibeshape.project-chat.v1.${otherProjectId}`, raw ?? "")
    expect(readChatHistory(otherProjectId, disk)).toBeNull()
    disk.setItem(`vibeshape.project-chat.v1.${projectId}`, "{")
    expect(readChatHistory(projectId, disk)).toBeNull()
    disk.setItem(`vibeshape.project-chat.v1.${projectId}`, " ".repeat(750_001))
    expect(readChatHistory(projectId, disk)).toBeNull()
    const denied = {
      ...disk,
      setItem() {
        throw new Error("quota")
      },
    }
    expect(writeChatHistory(projectId, [], denied)).toBe(false)
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
