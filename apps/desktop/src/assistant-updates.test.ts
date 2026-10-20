import { describe, expect, it } from "bun:test"
import type { SessionUpdate } from "@agentclientprotocol/sdk"
import {
  type AssistantSnapshot,
  assistantEventSchema,
  assistantToolTargetsSchema,
} from "@vibeshape/automation-api/assistant"
import { createAssistantToolTargetTracker, sessionUpdateEvent } from "./assistant-updates"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const featureId = "0195b5ac-b250-7a2c-8c33-000000000102"
const input = {
  draftId: projectId,
  commandId: projectId,
  baseRevision: 0,
  featureId,
  widthMm: 1,
  depthMm: 2,
  heightMm: 3,
}
const snapshot: AssistantSnapshot = {
  projectId,
  sessionToken: "token",
  sessionId: "session",
  status: "prompting",
  canResume: true,
  modes: [],
  models: [],
  currentModeId: null,
  currentModelId: null,
  configOptions: [],
  attachmentCapabilities: { text: false, images: false },
  authMethods: [],
}
const targets = assistantToolTargetsSchema.parse({
  projectId,
  featureIds: [featureId],
  sketchIds: [],
})

describe("native assistant failure evidence", () => {
  const failure = {
    ok: false,
    diagnostic: {
      code: "preview-failed",
      message: "The preview contains an open shell.",
      retryable: false,
    },
  }

  it.each([
    failure,
    { result: failure },
    {
      structuredContent: {
        result: { ok: false, diagnostic: { message: "The preview contains an open shell." } },
      },
    },
    { isError: true, structuredContent: { result: failure } },
    { isError: true, content: [{ type: "text", text: "The preview contains an open shell." }] },
  ])("shows bounded raw failure evidence without ACP display content: %j", (rawOutput) => {
    const f = fixture()
    f.event({ ...start, title: "Preview draft" })
    const failed = f.event({ ...partial, status: "completed", rawOutput })
    expect(failed.status).toBe("failed")
    expect(failed.hasFailureDetails).toBe(true)
    expect(failed.text).toContain("The preview contains an open shell.")
    const completed = f.event({ ...partial, status: "completed", rawOutput: null })
    expect(completed.status).toBe("failed")
    expect(completed.text).toBeUndefined()
    expect(completed.hasFailureDetails).toBe(false)
  })

  it("prefers meaningful ACP display content and falls back when content is empty", () => {
    const f = fixture()
    const event = f.event({
      ...start,
      rawOutput: failure,
      content: [
        { type: "content", content: { type: "text", text: "A detailed provider explanation" } },
      ],
    })
    expect(event.status).toBe("failed")
    expect(event.text).toBe("A detailed provider explanation")
    for (const content of [
      undefined,
      null,
      [],
      [{ type: "content" as const, content: { type: "text" as const, text: " \n " } }],
    ]) {
      const update = {
        ...partial,
        rawOutput: failure,
        ...(content === undefined ? {} : { content }),
      }
      expect(f.event(update).text).toContain("The preview contains an open shell.")
    }
  })

  it("keeps absent reasons empty and scopes sticky failure status to its call and session", () => {
    const f = fixture()
    for (const rawOutput of [undefined, null, { ok: false }, { isError: true }]) {
      const event = f.event({ ...partial, status: "failed", rawOutput })
      expect(event.status).toBe("failed")
      expect(event.text).toBeUndefined()
      expect(event.hasFailureDetails).toBe(false)
    }
    expect(f.event({ ...partial, toolCallId: "other", status: "completed" }).status).toBe(
      "completed",
    )
    expect(
      f.event({ ...partial, status: "completed" }, { ...snapshot, sessionToken: "replacement" })
        .status,
    ).toBe("completed")
    f.event({ ...partial, rawOutput: failure })
    expect(
      f.event({ ...partial, status: "completed" }, { ...snapshot, projectId: featureId }).status,
    ).toBe("completed")
  })

  it("renders supported plain error output without inferring failure from text", () => {
    const f = fixture()
    const event = f.event({
      ...start,
      rawOutput: { error: { message: "x".repeat(40_000), code: -32603 } },
    })
    expect(event.status).toBe("in_progress")
    expect(event.text).toHaveLength(32_000)
    expect(f.event({ ...partial, rawOutput: "A readable reason", status: "failed" }).text).toBe(
      "A readable reason",
    )
    expect(f.event({ ...partial, content: [], rawOutput: undefined }).text).toBeUndefined()
  })
})
const start = {
  sessionUpdate: "tool_call",
  toolCallId: "one",
  title: "Arbitrary prose",
  status: "in_progress",
} as const
const partial = { sessionUpdate: "tool_call_update", toolCallId: "one" } as const
function fixture() {
  const tracker = createAssistantToolTargetTracker()
  return {
    tracker,
    event(update: SessionUpdate, scope = snapshot) {
      const event = assistantEventSchema.parse(sessionUpdateEvent(scope, update, tracker))
      if (event.type !== "tool") throw new Error("Expected a tool event")
      expect(event).not.toHaveProperty("rawInput")
      expect(event).not.toHaveProperty("rawOutput")
      expect(event).not.toHaveProperty("name")
      return event
    },
  }
}

