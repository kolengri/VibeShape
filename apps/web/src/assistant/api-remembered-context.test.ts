import { expect, it } from "bun:test"
import { budgetApiContext, rememberedContext } from "./api-remembered-context"
import type { ChatMessage } from "./chat-history"

it("restores coherent conversation beyond twenty messages independently of display retention", () => {
  const messages = Array.from(
    { length: 80 },
    (_, i): ChatMessage => ({
      id: crypto.randomUUID(),
      role: i % 2 ? "assistant" : "user",
      text: `message ${i}`,
    }),
  )
  expect(rememberedContext(messages)).toEqual({
    messages: messages.map(({ role, text }) => ({
      role: role === "user" ? ("user" as const) : ("assistant" as const),
      content: text,
    })),
    omittedMessages: 0,
  })
})
it("excludes complete old turns under an explicit byte budget without orphaning tool calls", () => {
  const messages = [
    { role: "user" as const, content: "old".repeat(180_000) },
    {
      role: "assistant" as const,
      content: null,
      tool_calls: [
        { id: "call", type: "function" as const, function: { name: "read", arguments: "{}" } },
      ],
    },
    { role: "tool" as const, content: "old result", tool_call_id: "call" },
    { role: "assistant" as const, content: "old answer" },
    { role: "user" as const, content: "recent" },
    { role: "assistant" as const, content: "recent answer" },
  ]
  expect(budgetApiContext(messages)).toEqual({ messages: messages.slice(4), omittedMessages: 4 })
  expect(messages[0]?.content?.length).toBe(540_000)
})
it("counts UTF-8 bytes rather than allowing multibyte content to exceed the request budget", () => {
  const messages = [
    { role: "user" as const, content: "界".repeat(180_000) },
    { role: "assistant" as const, content: "answer" },
  ]
  expect(budgetApiContext(messages)).toEqual({ messages: [], omittedMessages: 2 })
})

it("restores saved tool display evidence without fabricating provider tool calls or replaying private thoughts", () => {
  const result = rememberedContext([
    { id: crypto.randomUUID(), role: "user", text: "Make a bracket" },
    { id: crypto.randomUUID(), role: "thought", text: "private reasoning" },
    {
      id: crypto.randomUUID(),
      role: "tool",
      text: "Saved a box",
      tool: { title: "add feature", status: "completed" },
    },
    { id: crypto.randomUUID(), role: "assistant", text: "Done" },
  ])
  expect(result.omittedMessages).toBe(0)
  expect(result.messages).toHaveLength(3)
  expect(result.messages[1]?.role).toBe("assistant")
  expect(result.messages[1]?.content).toContain("Saved a box")
  expect(JSON.stringify(result.messages)).not.toContain("private reasoning")
  expect(JSON.stringify(result.messages)).not.toContain("tool_call_id")
})

it.each(["", "Use these dimensions"])(
  "marks unavailable restored attachments without creating an empty user turn: %s",
  (text) => {
    const result = rememberedContext([
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        attachments: [{ id: "file", name: "dimensions.txt" }],
      },
      { id: crypto.randomUUID(), role: "assistant", text: "Received" },
    ])
    expect(result.omittedMessages).toBe(0)
    expect(result.messages).toHaveLength(2)
    const content = result.messages[0]?.content
    expect(content).toContain('"unavailableAttachments":["dimensions.txt"]')
    expect(content).toContain("Ask the user to attach these files again")
    if (text) expect(content).toStartWith(`${text}\n\n`)
  },
)
