import {
  IndexedDbTranscriptStore,
  type TranscriptSnapshot,
  type TranscriptStore,
} from "@vibeshape/persistence/transcript-store"
import { z } from "zod"
import {
  type AgentChatSession,
  agentChatSessionSchema,
  type ChatMessage,
  chatMessageSchema,
  type HistoryStorage,
  legacyChatHistoryKey,
  legacyChatHistorySchema,
} from "./chat-history"

// JSON storage omits optional undefined fields after strict display-schema validation.
function storedJson(value: unknown) {
  return z.json().parse(JSON.parse(JSON.stringify(value)))
}
export type ChatHistoryStore = TranscriptStore
let localStore: IndexedDbTranscriptStore | undefined
export const createChatHistoryStore = () => (localStore ??= new IndexedDbTranscriptStore())

export function parseChatHistory(saved: TranscriptSnapshot) {
  return {
    revision: saved.revision,
    messages: saved.entries.map(({ id, value }) => {
      const message = chatMessageSchema.parse(value)
      if (message.id !== id) throw new Error("The stored transcript message identity is invalid.")
      return message
    }),
    agentSession:
      saved.session === undefined ? undefined : agentChatSessionSchema.parse(saved.session),
  }
}

export async function loadChatHistory(
  projectId: string,
  storage: HistoryStorage,
  store: ChatHistoryStore,
) {
  const saved = await store.load(projectId)
  if (saved) return parseChatHistory(saved)
  const raw = storage.getItem(legacyChatHistoryKey(projectId))
  if (raw === null) return { revision: 0, messages: [], agentSession: undefined }
  const legacy = legacyChatHistorySchema.parse(JSON.parse(raw))
  if (legacy.projectId !== projectId) throw new Error("The legacy transcript project is invalid.")
  const revision = await store.commit({
    projectId,
    expectedRevision: 0,
    upserts: legacy.messages.map((message, position) => ({
      id: message.id,
      position,
      value: storedJson(message),
    })),
    deletedIds: [],
    session: legacy.agentSession ? storedJson(legacy.agentSession) : undefined,
  })
  storage.removeItem(legacyChatHistoryKey(projectId))
  return { revision, messages: legacy.messages, agentSession: legacy.agentSession }
}

export async function writeChatHistory(
  projectId: string,
  messages: readonly ChatMessage[],
  store: ChatHistoryStore,
  revision: number,
  previous: readonly ChatMessage[],
  agentSession?: AgentChatSession,
) {
  const previousById = new Map(
    previous.map((message, position) => [message.id, { message, position }]),
  )
  const currentIds = new Set(messages.map(({ id }) => id))
  if (currentIds.size !== messages.length)
    throw new Error("The transcript contains duplicate message identities.")
  const upserts = messages.flatMap((message, position) => {
    const old = previousById.get(message.id)
    return old?.message === message && old.position === position
      ? []
      : [
          {
            id: message.id,
            position,
            value: storedJson(chatMessageSchema.parse(message)),
          },
        ]
  })
  const deletedIds = previous.filter(({ id }) => !currentIds.has(id)).map(({ id }) => id)
  return store.commit({
    projectId,
    expectedRevision: revision,
    upserts,
    deletedIds,
    session: agentSession ? storedJson(agentChatSessionSchema.parse(agentSession)) : undefined,
  })
}
