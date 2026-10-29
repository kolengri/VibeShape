import { expect, it } from "bun:test"
import {
  localOperationSchema,
  localToolOutputs,
  mcpToolInputJsonSchema,
  parseMcpToolCall,
} from "./local-tools"
import { projectChatResultContextMatches } from "./project-chat"

const projectId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const conversationId = "0195b5ac-b220-7a2c-8c33-67a36a7f6102"
const operation = localOperationSchema.parse({
  tool: "read_project_chat",
  arguments: { expectedProjectId: projectId },
})
const value = {
  projectId,
  conversationId,
  transcriptRevision: 7,
  source: "persisted",
  messages: [
    {
      id: conversationId,
      role: "assistant",
      text: "Saved text",
      messageIndex: 0,
      textOffset: 0,
      complete: true,
    },
  ],
  nextCursor: null,
}
it("advertises an explicit project guard and refuses private/provider inputs", () => {
  expect(mcpToolInputJsonSchema("read_project_chat").required).toEqual(["expectedProjectId"])
  expect(parseMcpToolCall("read_project_chat", {}).success).toBe(false)
  expect(parseMcpToolCall("read_project_chat", { expectedProjectId: projectId }).success).toBe(true)
  for (const field of ["agentSession", "provider", "sessionId", "archiveId", "limit"])
    expect(
      parseMcpToolCall("read_project_chat", { expectedProjectId: projectId, [field]: "untrusted" })
        .success,
    ).toBe(false)
})
it("validates display-only bounded output and correlates project/conversation/revision", () => {
  expect(localToolOutputs.read_project_chat.safeParse({ ok: true, value }).success).toBe(true)
  expect(projectChatResultContextMatches(operation, { ok: true, value }, projectId)).toBe(true)
  expect(
    projectChatResultContextMatches(
      operation,
      { ok: true, value: { ...value, projectId: conversationId } },
      projectId,
    ),
  ).toBe(false)
  expect(
    localToolOutputs.read_project_chat.safeParse({
      ok: true,
      value: { ...value, agentSession: {} },
    }).success,
  ).toBe(false)
  expect(
    localToolOutputs.read_project_chat.safeParse({
      ok: true,
      value: { ...value, messages: [{ ...value.messages[0], text: "a".repeat(16001) }] },
    }).success,
  ).toBe(false)
  const cursor = {
    projectId,
    conversationId,
    transcriptRevision: 6,
    messageIndex: 0,
    textOffset: 0,
  }
  expect(
    projectChatResultContextMatches(
      { tool: "read_project_chat", arguments: { expectedProjectId: projectId, cursor } },
      { ok: true, value },
    ),
  ).toBe(false)
  expect(
    projectChatResultContextMatches(operation, {
      ok: true,
      value: { ...value, nextCursor: { ...cursor, transcriptRevision: 7, messageIndex: 0 } },
    }),
  ).toBe(false)
})
