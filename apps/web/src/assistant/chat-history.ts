import {
  assistantAgentSchema,
  assistantToolTargetsSchema,
} from "@vibeshape/automation-api/assistant"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"

const MAX_HISTORY_LENGTH = 750_000
const MAX_MESSAGES = 150
const chatMessageSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(["user", "assistant", "thought", "tool"]),
  text: z.string().max(32_000),
  tool: z
    .strictObject({
      title: z.string().max(512).optional(),
      status: z.string().max(512).optional(),
      hasFailureDetails: z.boolean().optional(),
      targets: assistantToolTargetsSchema.optional(),
    })
    .optional(),
  attachments: z
    .array(z.strictObject({ id: z.string().min(1).max(256), name: z.string().min(1).max(512) }))
    .max(5)
    .optional(),
})
const historySchema = z.strictObject({
  version: z.literal(1),
  projectId: documentIdSchema,
  messages: z.array(chatMessageSchema).max(MAX_MESSAGES),
  agentSession: z
    .strictObject({ agent: assistantAgentSchema, sessionId: z.string().min(1).max(256) })
    .optional(),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>
export type AgentChatSession = NonNullable<z.infer<typeof historySchema>["agentSession"]>
type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
const historyKey = (projectId: string) => `vibeshape.project-chat.v1.${projectId}`

export function readChatHistory(projectId: string, storage: HistoryStorage) {
  try {
    const raw = storage.getItem(historyKey(projectId))
    if (!raw || raw.length > MAX_HISTORY_LENGTH) return null
    const history = historySchema.safeParse(JSON.parse(raw))
    return history.success && history.data.projectId === projectId ? history.data : null
  } catch {
    return null
  }
}

export function retainChatMessages(messages: readonly ChatMessage[]) {
  const retained = messages.slice(-MAX_MESSAGES).map((message) => ({
    ...message,
    text: message.text.slice(0, 32_000),
  }))
  while (retained.length && JSON.stringify(retained).length > MAX_HISTORY_LENGTH - 256)
    retained.shift()
  return retained
}

export function writeChatHistory(
  projectId: string,
  messages: readonly ChatMessage[],
  storage: HistoryStorage,
  agentSession?: AgentChatSession,
) {
  try {
    const history = historySchema.parse({
      version: 1,
      projectId,
      messages: retainChatMessages(messages),
      ...(agentSession ? { agentSession } : {}),
    })
    storage.setItem(historyKey(projectId), JSON.stringify(history))
    return true
  } catch {
    return false
  }
}

export function clearChatHistory(projectId: string, storage: HistoryStorage) {
  try {
    storage.removeItem(historyKey(projectId))
    return true
  } catch {
    return false
  }
}
