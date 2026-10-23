import type { TranscriptArchiveSummary } from "@vibeshape/persistence/transcript-store"
import type { AgentChatSession, ChatMessage, HistoryStorage } from "./chat-history"
import { legacyChatHistoryKey } from "./chat-history"
import {
  type ChatHistoryStore,
  createChatHistoryStore,
  loadChatHistory,
  parseChatHistory,
  writeChatHistory,
} from "./chat-history-storage"

const queues = new WeakMap<ChatHistoryStore, Map<string, Promise<unknown>>>()
function serialize<T>(
  store: ChatHistoryStore,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let projects = queues.get(store)
  if (!projects) {
    projects = new Map()
    queues.set(store, projects)
  }
  const pending = (projects.get(projectId) ?? Promise.resolve()).catch(() => {}).then(operation)
  projects.set(projectId, pending)
  return pending
}

type Snapshot = { messages: readonly ChatMessage[]; agentSession?: AgentChatSession | undefined }
export function createChatHistoryCoordinator(options: {
  projectId: string
  storage: HistoryStorage
  store?: ChatHistoryStore | undefined
  current: () => Snapshot
  restored: (saved: Snapshot & { replace?: boolean }) => void
  archived?: (chats: readonly TranscriptArchiveSummary[]) => void
  failed: (failed: boolean) => void
}) {
  const store = options.store ?? createChatHistoryStore()
  let revision = 0
  let conversationId: string | undefined
  let persisted: readonly ChatMessage[] = []
  let loaded = false
  let loadFailed = false
  let archivesFailed = false
  let epoch = 0
  let dirty = false
  let resetting = false
  let running: Promise<void> = Promise.resolve()
  const restore = (saved: Awaited<ReturnType<typeof loadChatHistory>>) => {
    if (conversationId !== undefined && saved.conversationId !== conversationId)
      throw new Error("The active conversation changed in another writer.")
    const current = options.current()
    const liveIds = new Set(current.messages.map(({ id }) => id))
    const removedIds = new Set(persisted.filter(({ id }) => !liveIds.has(id)).map(({ id }) => id))
    revision = saved.revision
    conversationId = saved.conversationId
    persisted = saved.messages
    loaded = true
    loadFailed = false
    options.restored({
      messages: [
        ...saved.messages.filter(({ id }) => !liveIds.has(id) && !removedIds.has(id)),
        ...current.messages,
      ],
      agentSession: current.agentSession ?? saved.agentSession,
    })
  }
  const refreshArchives = async () => {
    try {
      const chats = await store.listArchives(options.projectId)
      options.archived?.(chats)
      archivesFailed = false
    } catch {
      archivesFailed = true
    }
    options.failed(archivesFailed)
  }
  const load = async () => {
    restore(await loadChatHistory(options.projectId, options.storage, store))
    await refreshArchives()
  }
  const ready = serialize(store, options.projectId, load).catch(() => {
    loadFailed = true
    options.failed(true)
  })
  async function flush(changing = false) {
    await ready
    if (!loaded || loadFailed) return
    while (dirty && (!resetting || changing)) {
      dirty = false
      const at = epoch
      const snapshot = options.current()
      try {
        const next = await writeChatHistory(
          options.projectId,
          snapshot.messages,
          store,
          revision,
          persisted,
          snapshot.agentSession,
        )
        revision = next
        if (at === epoch) persisted = snapshot.messages
        options.failed(archivesFailed)
      } catch {
        dirty = true
        options.failed(true)
        return
      }
    }
  }
  function save() {
    dirty = true
    running = serialize(store, options.projectId, flush)
    return running
  }
  async function reset(isCurrent: () => boolean = () => true) {
    if (resetting) return false
    resetting = true
    // Existing writes settle before the reset transaction; failed resets retain live data.
    epoch += 1
    await ready
    await running
    try {
      if (!loaded || loadFailed) throw new Error("Transcript storage is unavailable.")
      const saved = await serialize(store, options.projectId, () =>
        store.reset(options.projectId, revision, () => {
          if (!isCurrent()) throw new Error("The transcript reset was superseded.")
        }),
      )
      revision = saved.revision
      conversationId = saved.conversationId ?? options.projectId
      persisted = []
      dirty = false
      options.storage.removeItem(legacyChatHistoryKey(options.projectId))
      options.failed(archivesFailed)
      return true
    } catch {
      if (isCurrent()) options.failed(true)
      return false
    } finally {
      resetting = false
    }
  }
  function retry() {
    running = serialize(store, options.projectId, async () => {
      try {
        await load()
        dirty = true
        await flush()
      } catch {
        options.failed(true)
      }
    })
    return running
  }
  async function switchConversation(
    targetId: string | null,
    isCurrent: () => boolean = () => true,
  ) {
    if (resetting) return false
    resetting = true
    await ready
    await running
    try {
      return await serialize(store, options.projectId, async () => {
        if (!loaded || loadFailed || !isCurrent()) return false
        dirty = true
        await flush(true)
        if (dirty || !isCurrent()) return false
        const title =
          options
            .current()
            .messages.find(({ role }) => role === "user")
            ?.text.trim()
            .slice(0, 120) ?? ""
        const saved = parseChatHistory(
          await store.switchConversation(
            options.projectId,
            revision,
            targetId,
            title,
            () => {
              if (!isCurrent()) throw new Error("The conversation switch was superseded.")
            },
            parseChatHistory,
          ),
        )
        revision = saved.revision
        conversationId = saved.conversationId ?? options.projectId
        persisted = saved.messages
        epoch += 1
        dirty = false
        options.restored({ ...saved, replace: true })
        await refreshArchives()
        return true
      })
    } catch {
      if (isCurrent()) options.failed(true)
      return false
    } finally {
      resetting = false
    }
  }
  return { ready, save, flush: () => save(), reset, retry, switchConversation }
}
