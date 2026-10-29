import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"

export const projectChatCursorSchema = z.strictObject({
  projectId: documentIdSchema,
  conversationId: z.uuid(),
  transcriptRevision: revisionSchema,
  messageIndex: z.number().int().nonnegative().safe(),
  textOffset: z.number().int().nonnegative().safe(),
})
export const readProjectChatArgumentsSchema = z.strictObject({
  expectedProjectId: documentIdSchema,
  cursor: projectChatCursorSchema.optional(),
})
export const projectChatPageSchema = z
  .strictObject({
    projectId: documentIdSchema,
    conversationId: z.uuid(),
    transcriptRevision: revisionSchema,
    source: z.literal("persisted"),
    messages: z
      .array(
        z.strictObject({
          id: z.uuid(),
          role: z.enum(["user", "assistant", "thought", "tool"]),
          text: z.string().max(16000),
          messageIndex: z.number().int().nonnegative().safe(),
          textOffset: z.number().int().nonnegative().safe(),
          complete: z.boolean(),
          tool: z
            .strictObject({
              title: z.string().max(512).optional(),
              status: z.string().max(512).optional(),
            })
            .optional(),
        }),
      )
      .max(32),
    nextCursor: projectChatCursorSchema.nullable(),
  })
  .refine(
    (page) =>
      page.messages.reduce(
        (total, message) =>
          total +
          message.text.length +
          (message.tool?.title?.length ?? 0) +
          (message.tool?.status?.length ?? 0),
        0,
      ) <= 16000,
    "The transcript page exceeds its display text budget.",
  )

type ChatPage = z.infer<typeof projectChatPageSchema>
type ChatCursor = z.infer<typeof projectChatCursorSchema>
type ChatSnapshotIdentity = {
  projectId: string
  conversationId: string
  transcriptRevision: number
}

export function projectChatSnapshotMatches(
  left: ChatSnapshotIdentity,
  right: ChatSnapshotIdentity,
) {
  return (
    left.projectId === right.projectId &&
    left.conversationId === right.conversationId &&
    left.transcriptRevision === right.transcriptRevision
  )
}

function fragmentStartMatches(page: ChatPage, cursor?: ChatCursor) {
  const first = page.messages[0]
  if (!first) return !cursor
  return (
    first.messageIndex === (cursor?.messageIndex ?? 0) &&
    first.textOffset === (cursor?.textOffset ?? 0)
  )
}

function fragmentsAreOrdered(page: ChatPage) {
  return page.messages.every((message, index) => {
    if (index === 0) return true
    const previous = page.messages[index - 1]
    return (
      previous?.complete &&
      message.messageIndex === previous.messageIndex + 1 &&
      message.textOffset === 0
    )
  })
}

function continuationMatches(page: ChatPage) {
  const last = page.messages.at(-1)
  if (!page.nextCursor) return !last || last.complete
  if (!last) return false
  const next = page.nextCursor
  const messageIndex = last.messageIndex + Number(last.complete)
  const textOffset = last.complete ? 0 : last.textOffset + last.text.length
  return (
    projectChatSnapshotMatches(next, page) &&
    next.messageIndex === messageIndex &&
    next.textOffset === textOffset &&
    (last.complete || last.text.length > 0)
  )
}

function pageContextMatches(
  args: z.infer<typeof readProjectChatArgumentsSchema>,
  page: ChatPage,
  activeProjectId: string,
) {
  if (page.projectId !== activeProjectId || page.projectId !== args.expectedProjectId) return false
  if (args.cursor && !projectChatSnapshotMatches(args.cursor, page)) return false
  return (
    fragmentStartMatches(page, args.cursor) &&
    fragmentsAreOrdered(page) &&
    continuationMatches(page)
  )
}

export function projectChatResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  activeProjectId?: string,
) {
  if (operation.tool !== "read_project_chat" || !result.ok) return true
  const args = readProjectChatArgumentsSchema.safeParse(operation.arguments)
  const page = projectChatPageSchema.safeParse(result.value)
  if (!args.success || !page.success) return false
  return pageContextMatches(args.data, page.data, activeProjectId ?? args.data.expectedProjectId)
}