describe("native assistant target producer", () => {
  it("retains programmatic names and per-call targets through null and omitted partial fields", () => {
    const f = fixture()
    expect(f.event({ ...start, name: "mcp__vs_123__create_box" }).targets?.featureIds).toEqual([])
    expect(f.event({ ...partial, name: null, rawInput: input }).targets).toEqual(targets)
    f.event({ ...start, toolCallId: "two", name: "model_info", rawInput: {} })
    expect(
      f.event({ ...partial, toolCallId: "two", status: "completed" }).targets?.featureIds,
    ).toEqual([])
    expect(
      f.event({
        ...partial,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "x".repeat(40_000) } }],
      }).targets,
    ).toEqual(targets)
    expect(f.event({ ...partial }).targets).toEqual(targets)
  })

  it("does not guess from titles, late names, foreign IDs or invalid raw inputs", () => {
    const f = fixture()
    expect(f.event({ ...start, title: "create_box", rawInput: input }).targets?.featureIds).toEqual(
      [],
    )
    expect(f.event({ ...partial, name: "create_box" }).targets?.featureIds).toEqual([])
    expect(
      f.event({ ...partial, rawInput: { ...input, projectId: featureId } }).targets?.featureIds,
    ).toEqual([])
    expect(f.event({ ...partial, rawInput: input }).targets).toEqual(targets)
    expect(f.event({ ...partial, rawInput: { ...input, widthMm: -1 } }).targets).toEqual({
      projectId: targets.projectId,
      featureIds: [],
      sketchIds: [],
    })
    expect(f.event({ ...partial, status: "completed" }).targets?.featureIds).toEqual([])
  })

  it.each([
    { status: "failed" as const },
    { rawOutput: { ok: false } },
    { rawOutput: { structuredContent: { result: { ok: false } } } },
  ])("clears failed calls and keeps them cleared on completion: %j", (failure) => {
    const f = fixture()
    f.event({ ...start, name: "create_box", rawInput: input })
    expect(f.event({ ...partial, ...failure }).targets?.featureIds).toEqual([])
    expect(
      f.event({ ...partial, status: "completed", rawInput: input }).targets?.featureIds,
    ).toEqual([])
  })

  it("fences sessions and projects, clears turns and bounds retained call state", () => {
    const f = fixture()
    f.event({ ...start, name: "create_box", rawInput: input })
    expect(
      f.event({ ...partial }, { ...snapshot, sessionToken: "replacement" }).targets,
    ).toBeUndefined()
    f.event({ ...start, name: "create_box", rawInput: input })
    expect(f.event({ ...partial }, { ...snapshot, projectId: featureId }).targets).toBeUndefined()
    f.event({ ...start, name: "create_box", rawInput: input })
    f.tracker.clear()
    expect(f.event({ ...partial, rawInput: input }).targets?.featureIds).toEqual([])
    f.event({ ...start, name: "create_box", rawInput: input })
    for (let index = 0; index < 150; index++) f.event({ ...start, toolCallId: `other-${index}` })
    expect(
      f.event({ ...partial, status: "completed", rawOutput: { ok: false } }).targets?.featureIds,
    ).toEqual([])
    expect(f.event({ ...partial, rawInput: input }).targets?.featureIds).toEqual([])
  })
})
