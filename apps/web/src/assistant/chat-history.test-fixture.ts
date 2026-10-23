import type {
  TranscriptArchiveSummary,
  TranscriptPatch,
  TranscriptSnapshot,
  TranscriptStore,
} from "@vibeshape/persistence/transcript-store"
import type { AgentChatSession, ChatMessage, HistoryStorage } from "./chat-history"
import { legacyChatHistoryKey, legacyChatHistorySchema } from "./chat-history"
import { loadChatHistory } from "./chat-history-storage"

export class MemoryTranscriptStore implements TranscriptStore {
  readonly projects = new Map<string, TranscriptSnapshot>()
  readonly patches: TranscriptPatch[] = []
  readonly archives = new Map<
    string,
    Map<string, TranscriptArchiveSummary & { snapshot: TranscriptSnapshot }>
  >()
  failure: Error | undefined
  commitFailure: Error | undefined
  archiveFailure: Error | undefined
  loadGate: Promise<void> | undefined
  resetGate: Promise<void> | undefined
  async load(projectId: string) {
    const saved = structuredClone(this.projects.get(projectId) ?? null)
    await this.loadGate
    if (this.failure) throw this.failure
    return saved
  }
  async commit(patch: TranscriptPatch) {
    if (this.failure || this.commitFailure) throw this.failure ?? this.commitFailure
    const previous = this.projects.get(patch.projectId)
    if ((previous?.revision ?? 0) !== patch.expectedRevision) throw new Error("stale revision")
    const entries = new Map(previous?.entries.map((entry) => [entry.id, entry]))
    for (const id of patch.deletedIds) entries.delete(id)
    for (const entry of patch.upserts) entries.set(entry.id, structuredClone(entry))
    const revision = patch.expectedRevision + 1
    this.projects.set(patch.projectId, {
      revision,
      session: structuredClone(patch.session),
      entries: [...entries.values()].sort((a, b) => a.position - b.position),
    })
    this.patches.push(patch)
    return revision
  }
  async reset(projectId: string, expectedRevision: number, assertCurrent: () => void = () => {}) {
    await this.resetGate
    assertCurrent()
    if (this.failure) throw this.failure
    if ((this.projects.get(projectId)?.revision ?? 0) !== expectedRevision)
      throw new Error("stale revision")
    const revision = expectedRevision + 1
    this.projects.set(projectId, { revision, entries: [] })
    return revision
  }
  async listArchives(projectId: string) {
    if (this.failure || this.archiveFailure) throw this.failure ?? this.archiveFailure
    return [...(this.archives.get(projectId)?.values() ?? [])]
      .map(({ snapshot: _snapshot, ...summary }) => summary)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  }
  private archivedSnapshot(projectId: string, targetId: string | null): TranscriptSnapshot {
    if (targetId === null) return { revision: 0, entries: [] }
    const target = this.archives.get(projectId)?.get(targetId)
    if (!target) throw new Error("missing conversation")
    return structuredClone(target.snapshot)
  }
  // fallow-ignore-next-line unused-class-member -- Invoked through the injected TranscriptStore port.
  async switchConversation(
    projectId: string,
    expectedRevision: number,
    targetId: string | null,
    title: string,
    assertCurrent: () => void = () => {},
    validateSnapshot: (snapshot: TranscriptSnapshot) => void = () => {},
  ) {
    await this.resetGate
    assertCurrent()
    if (this.failure) throw this.failure
    const previous = this.projects.get(projectId)
    if ((previous?.revision ?? 0) !== expectedRevision) throw new Error("stale revision")
    const archives = new Map(this.archives.get(projectId))
    const target = this.archivedSnapshot(projectId, targetId)
    validateSnapshot(previous ?? { revision: expectedRevision, entries: [] })
    validateSnapshot(target)
    if (previous?.entries.length) {
      const id = crypto.randomUUID()
      archives.set(id, { id, title, updatedAt: Date.now(), snapshot: structuredClone(previous) })
    }
    if (targetId !== null) archives.delete(targetId)
    const next = {
      ...target,
      revision: expectedRevision + 1,
    }
    assertCurrent()
    this.archives.set(projectId, archives)
    this.projects.set(projectId, next)
    return structuredClone(next)
  }
}
const stores = new WeakMap<HistoryStorage, MemoryTranscriptStore>()
const controllers = new WeakMap<HistoryStorage, Set<{ flushHistory: () => Promise<void> }>>()
export function historyStoreFor(storage: HistoryStorage) {
  let store = stores.get(storage)
  if (!store) {
    store = new MemoryTranscriptStore()
    stores.set(storage, store)
  }
  return store
}
export function trackHistoryController<T extends { flushHistory: () => Promise<void> }>(
  storage: HistoryStorage,
  controller: T,
) {
  let retained = controllers.get(storage)
  if (!retained) {
    retained = new Set()
    controllers.set(storage, retained)
  }
  retained.add(controller)
  return controller
}
export async function readChatHistory(projectId: string, storage: HistoryStorage) {
  await Promise.all([...(controllers.get(storage) ?? [])].map((chat) => chat.flushHistory()))
  const store = historyStoreFor(storage)
  if (!store.projects.has(projectId) && storage.getItem(legacyChatHistoryKey(projectId)) === null)
    return null
  const saved = await loadChatHistory(projectId, storage, store)
  return saved.messages.length || saved.agentSession
    ? {
        version: 1 as const,
        projectId,
        messages: saved.messages,
        ...(saved.agentSession ? { agentSession: saved.agentSession } : {}),
      }
    : null
}
export function writeLegacyChatHistory(
  projectId: string,
  messages: readonly ChatMessage[],
  storage: HistoryStorage,
  agentSession?: AgentChatSession,
) {
  try {
    const saved = legacyChatHistorySchema.parse({
      version: 1,
      projectId,
      messages,
      ...(agentSession ? { agentSession } : {}),
    })
    storage.setItem(legacyChatHistoryKey(projectId), JSON.stringify(saved))
    return true
  } catch {
    return false
  }
}
