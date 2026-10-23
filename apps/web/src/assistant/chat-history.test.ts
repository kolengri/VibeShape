import { describe, expect, it } from "bun:test"
import { type ChatMessage, legacyChatHistoryKey, retainChatMessages } from "./chat-history"
import { MemoryTranscriptStore } from "./chat-history.test-fixture"
import { createChatHistoryCoordinator } from "./chat-history-coordinator"
import { loadChatHistory } from "./chat-history-storage"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const otherProjectId = "0195b5ac-b250-7a2c-8c33-000000000102"
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
function message(text = "message"): ChatMessage {
  return { id: crypto.randomUUID(), role: "user", text }
}
function fixture(store = new MemoryTranscriptStore(), storage = disk(), id = projectId) {
  let messages: readonly ChatMessage[] = []
  let failed = false
  const history = createChatHistoryCoordinator({
    projectId: id,
    store,
    storage,
    current: () => ({ messages }),
    restored: (saved) => {
      messages = saved.messages
    },
    failed: (value) => {
      failed = value
    },
  })
  return {
    history,
    store,
    storage,
    get messages() {
      return messages
    },
    set messages(value: readonly ChatMessage[]) {
      messages = value
    },
    get failed() {
      return failed
    },
  }
}

describe("complete assistant transcript persistence", () => {
  it("round-trips more than 150 messages and 750k characters without truncating long message text", async () => {
    const f = fixture()
    await f.history.ready
    f.messages = Array.from({ length: 210 }, (_, i) =>
      message(`${i}:${"x".repeat(i === 5 ? 80_000 : 5_000)}`),
    )
    const expected = [...f.messages]
    expect(retainChatMessages(expected)).toEqual(expected)
    await f.history.save()
    const reopened = fixture(f.store, f.storage)
    await reopened.history.ready
    expect(reopened.messages).toEqual(expected)
    expect(reopened.messages[5]?.text.length).toBe(80_002)
    expect(f.storage.values.size).toBe(0)
    // Updating one streaming message writes one record, not the entire transcript.
    f.messages = f.messages.map((entry, i) =>
      i === 209 ? { ...entry, text: `${entry.text}tail` } : entry,
    )
    await f.history.save()
    expect(f.store.patches.at(-1)?.upserts).toHaveLength(1)
  })
  it.each([true, false])(
    "migrates strict v1 metadata only after an atomic durable write: %s",
    async (hasFailureDetails) => {
      const store = new MemoryTranscriptStore(),
        storage = disk()
      const original = {
        ...message("old"),
        attachments: [{ id: "view", name: "view.png" }],
        tool: { status: "failed", hasFailureDetails },
      }
      storage.setItem(
        legacyChatHistoryKey(projectId),
        JSON.stringify({ version: 1, projectId, messages: [original] }),
      )
      store.commitFailure = new DOMException("quota", "QuotaExceededError")
      await expect(loadChatHistory(projectId, storage, store)).rejects.toThrow("quota")
      expect(storage.values.size).toBe(1)
      expect(store.projects.size).toBe(0)
      store.commitFailure = undefined
      expect(await store.load(projectId)).toBeNull()
      expect((await loadChatHistory(projectId, storage, store)).messages).toEqual([original])
      expect(storage.values.size).toBe(0)
      expect((await loadChatHistory(projectId, storage, store)).messages).toEqual([original])
    },
  )
  it.each([
    { version: 2, projectId, messages: [] },
    { version: 1, projectId: otherProjectId, messages: [] },
    {
      version: 1,
      projectId,
      messages: [{ ...message(), attachments: [{ id: "raw", name: "raw", data: "private" }] }],
    },
    { version: 1, projectId, messages: [{ ...message(), providerPayload: { secret: "private" } }] },
    {
      version: 1,
      projectId,
      messages: [
        { ...message(), tool: { targets: { projectId, featureIds: ["invalid"], sketchIds: [] } } },
      ],
    },
  ])("preserves corrupt or unsupported legacy data for recovery", async (value) => {
    const storage = disk(),
      store = new MemoryTranscriptStore()
    storage.setItem(legacyChatHistoryKey(projectId), JSON.stringify(value))
    await expect(loadChatHistory(projectId, storage, store)).rejects.toThrow()
    expect(storage.values.size).toBe(1)
    expect(store.projects.size).toBe(0)
  })
  it("merges asynchronous startup with new live events instead of replacing them", async () => {
    const f = fixture()
    await f.history.ready
    f.messages = [message("saved")]
    await f.history.save()
    let release = () => {}
    f.store.loadGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const reopened = fixture(f.store, f.storage)
    reopened.messages = [message("live")]
    const save = reopened.history.save()
    release()
    await save
    expect(reopened.messages.map(({ text }) => text)).toEqual(["saved", "live"])
    expect((await loadChatHistory(projectId, f.storage, f.store)).messages).toEqual([
      ...reopened.messages,
    ])
  })
  it("keeps history on write/reset failure and isolates projects with durable reset tombstones", async () => {
    const f = fixture()
    await f.history.ready
    f.messages = [message("first")]
    await f.history.save()
    const other = fixture(f.store, f.storage, otherProjectId)
    await other.history.ready
    other.messages = [message("second")]
    await other.history.save()
    f.store.failure = new DOMException("quota", "QuotaExceededError")
    f.messages = [...f.messages, message("unsaved")]
    await f.history.save()
    expect(f.failed).toBe(true)
    expect(f.messages).toHaveLength(2)
    expect(await f.history.reset()).toBe(false)
    f.store.failure = undefined
    await f.history.save()
    expect(f.failed).toBe(false)
    expect(await f.history.reset()).toBe(true)
    f.messages = []
    f.storage.setItem(
      legacyChatHistoryKey(projectId),
      JSON.stringify({ version: 1, projectId, messages: [message("stale legacy")] }),
    )
    expect((await loadChatHistory(projectId, f.storage, f.store)).messages).toEqual([])
    expect((await loadChatHistory(otherProjectId, f.storage, f.store)).messages).toEqual([
      ...other.messages,
    ])
  })
  it("does not overwrite unavailable history with a fresh live transcript", async () => {
    const store = new MemoryTranscriptStore()
    store.failure = new Error("unavailable")
    const f = fixture(store)
    await f.history.ready
    f.messages = [message("live")]
    await f.history.save()
    expect(f.failed).toBe(true)
    expect(store.patches).toHaveLength(0)
    expect(f.messages[0]?.text).toBe("live")
  })
  it("rejects concurrent writer revisions without dropping the existing transcript", async () => {
    const first = fixture()
    await first.history.ready
    const second = fixture(first.store, first.storage)
    await second.history.ready
    first.messages = [message("first writer")]
    await first.history.save()
    second.messages = [message("second writer")]
    await second.history.save()
    expect(second.failed).toBe(true)
    expect((await loadChatHistory(projectId, first.storage, first.store)).messages).toEqual([
      ...first.messages,
    ])
  })
})

