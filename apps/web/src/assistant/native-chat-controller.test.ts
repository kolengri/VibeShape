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
        authMethods: [],
      }
      const captured = snapshot
      connectStarted?.resolve()
      await connectDelay?.promise
      return { ok: true, value: captured }
    },
    async prompt() {
      const captured = snapshot
      await new Promise<void>((resolve) => {
        resolvePrompt = resolve
      })
      return { ok: true, value: captured }
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

describe("project-scoped agent chat", () => {
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
      "Create box\ncompleted\nReviewed geometry",
    ])
    expect(readChatHistory(otherProjectId, disk)).toBeNull()
    expect(readChatHistory(projectId, disk)?.messages).toEqual([...chat.getSnapshot().messages])
    chat.dispose()
  })
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
