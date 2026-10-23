import { expect, it } from "bun:test"
import { createApiChatController } from "./api-chat-controller"
import { MemoryTranscriptStore } from "./chat-history.test-fixture"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const otherProjectId = "0195b5ac-b250-7a2c-8c33-000000000102"
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const configuration = {
  endpoint: "https://provider.example.test/v1/chat/completions",
  model: "fixture",
  stream: false,
  apiKey: "",
}
function fixture(store = new MemoryTranscriptStore(), id = projectId) {
  const requests: string[] = []
  const chat = createApiChatController({
    projectId: id,
    storage,
    historyStore: store,
    createTools: () => ({ execute: async () => ({}), isActive: () => true, dispose: () => {} }),
    fetch: async (_input, init) => {
      requests.push(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Saved reply" }, finish_reason: "stop" }],
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    },
  })
  return { chat, store, requests }
}
async function send(chat: ReturnType<typeof fixture>["chat"], text: string) {
  expect(await chat.send(text)).toBe(true)
  while (chat.getSnapshot().busy) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await chat.flushHistory()
}

it("archives new chats, reopens them after restart, and continues only the selected API context", async () => {
  const first = fixture()
  await first.chat.connect(configuration)
  await send(first.chat, "Design a removable lid")
  const original = first.chat.getSnapshot().messages
  await first.chat.reset()
  expect(first.chat.getSnapshot().messages).toEqual([])
  expect(first.chat.getSnapshot().previousChats.map(({ title }) => title)).toEqual([
    "Design a removable lid",
  ])
  await send(first.chat, "Design a separate hinge")
  first.chat.dispose()
  await first.chat.flushHistory()

  const reopened = fixture(first.store)
  await reopened.chat.connect(configuration)
  expect(reopened.chat.getSnapshot().messages[0]?.text).toBe("Design a separate hinge")
  const archived = reopened.chat.getSnapshot().previousChats[0]
  expect(archived).toBeDefined()
  expect(await reopened.chat.openChat(archived?.id ?? "")).toBe(true)
  expect(reopened.chat.getSnapshot().messages).toEqual(original)
  expect(reopened.chat.getSnapshot().previousChats.map(({ title }) => title)).toEqual([
    "Design a separate hinge",
  ])
  await send(reopened.chat, "Continue the lid")
  expect(reopened.requests.at(-1)).toContain("Design a removable lid")
  expect(reopened.requests.at(-1)).not.toContain("Design a separate hinge")
  reopened.chat.dispose()
})

it("keeps live and saved messages on failed switching and rejects another project's archive", async () => {
  const f = fixture()
  await f.chat.connect(configuration)
  await send(f.chat, "Keep this conversation")
  const original = f.chat.getSnapshot().messages
  f.store.commitFailure = new Error("Disk full")
  await f.chat.reset()
  expect(f.chat.getSnapshot().messages).toEqual(original)
  expect(f.chat.getSnapshot().storageFailed).toBe(true)
  expect(await f.store.listArchives(projectId)).toEqual([])
  f.store.commitFailure = undefined
  await f.chat.retryHistory()

  const other = fixture(f.store, otherProjectId)
  await other.chat.connect(configuration)
  await send(other.chat, "Private other project")
  await other.chat.reset()
  const foreign = other.chat.getSnapshot().previousChats[0]
  expect(await f.chat.openChat(foreign?.id ?? "")).toBe(false)
  expect(f.chat.getSnapshot().messages).toEqual(original)
  expect((await f.store.load(projectId))?.entries.map(({ value }) => value)).toEqual(
    original.map(({ id, role, text }) => ({ id, role, text })),
  )
  f.chat.dispose()
  other.chat.dispose()
})

it("admits one switch at a time and prevents sending into the conversation being archived", async () => {
  const f = fixture()
  await f.chat.connect(configuration)
  await send(f.chat, "Original")
  let release = () => {}
  f.store.resetGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const switching = f.chat.reset()
  expect(f.chat.getSnapshot().switchingChat).toBe(true)
  expect(await f.chat.send("Must not cross conversations")).toBe(false)
  await f.chat.reset()
  release()
  await switching
  expect(f.chat.getSnapshot().switchingChat).toBe(false)
  expect(f.chat.getSnapshot().messages).toEqual([])
  expect(f.chat.getSnapshot().previousChats).toHaveLength(1)
  f.chat.dispose()
})

it("rejects stale API history retries after another client activates a different archived chat", async () => {
  const first = fixture()
  await first.chat.connect(configuration)
  await send(first.chat, "Conversation B")
  await first.chat.reset()
  const archivedB = first.chat.getSnapshot().previousChats[0]
  if (!archivedB) throw new Error("Expected conversation B in history")
  await send(first.chat, "Conversation A")
  const stale = fixture(new MemoryTranscriptStore(first.store))
  await stale.chat.connect(configuration)
  expect(stale.chat.getSnapshot().messages).toEqual(first.chat.getSnapshot().messages)
  expect(await first.chat.openChat(archivedB.id)).toBe(true)
  const active = await first.store.load(projectId)
  const archives = await first.store.listArchives(projectId)
  await send(stale.chat, "Continue stale A")
  expect(stale.requests.at(-1)).toContain("Conversation A")
  expect(stale.requests.at(-1)).not.toContain("Conversation B")
  const local = stale.chat.getSnapshot().messages
  expect(stale.chat.getSnapshot().storageFailed).toBe(true)
  await stale.chat.retryHistory()
  expect(stale.chat.getSnapshot().storageFailed).toBe(true)
  expect(stale.chat.getSnapshot().messages).toEqual(local)
  expect(await first.store.load(projectId)).toEqual(active)
  expect(await first.store.listArchives(projectId)).toEqual(archives)
  first.chat.dispose()
  stale.chat.dispose()
})
