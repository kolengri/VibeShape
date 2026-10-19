import { describe, expect, it } from "bun:test"
import type { AssistantAttachment } from "@vibeshape/automation-api/assistant"
import type { ApiToolCall } from "./api-chat-completions"
import { createApiChatController, createApiChatRegistry } from "./api-chat-controller"
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
type Chat = ReturnType<typeof createApiChatController>
async function until(chat: Chat, ready: () => boolean) {
  if (ready()) return
  await new Promise<void>((resolve) => {
    const unsubscribe = chat.subscribe(() => {
      queueMicrotask(() => {
        if (ready()) {
          unsubscribe()
          resolve()
        }
      })
    })
  })
}
const idle = (chat: Chat) => until(chat, () => !chat.getSnapshot().busy)
const textFile = (text: string): AssistantAttachment => ({
  id: "file-1",
  name: "dimensions.txt",
  type: "text",
  mimeType: "text/plain",
  text,
})
function tools(): BrowserToolSession {
  return { isActive: () => true, dispose() {}, execute: async () => ({}) }
}
function deferredApiRequests() {
  const requests: { messages: { role: string; content: string }[] }[] = []
  const replies: ((response: Response) => void)[] = []
  return {
    requests,
    fetch: async (_url: RequestInfo | URL, request?: RequestInit) => {
      requests.push(JSON.parse(String(request?.body)))
      return new Promise<Response>((resolve) => {
        replies.push(resolve)
      })
    },
    respond(index: number, response: Response) {
      const reply = replies[index]
      if (!reply) throw new Error(`Missing deferred API request ${index}`)
      reply(response)
    },
    content(index: number) {
      const content = requests[index]?.messages.at(-1)?.content
      if (content === undefined) throw new Error(`Missing API request content ${index}`)
      return content
    },
  }
}

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
    expect(await chat.send("Inspect the model")).toBe(true)
    await idle(chat)
    expect(executed).toEqual(["discover_cad_tools"])
    expect(chat.getSnapshot()).toMatchObject({ connected: true, busy: false, error: null })
    expect(chat.getSnapshot().messages.map((message) => message.text)).toEqual([
      "Inspect the model",
      expect.stringContaining("discover_cad_tools"),
      "The model is ready.",
    ])
    const tool = chat.getSnapshot().messages.find((message) => message.role === "tool")
    expect(tool?.tool).toEqual({ title: "discover_cad_tools", status: "completed" })
    expect(JSON.parse(tool?.text ?? "null")).toEqual({
      command: "discover_cad_tools",
      arguments: { query: "model info" },
      result: { total: 1, tools: [] },
    })
    expect(readChatHistory(projectId, storage)?.messages).toEqual([...chat.getSnapshot().messages])
    expect(readChatHistory(otherProjectId, storage)).toBeNull()
    expect([...storage.values.values()].join()).not.toContain("runtime-secret")
    expect(JSON.stringify(chat.getSnapshot())).not.toContain("runtime-secret")
    chat.dispose()
    expect(released).toBe(1)
  })

  it("awaits canceled work, ignores late responses, and requires explicit queue resume without overlapping turns", async () => {
    let resolveOld: ((response: Response) => void) | undefined
    let requests = 0,
      executed = 0,
      disposed = 0
    const chat = createApiChatController({
      projectId,
      storage: disk(),
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
    expect(await chat.send("Old request")).toBe(true)
    expect(await chat.enqueue("New request")).toBe(true)
    expect(requests).toBe(1)
    const canceled = chat.cancel()
    expect(chat.getSnapshot().busy).toBe(true)
    expect(disposed).toBe(1)
    resolveOld?.(
      completion("Old late answer", [
        call("late", "call_cad_tool", { name: "create_box", arguments: {} }),
      ]),
    )
    await canceled
    expect(requests).toBe(1)
    expect(chat.getSnapshot()).toMatchObject({
      busy: false,
      queuePaused: true,
      queuedMessages: [{ text: "New request" }],
    })
    expect(await chat.resumeQueue()).toBe(true)
    await idle(chat)
    expect(executed).toBe(0)
    expect(
      chat.getSnapshot().messages.some((message) => message.text.includes("Old late answer")),
    ).toBe(false)
    expect(chat.getSnapshot()).toMatchObject({ connected: true, busy: false, error: null })
    expect(requests).toBe(2)
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
    await idle(chat)
    expect(requests).toBe(12)
    expect(chat.getSnapshot()).toMatchObject({ busy: false, error: "turn-limit" })
    expect(disposes).toBe(1)
    const failed = createApiChatController({
      projectId,
      storage: disk(),
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
    await idle(failed)
    expect(failed.getSnapshot().error).toBe("network")
    expect(JSON.stringify(failed.getSnapshot())).not.toContain("runtime-secret")
    chat.dispose()
    failed.dispose()
  })

  it("preflights UTF-8 file content against the full context before accepting and persists only file metadata", async () => {
    const storage = disk()
    const bodies: { messages: { role: string; content: string }[] }[] = []
    let release: ((response: Response) => void) | undefined
    const chat = createApiChatController({
      projectId,
      storage,
      createTools: tools,
      fetch: async (_url, request) => {
        bodies.push(JSON.parse(String(request?.body)))
        return new Promise((resolve) => {
          release = resolve
        })
      },
    })
    await chat.connect(configuration)
    expect(
      await chat.send("Use the attached dimensions", [
        textFile("private-file-content: width=42 mm"),
      ]),
    ).toBe(true)
    expect(chat.getSnapshot().busy).toBe(true)
    const content = bodies[0]?.messages.at(-1)?.content ?? ""
    expect(content).toContain("dimensions.txt")
    expect(content).toContain("private-file-content: width=42 mm")
    expect(chat.getSnapshot().messages[0]).toMatchObject({
      text: "Use the attached dimensions",
      attachments: [{ id: "file-1", name: "dimensions.txt" }],
    })
    expect(JSON.stringify(chat.getSnapshot())).not.toContain("private-file-content")
    release?.(completion("Accepted dimensions"))
    await idle(chat)
    expect([...storage.values.values()].join()).not.toContain("private-file-content")
    const before = [...chat.getSnapshot().messages]
    expect(await chat.send("Too much data", [textFile("é".repeat(128 * 1024))])).toBe(false)
    expect(chat.getSnapshot()).toMatchObject({ busy: false, error: "context-limit" })
    expect(chat.getSnapshot().messages).toEqual(before)
    expect(bodies).toHaveLength(1)
    expect(
      await chat.send("Image", [
        { id: "image", name: "view.png", type: "image", mimeType: "image/png", data: "iVBORw==" },
      ]),
    ).toBe(false)
    expect(chat.getSnapshot().error).toBe("unsupported-attachment")
    expect(bodies).toHaveLength(1)
    chat.dispose()
  })

  it("drains a bounded FIFO, removes queued messages, and preserves a failed attachment turn until explicit resume", async () => {
    const api = deferredApiRequests()
    const chat = createApiChatController({
      projectId,
      storage: disk(),
      createTools: tools,
      fetch: api.fetch,
    })
    await chat.connect(configuration)
    await chat.send("First")
    for (let index = 0; index < 8; index += 1)
      expect(
        await chat.enqueue(
          `Queued ${index}`,
          index === 1 ? [textFile("retained queued bytes")] : [],
        ),
      ).toBe(true)
    expect(await chat.enqueue("Overflow")).toBe(false)
    expect(chat.getSnapshot().error).toBe("queue-full")
    const removed = chat.getSnapshot().queuedMessages[0]?.id
    if (!removed) throw new Error("Expected the first queued item")
    chat.removeQueued(removed)
    await chat.reset()
    expect(chat.getSnapshot().messages[0]?.text).toBe("First")
    api.respond(0, completion("First done"))
    await until(chat, () => api.requests.length === 2)
    expect(api.content(1)).toContain("Queued 1")
    expect(api.content(1)).toContain("retained queued bytes")
    expect(api.requests).toHaveLength(2)
    api.respond(1, new Response("Unavailable", { status: 503 }))
    await idle(chat)
    expect(chat.getSnapshot()).toMatchObject({ queuePaused: true, error: "endpoint" })
    expect(chat.getSnapshot().queuedMessages[0]?.text).toBe("Queued 1")
    expect(chat.getSnapshot().queuedMessages).toHaveLength(7)
    await chat.disconnect()
    expect(chat.getSnapshot().queuedMessages).toHaveLength(7)
    await chat.connect(configuration)
    expect(api.requests).toHaveLength(2)
    expect(await chat.resumeQueue()).toBe(true)
    await until(chat, () => api.requests.length === 3)
    expect(api.content(2)).toContain("retained queued bytes")
    expect(
      api.requests[2]?.messages.filter(({ role }) => role === "user").map(({ content }) => content),
    ).toEqual(["First", api.content(1)])
    for (const item of chat.getSnapshot().queuedMessages) chat.removeQueued(item.id)
    api.respond(2, completion("Retry done"))
    await idle(chat)
    expect(
      chat
        .getSnapshot()
        .messages.filter((message) => message.role === "user")
        .map((message) => message.text),
    ).toEqual(["First", "Queued 1"])
    expect(api.requests).toHaveLength(3)
    chat.dispose()
  })

  it("discards a failed queued stream before retry without losing completed answers or repeating the prompt", async () => {
    const api = deferredApiRequests()
    const storage = disk()
    const chat = createApiChatController({
      projectId,
      storage,
      createTools: tools,
      fetch: api.fetch,
    })
    await chat.connect(configuration)
    await chat.send("First")
    await chat.enqueue("Queued", [textFile("retry attachment")])
    api.respond(0, completion("Earlier answer"))
    await until(chat, () => api.requests.length === 2)
    let sawPartial = false
    const unsubscribe = chat.subscribe(() => {
      sawPartial ||= chat.getSnapshot().messages.some(({ text }) => text === "Failed partial")
    })
    api.respond(
      1,
      new Response(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Failed partial" }, finish_reason: null }] })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    )
    await idle(chat)
    unsubscribe()
    expect(sawPartial).toBe(true)
    expect(chat.getSnapshot().queuePaused).toBe(true)
    expect(chat.getSnapshot().messages.map(({ text }) => text)).toEqual([
      "First",
      "Earlier answer",
      "Queued",
    ])
    expect(await chat.resumeQueue()).toBe(true)
    await until(chat, () => api.requests.length === 3)
    expect(
      api.requests[2]?.messages.filter(({ role }) => role === "user").map(({ content }) => content),
    ).toEqual(["First", api.content(1)])
    api.respond(2, completion("Complete answer"))
    await idle(chat)
    expect(chat.getSnapshot().messages.map(({ text }) => text)).toEqual([
      "First",
      "Earlier answer",
      "Queued",
      "Complete answer",
    ])
    expect(readChatHistory(projectId, storage)?.messages).toEqual([...chat.getSnapshot().messages])
    chat.dispose()
  })

  it("routes structured model questions to real choices and custom text without invoking the CAD gateway", async () => {
    const requests: { messages: { role: string; content: string }[] }[] = []
    let cadCalls = 0
    const chat = createApiChatController({
      projectId,
      storage: disk(),
      createTools: () => ({
        ...tools(),
        execute: async () => {
          cadCalls += 1
          return {}
        },
      }),
      fetch: async (_url, request) => {
        requests.push(JSON.parse(String(request?.body)))
        return requests.length === 1
          ? completion("", [
              call("question-1", "ask_user_question", {
                message: "Choose a corner treatment",
                fields: [
                  {
                    id: "finish",
                    label: "Finish",
                    required: true,
                    options: [
                      { id: "fillet", name: "Fillet" },
                      { id: "chamfer", name: "Chamfer" },
                    ],
                  },
                  { id: "note", label: "Custom instructions", required: false },
                ],
              }),
            ])
          : completion("I will use your treatment")
      },
    })
    await chat.connect(configuration)
    await chat.send("Plan the corners")
    await until(chat, () => chat.getSnapshot().question !== null)
    expect(chat.getSnapshot().question).toMatchObject({
      message: "Choose a corner treatment",
      fields: [
        { id: "finish", secret: false },
        { id: "note", secret: false },
      ],
    })
    expect(await chat.respondQuestion({ finish: "invented", note: "" })).toBe(false)
    expect(await chat.respondQuestion({ note: "Missing required choice" })).toBe(false)
    expect(await chat.respondQuestion({ finish: "fillet", note: "Use 2 mm" })).toBe(true)
    await idle(chat)
    expect(cadCalls).toBe(0)
    expect(
      JSON.parse(
        requests[1]?.messages.find((message) => message.role === "tool")?.content ?? "null",
      ),
    ).toEqual({ answers: { finish: "fillet", note: "Use 2 mm" } })
    expect(chat.getSnapshot().question).toBeNull()
    chat.dispose()
  })

  it("settles pending structured questions on Stop and keeps queued text for recovery", async () => {
    let requests = 0
    const chat = createApiChatController({
      projectId,
      storage: disk(),
      createTools: tools,
      fetch: async () => {
        requests += 1
        return completion("", [
          call("question", "ask_user_question", {
            message: "What size?",
            fields: [{ id: "size", label: "Size", required: true }],
          }),
        ])
      },
    })
    await chat.connect(configuration)
    await chat.send("Ask me")
    await until(chat, () => chat.getSnapshot().question !== null)
    await chat.enqueue("Do this later")
    await chat.cancel()
    expect(chat.getSnapshot()).toMatchObject({
      busy: false,
      question: null,
      queuePaused: true,
      queuedMessages: [{ text: "Do this later" }],
    })
    expect(
      chat.getSnapshot().messages.find((message) => message.role === "tool")?.tool?.status,
    ).toBe("cancelled")
    expect(await chat.respondQuestion({ size: "10 mm" })).toBe(false)
    expect(requests).toBe(1)
    chat.dispose()
  })
})

describe("retained browser project chats", () => {
  it("blocks release while a project owns work and disposes its idle chat without erasing the shared connection", async () => {
    const resources = new Map<string, { isBusy: () => boolean; dispose: () => void }>()
    let release: ((response: Response) => void) | undefined
    let disposals = 0
    const registry = createApiChatRegistry({
      storage: disk(),
      registerResource(id, resource) {
        resources.set(id, resource)
        return () => {
          resources.delete(id)
        }
      },
      createTools: () => ({
        ...tools(),
        dispose() {
          disposals += 1
        },
      }),
      fetch: async () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    const chat = registry.get(projectId)
    await registry.connect(projectId, configuration)
    await chat.send("Keep working in this project")
    expect(resources.get(projectId)?.isBusy()).toBe(true)
    resources.get(projectId)?.dispose()
    expect(registry.get(projectId)).toBe(chat)
    expect(disposals).toBe(0)
    release?.(completion("Finished"))
    await idle(chat)
    expect(resources.get(projectId)?.isBusy()).toBe(false)
    resources.get(projectId)?.dispose()
    expect(disposals).toBe(1)
    expect(resources.has(projectId)).toBe(false)
    const reopened = registry.get(projectId)
    expect(reopened).not.toBe(chat)
    await registry.activate(projectId)
    expect(reopened.getSnapshot()).toMatchObject({ connected: true, model: "user-model" })
    expect(reopened.getSnapshot().messages.map((message) => message.text)).toEqual([
      "Keep working in this project",
      "Finished",
    ])
    registry.dispose()
  })
  it("retains isolated project controllers and background work while reusing only an explicitly configured connection", async () => {
    const ownedTools: string[] = []
    const executed: string[] = []
    const requests: string[] = []
    const guards = new Map<string, () => boolean>()
    let releaseFirst: ((response: Response) => void) | undefined
    let firstRequests = 0
    let disposals = 0
    const storage = disk()
    const registry = createApiChatRegistry({
      storage,
      registerGuard(id, reader) {
        guards.set(id, reader)
        return () => guards.delete(id)
      },
      createTools(id) {
        ownedTools.push(id)
        return {
          isActive: () => true,
          dispose() {
            disposals += 1
          },
          execute: async () => {
            executed.push(id)
            return { id }
          },
        }
      },
      fetch: async (_url, request) => {
        const body = JSON.parse(String(request?.body))
        const id = String(body.messages[0].content).includes(projectId) ? projectId : otherProjectId
        requests.push(id)
        expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer runtime-secret")
        if (id === projectId && ++firstRequests === 1)
          return new Promise((resolve) => {
            releaseFirst = resolve
          })
        return completion(`Answer for ${id}`)
      },
    })
    const first = registry.get(projectId)
    await registry.activate(projectId)
    expect(first.getSnapshot().connected).toBe(false)
    expect(ownedTools).toHaveLength(0)
    await registry.connect(projectId, configuration)
    await first.send("Inspect first project")
    expect(registry.isBusy()).toBe(true)
    const second = registry.get(otherProjectId)
    await registry.activate(otherProjectId)
    expect(second.getSnapshot().connected).toBe(true)
    await second.send("Inspect second project")
    await idle(second)
    expect(guards.get(projectId)?.()).toBe(true)
    expect(guards.get(otherProjectId)?.()).toBe(false)
    expect(registry.get(projectId)).toBe(first)
    expect(disposals).toBe(0)
    releaseFirst?.(completion("", [call("first-tool", "discover_cad_tools", {})]))
    await idle(first)
    expect(executed).toEqual([projectId])
    expect(requests).toEqual([projectId, otherProjectId, projectId])
    expect(
      second.getSnapshot().messages.some((message) => message.text.includes("first project")),
    ).toBe(false)
    expect(registry.isBusy()).toBe(false)
    expect([...storage.values.values()].join()).not.toContain("runtime-secret")
    await registry.disconnect(otherProjectId)
    await registry.activate(otherProjectId)
    expect(second.getSnapshot().connected).toBe(false)
    registry.dispose()
    expect(disposals).toBe(2)
    expect(guards.size).toBe(0)
  })
})
