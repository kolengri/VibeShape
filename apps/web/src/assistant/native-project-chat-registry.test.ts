import { describe, expect, it } from "bun:test"
import type {
  AssistantAgent,
  AssistantBridge,
  AssistantEvent,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import { checkpointFixture } from "./assistant-checkpoints.test-fixture"
import { saveAssistantPreferences } from "./assistant-preferences"
import { createNativeProjectChatRegistry } from "./native-project-chat-registry"

function fixture() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const listeners = new Set<(event: AssistantEvent) => void>()
  const snapshots = new Map<string, AssistantSnapshot>()
  const pending = new Map<string, () => void>()
  const connected: string[] = []
  const disconnected: string[] = []
  const result = async (input: { projectId: string }) => {
    const value = snapshots.get(input.projectId)
    if (!value) throw new Error("The test project has no agent session.")
    return { ok: true as const, value }
  }
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    async connect(input) {
      connected.push(input.projectId)
      const value: AssistantSnapshot = {
        projectId: input.projectId,
        sessionToken: `token-${input.projectId}`,
        sessionId: `session-${input.projectId}`,
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
      snapshots.set(input.projectId, value)
      return { ok: true, value }
    },
    async disconnect(input) {
      disconnected.push(input.projectId)
      return result(input)
    },
    async prompt(input) {
      await new Promise<void>((resolve) => pending.set(input.projectId, resolve))
      return result(input)
    },
    async cancel(input) {
      pending.get(input.projectId)?.()
      return result(input)
    },
    authenticate: result,
    setMode: result,
    setModel: result,
    setConfigOption: result,
    respondPermission: result,
    respondQuestion: result,
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    bridge,
    storage,
    connected,
    disconnected,
    emit: (event: AssistantEvent) => {
      for (const listener of listeners) listener(event)
    },
  }
}

describe("native project chat retention", () => {
  it("enables images on automatic startup from legacy Jev preferences without resubmitting settings", async () => {
    const f = fixture()
    saveAssistantPreferences(
      {
        version: 1,
        agent: {
          kind: "jev",
          settings: {
            model: "jev-1.14.0",
            images: false,
            maxSteps: 24,
            minConfidence: 0.5,
            timeoutMs: 60_000,
          },
        },
      },
      f.storage,
    )
    let launched: AssistantAgent | undefined
    const bridge: AssistantBridge = {
      ...f.bridge,
      async connect(input) {
        launched = input.agent
        const result = await f.bridge.connect(input)
        if (result.ok)
          result.value.attachmentCapabilities.images =
            "kind" in input.agent && input.agent.settings.images
        return result
      },
    }
    const registry = createNativeProjectChatRegistry(bridge, f.storage)
    const chat = registry.get("legacy-jev-project")
    const ready = new Promise<void>((resolve) => {
      const unsubscribe = chat.subscribe(() => {
        if (chat.getSnapshot().snapshot?.status === "ready") {
          unsubscribe()
          resolve()
        }
      })
    })
    chat.start()
    await ready
    expect(launched).toMatchObject({ kind: "jev", settings: { images: true } })
    expect(chat.getSnapshot().snapshot?.attachmentCapabilities.images).toBe(true)
    registry.dispose()
  })

  it("preserves connection outcomes through the project facade and rejects a closed registry", async () => {
    const f = fixture()
    let reject = true
    const bridge: AssistantBridge = {
      ...f.bridge,
      async connect(input) {
        return reject ? { ok: false, code: "mcp-client-conflict" } : f.bridge.connect(input)
      },
    }
    const registry = createNativeProjectChatRegistry(bridge, f.storage)
    const chat = registry.get("outcome-project")
    chat.start()
    expect(await chat.connect({ command: "/installed/agent", args: [] })).toBe(false)
    reject = false
    expect(await chat.connect({ command: "/installed/agent", args: [] })).toBe(true)
    registry.dispose()
    expect(await chat.connect({ command: "/installed/agent", args: [] })).toBe(false)
  })

  it("keeps the project busy through accepted save settlement and the explicit checkpoint restore", async () => {
    const f = fixture(),
      model = checkpointFixture()
    const registry = createNativeProjectChatRegistry(f.bridge, f.storage, () => model.host)
    const chat = registry.get("checkpoint-project")
    chat.start()
    await chat.connect({ command: "/installed/agent", args: [] })
    await chat.send("Save a model change")
    model.save()
    const save = model.deferSave()
    await chat.cancel()
    await new Promise<void>((resolve) => {
      if (chat.getSnapshot().settlingCheckpoint) return resolve()
      const release = chat.subscribe(() => {
        if (chat.getSnapshot().settlingCheckpoint) {
          release()
          resolve()
        }
      })
    })
    expect(registry.isBusy()).toBe(true)
    save()
    await new Promise<void>((resolve) => {
      if (chat.getSnapshot().canUndoAgentChanges) return resolve()
      const release = chat.subscribe(() => {
        if (chat.getSnapshot().canUndoAgentChanges) {
          release()
          resolve()
        }
      })
    })
    const resolve = model.deferRestore(),
      pending = chat.undoAgentChanges()
    expect(registry.isBusy()).toBe(true)
    resolve(true)
    expect(await pending).toBe(true)
    expect(registry.isBusy()).toBe(false)
    registry.dispose()
  })

  it("makes the configured agent available per project and preserves background turns and queues", async () => {
    const f = fixture()
    saveAssistantPreferences(
      { version: 1, agent: { command: "/installed/agent", args: ["--acp"] } },
      f.storage,
    )
    const registry = createNativeProjectChatRegistry(f.bridge, f.storage)
    const first = registry.get("project-a")
    const ready = (chat: ReturnType<typeof registry.get>) =>
      new Promise<void>((resolve) => {
        if (chat.getSnapshot().snapshot?.status === "ready") return resolve()
        const unsubscribe = chat.subscribe(() => {
          if (chat.getSnapshot().snapshot?.status === "ready") {
            unsubscribe()
            resolve()
          }
        })
      })
    first.start()
    await ready(first)
    const firstTurn = first.send("Author a box")
    expect(await first.enqueue("Add a fillet")).toBe(true)
    const second = registry.get("project-b")
    second.start()
    await ready(second)
    expect(second.getSnapshot().snapshot?.projectId).toBe("project-b")
    expect(registry.get("project-a")).toBe(first)
    expect(first.getSnapshot().busy).toBe(true)
    expect(first.getSnapshot().queuedMessages.map((message) => message.text)).toEqual([
      "Add a fillet",
    ])
    f.emit({
      projectId: "project-a",
      sessionToken: "token-project-a",
      type: "text",
      text: "Working in A",
    })
    expect(first.getSnapshot().messages.some((message) => message.text === "Working in A")).toBe(
      true,
    )
    expect(second.getSnapshot().messages).toEqual([])
    await second.disconnect()
    second.start()
    expect(f.connected.filter((id) => id === "project-b")).toHaveLength(1)
    expect(f.disconnected).toEqual(["project-b"])
    expect(first.getSnapshot().busy).toBe(true)
    await first.cancel()
    await firstTurn
    expect(first.getSnapshot().queuePaused).toBe(true)
    registry.dispose()
    expect(f.disconnected).toContain("project-a")
  })
})