it("retries a failed load without dropping new live messages", async () => {
  const store = new MemoryTranscriptStore(),
    storage = disk()
  const original = fixture(store, storage)
  await original.history.ready
  original.messages = [message("saved")]
  await original.history.save()
  store.failure = new Error("unavailable")
  const reopened = fixture(store, storage)
  await reopened.history.ready
  reopened.messages = [message("live")]
  store.failure = undefined
  await reopened.history.retry()
  expect(reopened.failed).toBe(false)
  expect(reopened.messages.map(({ text }) => text)).toEqual(["saved", "live"])
})
it("serializes disposal writes ahead of immediate same-project reopen", async () => {
  const store = new MemoryTranscriptStore(),
    storage = disk()
  const first = fixture(store, storage)
  await first.history.ready
  first.messages = [message("last event before closing")]
  void first.history.save()
  const reopened = fixture(store, storage)
  await reopened.history.ready
  expect(reopened.messages).toEqual([...first.messages])
})
it("does not resurrect startup history after a reset transaction completes", async () => {
  const f = fixture()
  await f.history.ready
  f.messages = [message("old")]
  await f.history.save()
  let release = () => {}
  f.store.loadGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reopened = fixture(f.store, f.storage)
  const reset = reopened.history.reset()
  release()
  expect(await reset).toBe(true)
  reopened.messages = []
  await reopened.history.flush()
  expect((await loadChatHistory(projectId, f.storage, f.store)).messages).toEqual([])
})

