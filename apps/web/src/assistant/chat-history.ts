import {
  assistantAgentSchema,
  assistantToolTargetsSchema,
} from "@vibeshape/automation-api/assistant"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"

export const chatMessageSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(["user", "assistant", "thought", "tool"]),
  text: z.string(),
  tool: z
    .strictObject({
      title: z.string().max(512).optional(),
      status: z.string().max(512).optional(),
      hasFailureDetails: z.boolean().optional(),
      targets: assistantToolTargetsSchema.optional(),
    })
    .optional(),
  attachments: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(256),
        name: z.string().min(1).max(512),
      }),
    )
    .max(5)
    .optional(),
})
export const agentChatSessionSchema = z.strictObject({
  agent: assistantAgentSchema,
  sessionId: z.string().min(1).max(256),
})
export const legacyChatHistorySchema = z.strictObject({
  version: z.literal(1),
  projectId: documentIdSchema,
  messages: z
    .array(chatMessageSchema)
    .refine(
      (messages) => new Set(messages.map(({ id }) => id)).size === messages.length,
      "Transcript message identities must be unique.",
    ),
  agentSession: agentChatSessionSchema.optional(),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>
export type AgentChatSession = z.infer<typeof agentChatSessionSchema>
export type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
export const legacyChatHistoryKey = (projectId: string) => `vibeshape.project-chat.v1.${projectId}`

/** Retain the complete display transcript; provider request budgets belong to their adapter. */
export function retainChatMessages(messages: readonly ChatMessage[]) {
  return [...messages]
}
