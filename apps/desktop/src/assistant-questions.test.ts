import { describe, expect, it } from "bun:test"
import type { AssistantEvent, AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { vi } from "../../../tests/unit/support/bun-test"
import { createAssistantQuestions } from "./assistant-questions"

const snapshot: AssistantSnapshot = {
  projectId: "question-project",
  sessionToken: "question-owner",
  sessionId: "acp-session",
  status: "prompting",
  canResume: false,
  modes: [],
  currentModeId: null,
  models: [],
  currentModelId: null,
  configOptions: [],
  authMethods: [],
  attachmentCapabilities: { text: false, images: false },
}
const input = {
  message: "Choose the size",
  fields: [
    {
      id: "size",
      label: "Size",
      required: true,
      secret: false as const,
      allowCustomAnswer: false,
      options: [
        { id: "small", name: "Small" },
        { id: "large", name: "Large" },
      ],
    },
  ],
}

describe("owner-scoped assistant questions", () => {
  it("waits for a valid answer and settles once across duplicate reply and abort", async () => {
    const events: AssistantEvent[] = []
    const owner = createAssistantQuestions(snapshot, (event) => events.push(event))
    const abort = new AbortController()
    const waiting = owner.requestInput(input, abort.signal)
    const event = events[0]
    if (event?.type !== "question") throw new Error("Missing question")
    expect(owner.hasPending()).toBe(true)
    expect(owner.respond(event.question.requestId, { size: "invented" })).toBe(false)
    expect(owner.respond(event.question.requestId, { size: "" })).toBe(false)
    expect(owner.respond(event.question.requestId, { size: "large", foreign: "x" })).toBe(false)
    expect(owner.hasPending()).toBe(true)
    expect(owner.respond(event.question.requestId, { size: "large" })).toBe(true)
    abort.abort()
    expect(owner.respond(event.question.requestId, { size: "small" })).toBe(false)
    expect(await waiting).toEqual({ action: "accept", content: { size: "large" } })
    expect(events.filter((event) => event.type === "question-resolved")).toEqual([
      {
        projectId: "question-project",
        sessionToken: "question-owner",
        type: "question-resolved",
        requestId: event.question.requestId,
        reason: "answered",
      },
    ])
  })

  it("keeps unanswered questions pending across a day and cancels them only on abort", async () => {
    vi.useFakeTimers()
    try {
      const events: AssistantEvent[] = []
      const owner = createAssistantQuestions(snapshot, (event) => events.push(event))
      const abort = new AbortController()
      const waiting = owner.requestInput(input, abort.signal)
      const event = events[0]
      if (event?.type !== "question") throw new Error("Missing question")
      expect(event.question.expiresAt).toBeUndefined()
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(owner.hasPending()).toBe(true)
      expect(events).toHaveLength(1)
      expect(owner.respond(event.question.requestId, { size: "large" })).toBe(true)
      expect(await waiting).toEqual({ action: "accept", content: { size: "large" } })
      const cancelled = owner.requestInput(input, abort.signal)
      abort.abort()
      owner.cancel()
      expect(await cancelled).toEqual({ action: "cancel" })
      expect(owner.hasPending()).toBe(false)
      expect(events.at(-1)).toMatchObject({ reason: "cancelled" })
    } finally {
      vi.useRealTimers()
    }
  })
})
