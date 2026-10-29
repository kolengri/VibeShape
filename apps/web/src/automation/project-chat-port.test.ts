import { expect, it } from "bun:test"
import { localOperationSchema, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import type { TranscriptSnapshot } from "@vibeshape/persistence/transcript-store"
import { createProjectChatPort } from "./project-chat-port"

const projectId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const otherId = "0195b5ac-b220-7a2c-8c33-67a36a7f6102"
const messageId = "0195b5ac-b220-7a2c-8c33-67a36a7f6103"
const conversationId = "0195b5ac-b220-7a2c-8c33-67a36a7f6104"
const snapshot = (text: string): TranscriptSnapshot => ({
  revision: 7,
  conversationId,
  entries: [
    {
      id: messageId,
      position: 0,
      value: {
        id: messageId,
        role: "tool",
        text,
        tool: { title: "Analysis", status: "completed" },
      },
    },
  ],
  session: { agent: "private-provider", sessionId: "secret-session" },
})
function setup(saved: TranscriptSnapshot | null = snapshot("Tool display")) {
  const state = {
    allowed: true,
    identity: { id: projectId, revision: 4 } as { id: string; revision: number } | null,
    saved,
    reads: [] as string[],
    beforeRead: () => {},
  }
  const port = createProjectChatPort({
    isAllowed: () => state.allowed,
    readIdentity: () => state.identity,
    store: {
      load: async (id) => {
        state.reads.push(id)
        state.beforeRead()
        return state.saved
      },
    },
  })
  const read = (args: Record<string, unknown> = {}, signal?: AbortSignal) => {
    const operation = localOperationSchema.parse({
      tool: "read_project_chat",
      arguments: { expectedProjectId: projectId, ...args },
    })
    if (operation.tool !== "read_project_chat") throw new Error("Unexpected operation")
    return port
      .read(operation, signal)
      .then((result) => localToolOutputs.read_project_chat.parse(result))
  }
  return { state, read }
}
it("reads saved display text without reading private agent session fields or invoking writes", async () => {
  const { read, state } = setup()
  const result = await read()
  expect(result).toMatchObject({
    ok: true,
    value: {
      projectId,
      conversationId,
      transcriptRevision: 7,
      source: "persisted",
      messages: [
        {
          role: "tool",
          text: "Tool display",
          complete: true,
          tool: { title: "Analysis", status: "completed" },
        },
      ],
      nextCursor: null,
    },
  })
  expect(JSON.stringify(result)).not.toMatch(
    /secret-session|private-provider|agentSession|sessionId/,
  )
  expect(state.reads).toEqual([projectId])
})
it("returns an empty saved page without creating or migrating a conversation", async () => {
  const { read } = setup(null)
  expect(await read()).toEqual<unknown>({
    ok: true,
    value: {
      projectId,
      conversationId: projectId,
      transcriptRevision: 0,
      source: "persisted",
      messages: [],
      nextCursor: null,
    },
  })
})
it("recovers oversized Unicode tool text in bounded ordered fragments", async () => {
  const text = `${"a".repeat(15982)}😀${"⾃".repeat(33000)}🧰`
  const { read } = setup(snapshot(text))
  let cursor: unknown
  const texts: string[] = []
  let offset = 0
  do {
    const result = await read(cursor ? { cursor } : {})
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.value.messages).toHaveLength(1)
    const fragment = result.value.messages[0]
    if (!fragment) throw new Error("Expected text fragment")
    expect(fragment.textOffset).toBe(offset)
    expect(fragment.text).not.toMatch(/[\uD800-\uDFFF]/u)
    expect(fragment.text.length + 17).toBeLessThanOrEqual(16000)
    texts.push(fragment.text)
    offset += fragment.text.length
    cursor = result.value.nextCursor
  } while (cursor)
  expect(texts.join("")).toBe(text)
  expect(texts.length).toBeGreaterThan(3)
})
it("bounds messages and preserves user/assistant/tool display ordering", async () => {
  const saved = snapshot("")
  saved.entries = Array.from({ length: 35 }, (_, position) => {
    const id = `0195b5ac-b220-7a2c-8c33-${String(position).padStart(12, "0")}`
    return {
      id,
      position,
      value: { id, role: ["user", "assistant", "tool"][position % 3] ?? "user", text: "" },
    }
  })
  const { read } = setup(saved)
  const first = await read()
  if (!first.ok) throw new Error(first.diagnostic.message)
  expect(first.value.messages).toHaveLength(32)
  expect(first.value.nextCursor).toMatchObject({ messageIndex: 32, textOffset: 0 })
  const second = await read({ cursor: first.value.nextCursor })
  expect(second).toMatchObject({
    ok: true,
    value: {
      messages: [{ messageIndex: 32 }, { messageIndex: 33 }, { messageIndex: 34 }],
      nextCursor: null,
    },
  })
})
it.each(["stopped", "unavailable", "foreign", "aborted"])(
  "refuses %s authority before accessing transcripts",
  async (kind) => {
    const { read, state } = setup()
    if (kind === "stopped") state.allowed = false
    if (kind === "unavailable") state.identity = null
    if (kind === "foreign") state.identity = { id: otherId, revision: 4 }
    const result = await read({}, kind === "aborted" ? AbortSignal.abort() : undefined)
    expect(result.ok).toBe(false)
    expect(state.reads).toEqual([])
  },
)
it.each(["stop", "project", "revision", "session"])(
  "refuses a %s change while loading",
  async (kind) => {
    const { read, state } = setup()
    state.beforeRead = () => {
      if (kind === "stop" || kind === "session") state.allowed = false
      if (kind === "project") state.identity = { id: otherId, revision: 4 }
      if (kind === "revision") state.identity = { id: projectId, revision: 5 }
    }
    expect(await read()).toMatchObject({ ok: false, diagnostic: { code: "stale-project" } })
  },
)
it.each(["projectId", "conversationId", "transcriptRevision"])(
  "rejects a changed cursor %s",
  async (field) => {
    const { read } = setup(snapshot("x".repeat(20000)))
    const first = await read()
    if (!first.ok) throw new Error("Expected first page")
    expect(
      await read({
        cursor: {
          ...first.value.nextCursor,
          [field]: field === "transcriptRevision" ? 8 : otherId,
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-transcript" } })
  },
)
it("refuses out-of-range and Unicode-splitting cursors", async () => {
  const { read } = setup(snapshot("a😀b"))
  await read()
  const cursor = {
    projectId,
    conversationId,
    transcriptRevision: 7,
    messageIndex: 0,
    textOffset: 2,
  }
  expect(await read({ cursor })).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-cursor" },
  })
  expect(await read({ cursor: { ...cursor, messageIndex: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-cursor" },
  })
})
it("fails closed on malformed messages rather than returning partial content", async () => {
  const saved = snapshot("valid")
  saved.entries = [
    ...saved.entries,
    {
      id: otherId,
      position: 1,
      value: { id: otherId, role: "assistant", text: "private", rawInput: "forbidden" },
    },
  ]
  const { read } = setup(saved)
  expect(await read()).toMatchObject({ ok: false, diagnostic: { code: "chat-unavailable" } })
})

it("continues one immutable snapshot when tool self-reading appends or updates saved text", async () => {
  const original = "x".repeat(20000)
  const { read, state } = setup(snapshot(original))
  const first = await read()
  if (!first.ok) throw new Error("Expected first page")
  state.saved = snapshot("Updated saved content")
  state.saved.revision = 9
  state.saved.entries = [
    ...state.saved.entries,
    {
      id: otherId,
      position: 1,
      value: { id: otherId, role: "tool", text: "read_project_chat output" },
    },
  ]
  const second = await read({ cursor: first.value.nextCursor })
  expect(second).toMatchObject({
    ok: true,
    value: {
      transcriptRevision: 7,
      messages: [{ text: original.slice(15983), textOffset: 15983, complete: true }],
      nextCursor: null,
    },
  })
  expect(state.reads).toEqual([projectId, projectId])
  const refreshed = await read()
  expect(refreshed).toMatchObject({
    ok: true,
    value: {
      transcriptRevision: 9,
      messages: [{ text: "Updated saved content" }, { text: "read_project_chat output" }],
    },
  })
  expect(await read({ cursor: first.value.nextCursor })).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-transcript" },
  })
})
it.each(["conversation", "missing", "backward"])(
  "rejects a %s saved snapshot during continuation",
  async (kind) => {
    const { read, state } = setup(snapshot("x".repeat(20000)))
    const first = await read()
    if (!first.ok) throw new Error("Expected first page")
    if (kind === "conversation" && state.saved) state.saved.conversationId = otherId
    if (kind === "missing") state.saved = null
    if (kind === "backward" && state.saved) state.saved.revision = 6
    expect(await read({ cursor: first.value.nextCursor })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-transcript" },
    })
  },
)
it("refuses a cursor whose captured snapshot is absent from the new connection", async () => {
  const first = await setup(snapshot("x".repeat(20000))).read()
  if (!first.ok) throw new Error("Expected first page")
  expect(
    await setup(snapshot("x".repeat(20000))).read({ cursor: first.value.nextCursor }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-transcript" } })
})
