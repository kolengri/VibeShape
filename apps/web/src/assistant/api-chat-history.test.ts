import { expect, it } from "bun:test"
import { createApiChatController } from "./api-chat-controller"
import type { ChatMessage } from "./chat-history"
import { MemoryTranscriptStore } from "./chat-history.test-fixture"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
it("reopens a full long transcript, budgets complete API turns visibly, and retains the next long response", async () => {
  const store = new MemoryTranscriptStore()
  const messages = Array.from(
    { length: 210 },
    (_, i): ChatMessage => ({
      id: crypto.randomUUID(),
      role: i % 2 ? "assistant" : "user",
      text: `${i}:${"x".repeat(i === 5 ? 80_000 : 5_000)}`,
    }),
  )
  await store.commit({
    projectId,
    expectedRevision: 0,
    upserts: messages.map((value, position) => ({
      id: value.id,
      position,
      value: { id: value.id, role: value.role, text: value.text },
    })),
    deletedIds: [],
  })
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("No synchronous transcript writes")
    },
    removeItem: () => {},
  }
  let request = ""
  const chat = createApiChatController({
    projectId,
    storage,
    historyStore: store,
    createTools: () => ({ execute: async () => ({}), isActive: () => true, dispose: () => {} }),
    fetch: async (_input, init) => {
      request = String(init?.body)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "a".repeat(60_000) }, finish_reason: "stop" }],
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    },
  })
  await chat.connect({
    endpoint: "https://provider.example.test/v1/chat/completions",
    model: "fixture",
    stream: false,
    apiKey: "runtime-secret",
  })
  expect(chat.getSnapshot().messages).toEqual(messages)
  expect(chat.getSnapshot().contextOmittedMessages).toBeGreaterThan(0)
  expect(await chat.send("continue")).toBe(true)
  while (chat.getSnapshot().busy) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await chat.flushHistory()
  expect(chat.getSnapshot().messages.at(-1)?.text).toHaveLength(60_000)
  const wire = JSON.parse(request).messages
  expect(wire.some((entry: { content: string }) => entry.content === messages[0]?.text)).toBe(false)
  expect(wire.find((value: { role: string }) => value.role !== "system")?.role).toBe("user")
  chat.dispose()
  const reopened = createApiChatController({
    projectId,
    storage,
    historyStore: store,
    createTools: () => ({ execute: async () => ({}), isActive: () => true, dispose: () => {} }),
  })
  await reopened.flushHistory()
  expect(reopened.getSnapshot().messages.slice(0, 210)).toEqual(messages)
  expect(reopened.getSnapshot().messages).toHaveLength(212)
  expect(reopened.getSnapshot().messages.at(-1)?.text).toHaveLength(60_000)
  const saved = await store.load(projectId)
  expect(JSON.stringify(saved)).not.toContain("runtime-secret")
  reopened.dispose()
})
