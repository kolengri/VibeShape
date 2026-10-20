import type { ApiWireMessage } from "./api-chat-completions"
import type { ChatMessage } from "./chat-history"

// A transport byte budget, not a claim about any provider's token window.
// Leave room inside apiAgentMessages' 256 KiB limit for instructions and the new prompt.
const CONTEXT_BYTES = 128 * 1024
export function budgetApiContext(messages: readonly ApiWireMessage[]) {
  const turns: ApiWireMessage[][] = []
  for (const message of messages) {
    if (message.role === "user") turns.push([])
    turns.at(-1)?.push(message)
  }
  let bytes = 2
  let first = turns.length
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (!turn) continue
    const size = new TextEncoder().encode(JSON.stringify(turn)).byteLength
    if (bytes + size > CONTEXT_BYTES) break
    bytes += size
    first = index
  }
  const selected = turns.slice(first).flat()
  return { messages: selected, omittedMessages: messages.length - selected.length }
}
export function rememberedContext(messages: readonly ChatMessage[]) {
  return budgetApiContext(
    messages.flatMap<ApiWireMessage>((message) => {
      if (message.role === "user" || message.role === "assistant")
        return [{ role: message.role, content: message.text }]
      if (message.role === "tool")
        return [
          {
            role: "assistant",
            content: JSON.stringify({
              savedToolActivity: {
                title: message.tool?.title,
                status: message.tool?.status,
                targets: message.tool?.targets,
                text: message.text,
              },
            }),
          },
        ]
      return []
    }),
  )
}
