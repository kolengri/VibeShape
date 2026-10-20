import { describe, expect, it } from "bun:test"
import { assistantToolTargetsSchema } from "@vibeshape/automation-api/assistant"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { type ChatMessage, readChatHistory, writeChatHistory } from "./chat-history"

const projectId = documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000101")
const entityId = "0195b5ac-b250-7a2c-8c33-000000000102"
function disk() {
  let value: string | null = null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
  }
}
const oldMessage: ChatMessage = {
  id: "a5d39d65-095e-4de7-abf6-0a55e5ed3607",
  role: "tool",
  text: "Legacy detail",
  tool: { title: "Tool", status: "completed" },
}

describe("assistant history display metadata", () => {
  it.each([true, false])(
    "persists failure evidence independently of retained text: %s",
    (hasFailureDetails) => {
      const storage = disk()
      const message: ChatMessage = {
        ...oldMessage,
        text: "Preparing preview",
        tool: { title: "Preview draft", status: "failed", hasFailureDetails },
      }
      expect(writeChatHistory(projectId, [message], storage)).toBe(true)
      expect(readChatHistory(projectId, storage)?.messages).toEqual([message])
    },
  )
  it("reads the original v1 history unchanged without metadata", () => {
    const storage = disk()
    const history = { version: 1 as const, projectId, messages: [oldMessage] }
    storage.setItem("", JSON.stringify(history))
    expect(readChatHistory(projectId, storage)).toEqual(history)
  })

  it("round-trips semantic feature and sketch IDs independently of detail truncation", () => {
    const storage = disk()
    const targets = assistantToolTargetsSchema.parse({
      projectId,
      featureIds: [entityId],
      sketchIds: [entityId],
    })
    const message = {
      ...oldMessage,
      text: "x".repeat(40_000),
      tool: { ...oldMessage.tool, targets },
    }
    expect(writeChatHistory(projectId, [message], storage)).toBe(true)
    expect(readChatHistory(projectId, storage)?.messages).toEqual([
      { ...message, text: "x".repeat(32_000) },
    ])
  })

  it("rejects invalid or oversized imported target metadata", () => {
    const storage = disk()
    for (const targets of [
      { projectId, featureIds: ["invalid"], sketchIds: [] },
      { projectId, featureIds: [], sketchIds: Array(33).fill(entityId) },
      { projectId, featureIds: [], sketchIds: [], allow: true },
    ]) {
      storage.setItem(
        "",
        JSON.stringify({ version: 1, projectId, messages: [{ ...oldMessage, tool: { targets } }] }),
      )
      expect(readChatHistory(projectId, storage)).toBeNull()
    }
  })
})
