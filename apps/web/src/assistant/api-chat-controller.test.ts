import { describe, expect, it } from "bun:test"
import type { ApiToolCall } from "./api-chat-completions"
import { createApiChatController } from "./api-chat-controller"
import type { BrowserToolSession } from "./browser-tool-session"
import { readChatHistory } from "./chat-history"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const otherProjectId = "0195b5ac-b250-7a2c-8c33-000000000102"
const configuration = {
  endpoint: "https://api.example.test/v1/chat/completions",
  model: "user-model",
  stream: true,
  apiKey: "runtime-secret",
}
function disk() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}
function completion(content: string, toolCalls: ApiToolCall[] = []) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: content || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toolCalls.length ? "tool_calls" : "stop",
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  )
}
function call(id: string, name: string, args: unknown): ApiToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } }
}
const toolLabel = (name: string, done: boolean) => `${name}: ${done ? "finished" : "running"}`

describe("browser API project chat", () => {
  it("starts no CAD session or request before Connect and Send, then reuses bounded per-project transcript persistence", async () => {
    const storage = disk()
    let sessions = 0,
      requests = 0,
      released = 0
    const executed: string[] = []
    const chat = createApiChatController({
      projectId,
      storage,
      toolLabel,
      createTools(id) {
        expect(id).toBe(projectId)
        sessions += 1
        return {
          isActive: () => true,
          dispose: () => {
            released += 1
          },
          async execute(name) {
            executed.push(name)
            return { total: 1, tools: [] }
          },
        }
      },
      fetch: async () => {
        requests += 1
        return requests === 1
          ? completion("", [call("tool-1", "discover_cad_tools", { query: "model info" })])
          : completion("The model is ready.")
      },
    })
    chat.start()
    expect(sessions).toBe(0)
    expect(requests).toBe(0)
    await chat.send("Ignored before connect")
    expect(requests).toBe(0)
    await chat.connect(configuration)
    expect(sessions).toBe(1)
    expect(requests).toBe(0)
    await chat.send("Inspect the model")
    expect(executed).toEqual(["discover_cad_tools"])
    expect(chat.getSnapshot()).toMatchObject({ connected: true, busy: false, error: null })
    expect(chat.getSnapshot().messages.map((message) => message.text)).toEqual([
      "Inspect the model",
      "discover_cad_tools: finished",
      "The model is ready.",
    ])
    expect(readChatHistory(projectId, storage)?.messages).toEqual([...chat.getSnapshot().messages])
    expect(readChatHistory(otherProjectId, storage)).toBeNull()
    expect([...storage.values.values()].join()).not.toContain("runtime-secret")
    expect(JSON.stringify(chat.getSnapshot())).not.toContain("runtime-secret")
    chat.dispose()
    expect(released).toBe(1)
  })

  it("stops and disposes owned drafts while ignoring a late response and allowing a new turn", async () => {
    let resolveOld: ((response: Response) => void) | undefined
    let requests = 0,
      executed = 0,
      disposed = 0
    const chat = createApiChatController({
      projectId,
      storage: disk(),
      toolLabel,
      createTools: () => ({
        isActive: () => true,
        async execute() {
          executed += 1
          return {}
        },
        dispose() {
          disposed += 1
        },
      }),
      fetch: async () => {
        requests += 1
        if (requests === 1)
          return new Promise((resolve) => {
            resolveOld = resolve
          })
        return completion("New answer")
      },
    })
    chat.start()
    await chat.connect(configuration)
    const old = chat.send("Old request")
    await chat.send("Duplicate")
    expect(requests).toBe(1)
    await chat.cancel()
    expect(chat.getSnapshot().busy).toBe(false)
    expect(disposed).toBe(1)
    await chat.send("New request")
    resolveOld?.(
      completion("Old late answer", [
        call("late", "call_cad_tool", { name: "create_box", arguments: {} }),
      ]),
    )
    await old
    expect(executed).toBe(0)
    expect(
      chat.getSnapshot().messages.some((message) => message.text.includes("Old late answer")),
    ).toBe(false)
    expect(chat.getSnapshot()).toMatchObject({ connected: true, busy: false, error: null })
    chat.dispose()
  })

  it("revokes a stale or disposed project and never sends its tool calls into another project", async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    let active = true,
      executes = 0,
      disposes = 0
    const tools: BrowserToolSession = {
      isActive: () => active,
      async execute() {
        executes += 1
        return {}
      },
      dispose() {
        active = false
        disposes += 1
      },
    }
    const chat = createApiChatController({
      projectId,
      storage: disk(),
      toolLabel,
      createTools: () => tools,
      fetch: async () =>
        new Promise((resolve) => {
          resolveResponse = resolve
        }),
    })
    chat.start()
    await chat.connect(configuration)
    const pending = chat.send("Create a box")
    chat.dispose()
    resolveResponse?.(
      completion("", [call("old-project", "call_cad_tool", { name: "create_box", arguments: {} })]),
    )
    await pending
    expect(executes).toBe(0)
    expect(disposes).toBe(1)
    expect(chat.getSnapshot().connected).toBe(false)
  })

  it("limits tool loops and contains raw failures without leaking credentials into UI state", async () => {
    let requests = 0,
      disposes = 0
    const chat = createApiChatController({
      projectId,
      storage: disk(),
      toolLabel,
      createTools: () => ({
        isActive: () => true,
        async execute() {
          return {}
        },
        dispose() {
          disposes += 1
        },
      }),
      fetch: async () => completion("", [call(`repeat-${++requests}`, "discover_cad_tools", {})]),
    })
    chat.start()
    await chat.connect(configuration)
    await chat.send("Loop")
    expect(requests).toBe(12)
    expect(chat.getSnapshot()).toMatchObject({ busy: false, error: "turn-limit" })
    expect(disposes).toBe(1)
    const failed = createApiChatController({
      projectId,
      storage: disk(),
      toolLabel,
      createTools: () => ({
        isActive: () => true,
        async execute() {
          return {}
        },
        dispose() {},
      }),
      fetch: async () => {
        throw new Error("private runtime-secret")
      },
    })
    failed.start()
    await failed.connect(configuration)
    await failed.send("Inspect")
    expect(failed.getSnapshot().error).toBe("network")
    expect(JSON.stringify(failed.getSnapshot())).not.toContain("runtime-secret")
    chat.dispose()
    failed.dispose()
  })
})