it("refuses a stale save after another writer resets the project", async () => {
  const f = fixture()
  await f.history.ready
  f.messages = [message("saved")]
  await f.history.save()
  await f.store.reset(projectId, 1)
  f.messages = [...f.messages, message("late event")]
  await f.history.save()
  expect(f.failed).toBe(true)
  expect((await f.store.load(projectId))?.entries).toEqual([])
})

it.each(["role", "identity", "session"] as const)(
  "rejects an archived chat with invalid %s before replacement and keeps subsequent saves working",
  async (corruption) => {
    const f = fixture()
    await f.history.ready
    f.messages = [message("Archived conversation")]
    expect(await f.history.switchConversation(null)).toBe(true)
    f.messages = [message("Keep the active conversation")]
    await f.history.save()
    const archive = [...(f.store.archives.get(projectId)?.values() ?? [])][0]
    if (!archive) throw new Error("Expected an archived conversation")
    const entry = archive.snapshot.entries[0]
    if (!entry) throw new Error("Expected an archived message")
    if (corruption === "session") archive.snapshot.session = { agent: "invalid", sessionId: 42 }
    else
      entry.value = {
        id: corruption === "identity" ? crypto.randomUUID() : entry.id,
        role: corruption === "role" ? "invalid" : "user",
        text: "Invalid archived message",
      }
    const active = [...f.messages]
    expect(await f.history.switchConversation(archive.id)).toBe(false)
    expect(f.failed).toBe(true)
    expect(f.messages).toEqual(active)
    expect((await loadChatHistory(projectId, f.storage, f.store)).messages).toEqual(active)
    expect((await f.store.listArchives(projectId)).map(({ id }) => id)).toEqual([archive.id])
    f.messages = [...active, message("Still saves after rejection")]
    await f.history.save()
    expect(f.failed).toBe(false)
    expect((await loadChatHistory(projectId, f.storage, f.store)).messages).toEqual([...f.messages])
  },
)

it("persists the active chat when an inactive archive cannot be read and retains its retry indication", async () => {
  const f = fixture()
  await f.history.ready
  f.messages = [message("Archived")]
  await f.history.switchConversation(null)
  f.messages = [message("Active")]
  await f.history.save()
  f.store.archiveFailure = new Error("The persisted archive is malformed")
  const reopened = fixture(f.store, f.storage)
  await reopened.history.ready
  expect(reopened.failed).toBe(true)
  reopened.messages = [...reopened.messages, message("Persist despite the unreadable archive")]
  await reopened.history.save()
  expect(reopened.failed).toBe(true)
  expect((await loadChatHistory(projectId, f.storage, f.store)).messages).toEqual([
    ...reopened.messages,
  ])
  await reopened.history.retry()
  expect(reopened.failed).toBe(true)
  f.store.archiveFailure = undefined
  await reopened.history.retry()
  expect(reopened.failed).toBe(false)
  expect(await f.store.listArchives(projectId)).toHaveLength(1)
})

it("rolls back a reset whose project owner changed before the storage transaction", async () => {
  const f = fixture()
  await f.history.ready
  f.messages = [message("keep after switching")]
  await f.history.save()
  let release = () => {},
    current = true
  f.store.resetGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reset = f.history.reset(() => current)
  current = false
  release()
  expect(await reset).toBe(false)
  expect(f.failed).toBe(false)
  expect((await f.store.load(projectId))?.entries).toHaveLength(1)
})
