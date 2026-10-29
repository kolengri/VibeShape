import {
  type LocalOperation,
  localFailure,
  localToolOutputs,
} from "@vibeshape/automation-api/local-tools"
import { projectChatSnapshotMatches } from "@vibeshape/automation-api/project-chat"
import type { TranscriptSnapshot, TranscriptStore } from "@vibeshape/persistence/transcript-store"
import { type ChatMessage, chatMessageSchema } from "../assistant/chat-history"
import { createChatHistoryStore } from "../assistant/chat-history-storage"

type ChatReadOperation = Extract<LocalOperation, { tool: "read_project_chat" }>
type Cursor = NonNullable<ChatReadOperation["arguments"]["cursor"]>
type DisplayMessage = Pick<ChatMessage, "id" | "role" | "text"> & {
  tool?: Pick<NonNullable<ChatMessage["tool"]>, "title" | "status">
}
export type ProjectChatPort = {
  read: (operation: ChatReadOperation, signal?: AbortSignal) => Promise<unknown>
}

function parseDisplayMessages(snapshot: TranscriptSnapshot | null) {
  const messages = (snapshot?.entries ?? []).map(({ id, value }) => {
    const message = chatMessageSchema.parse(value)
    if (message.id !== id) throw new Error("Invalid transcript identity.")
    return { id: message.id, role: message.role, text: message.text, ...fragmentMetadata(message) }
  })
  if (new Set(messages.map((message) => message.id)).size !== messages.length)
    throw new Error("Duplicate transcript identity.")
  return messages
}

function splitsSurrogatePair(text: string, offset: number) {
  return (
    /[\uD800-\uDBFF]/.test(text.charAt(offset - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(offset))
  )
}

function validCursorPosition(messages: readonly DisplayMessage[], cursor?: Cursor) {
  if (!cursor) return true
  const message = messages[cursor.messageIndex]
  if (!message) return false
  return (
    cursor.textOffset <= message.text.length &&
    !splitsSurrogatePair(message.text, cursor.textOffset)
  )
}

function fragmentMetadata(message: ChatMessage) {
  if (!message.tool) return {}
  return { tool: { title: message.tool.title, status: message.tool.status } }
}

function displaySize(message: Pick<ChatMessage, "text" | "tool">) {
  return (
    message.text.length + (message.tool?.title?.length ?? 0) + (message.tool?.status?.length ?? 0)
  )
}

function textFragment(
  message: ChatMessage,
  messageIndex: number,
  textOffset: number,
  budget: number,
) {
  const metadata = fragmentMetadata(message)
  const available = budget - displaySize({ text: "", ...metadata })
  if (available <= 0) return null
  let end = Math.min(message.text.length, textOffset + available)
  if (splitsSurrogatePair(message.text, end)) end--
  if (end === textOffset && textOffset < message.text.length) return null
  return {
    messageIndex,
    id: message.id,
    role: message.role,
    text: message.text.slice(textOffset, end),
    textOffset,
    complete: end === message.text.length,
    ...metadata,
  }
}

function startPosition(start?: Cursor) {
  return { messageIndex: start?.messageIndex ?? 0, textOffset: start?.textOffset ?? 0 }
}

function paginate(messages: readonly DisplayMessage[], start?: Cursor) {
  let { messageIndex, textOffset } = startPosition(start)
  let budget = 16000
  const fragments = []
  while (messageIndex < messages.length && fragments.length < 32) {
    const message = messages[messageIndex]
    if (!message) break
    const fragment = textFragment(message, messageIndex, textOffset, budget)
    if (!fragment) break
    fragments.push(fragment)
    budget -= displaySize(fragment)
    if (fragment.complete) {
      messageIndex++
      textOffset = 0
    } else {
      textOffset += fragment.text.length
      break
    }
  }
  return {
    messages: fragments,
    continuation: messageIndex < messages.length ? { messageIndex, textOffset } : null,
  }
}

function snapshotIdentity(projectId: string, snapshot: TranscriptSnapshot | null) {
  return {
    projectId,
    conversationId: snapshot?.conversationId ?? projectId,
    transcriptRevision: snapshot?.revision ?? 0,
  }
}

/** Read display storage only: loading the assistant owner would migrate or connect it. */
export function createProjectChatPort(options: {
  isAllowed: () => boolean
  readIdentity: () => { id: string; revision: number } | null
  store?: Pick<TranscriptStore, "load">
}): ProjectChatPort {
  type SavedSnapshot = { scope: ReturnType<typeof snapshotIdentity>; messages: DisplayMessage[] }
  let captured: SavedSnapshot | null = null
  function selectSnapshot(fresh: SavedSnapshot, cursor?: Cursor) {
    if (!cursor) {
      captured = fresh
      return fresh
    }
    if (!captured) return null
    if (!projectChatSnapshotMatches(cursor, captured.scope)) return null
    if (
      fresh.scope.projectId !== captured.scope.projectId ||
      fresh.scope.conversationId !== captured.scope.conversationId ||
      fresh.scope.transcriptRevision < captured.scope.transcriptRevision
    )
      return null
    return captured
  }
  function readPage(saved: SavedSnapshot, cursor?: Cursor) {
    if (!validCursorPosition(saved.messages, cursor))
      return localFailure(
        "invalid-cursor",
        "The transcript cursor is outside saved text or splits a Unicode character.",
      )
    const page = paginate(saved.messages, cursor)
    return localToolOutputs.read_project_chat.parse({
      ok: true,
      value: {
        ...saved.scope,
        source: "persisted",
        messages: page.messages,
        nextCursor: page.continuation ? { ...saved.scope, ...page.continuation } : null,
      },
    })
  }
  const load = (id: string) => (options.store ?? createChatHistoryStore()).load(id)
  function allowed(signal?: AbortSignal) {
    return options.isAllowed() && !signal?.aborted
  }
  function stillCurrent(identity: { id: string; revision: number }, signal?: AbortSignal) {
    const current = options.readIdentity()
    return allowed(signal) && current?.id === identity.id && current.revision === identity.revision
  }
  return {
    async read(operation, signal) {
      if (!allowed(signal))
        return localFailure("not-paired", "The project chat requires an active paired connection.")
      const identity = options.readIdentity()
      if (!identity || identity.id !== operation.arguments.expectedProjectId)
        return localFailure("stale-project", "Read model_info again before reading project chat.")
      try {
        const snapshot = await load(identity.id)
        if (!stillCurrent(identity, signal))
          return localFailure("stale-project", "The paired project changed while reading chat.")
        const fresh = {
          messages: parseDisplayMessages(snapshot),
          scope: snapshotIdentity(identity.id, snapshot),
        }
        const saved = selectSnapshot(fresh, operation.arguments.cursor)
        if (!saved)
          return localFailure(
            "stale-transcript",
            "The conversation or captured snapshot changed. Restart reading without a cursor.",
          )
        return readPage(saved, operation.arguments.cursor)
      } catch {
        return localFailure(
          "chat-unavailable",
          "The saved project transcript could not be read or validated.",
        )
      }
    },
  }
}
