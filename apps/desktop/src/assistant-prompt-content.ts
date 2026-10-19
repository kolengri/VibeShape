import type { ContentBlock } from "@agentclientprotocol/sdk"
import type { AssistantAttachment } from "@vibeshape/automation-api/assistant"
import { projectAssistantContext } from "./assistant-project-context"

function attachmentContent(attachments: readonly AssistantAttachment[]): ContentBlock[] {
  return attachments.map((attachment) =>
    attachment.type === "image"
      ? {
          type: "image",
          mimeType: attachment.mimeType,
          data: attachment.data,
        }
      : {
          type: "resource",
          resource: {
            uri: `attachment://${encodeURIComponent(attachment.id)}/${encodeURIComponent(attachment.name)}`,
            mimeType: attachment.mimeType,
            text: attachment.text,
          },
        },
  )
}

export function assistantPromptContent(
  projectId: string,
  text: string,
  attachments: readonly AssistantAttachment[],
): ContentBlock[] {
  return [
    { type: "text", text: projectAssistantContext(projectId) },
    ...(text.trim() ? [{ type: "text" as const, text }] : []),
    ...attachmentContent(attachments),
  ]
}
