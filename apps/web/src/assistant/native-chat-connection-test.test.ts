import { describe, expect, test } from "bun:test"
import type {
  AssistantBridge,
  AssistantConnectionTestResult,
} from "@vibeshape/automation-api/assistant"
import { assistantJevAgentSchema } from "@vibeshape/automation-api/assistant-jev"
import { MemoryTranscriptStore } from "./chat-history.test-fixture"
import { createNativeChatController } from "./native-chat-controller"

const agent = { command: "/fake-acp", args: ["--acp"] }
function host(probe?: NonNullable<AssistantBridge["testConnection"]>) {
  const writes: string[] = []
  let connects = 0
  let disconnects = 0
  const unavailable = async () => ({ ok: false, code: "request-failed" }) as const
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    connect: async () => {
      connects += 1
      return {
        ok: true,
        value: {
          projectId: "project",
          sessionToken: "token",
          sessionId: "session",
          status: "ready",
          canResume: false,
          modes: [],
          currentModeId: null,
          models: [],
          currentModelId: null,
          configOptions: [],
          attachmentCapabilities: { text: false, images: false },
          authMethods: [],
        },
      }
    },
    disconnect: async () => {
      disconnects += 1
      return { ok: false, code: "stale-session" }
    },
    prompt: unavailable,
    cancel: unavailable,
    setMode: unavailable,
    setModel: unavailable,
    setConfigOption: unavailable,
    authenticate: unavailable,
    respondPermission: unavailable,
    respondQuestion: unavailable,
    onEvent: () => () => {},
    ...(probe ? { testConnection: probe } : {}),
  }
  const controller = createNativeChatController({
    projectId: "project",
    bridge,
    historyStore: new MemoryTranscriptStore(),
    storage: {
      getItem: () => null,
      setItem: (key) => {
        writes.push(key)
      },
      removeItem: (key) => {
        writes.push(key)
      },
    },
  })
  controller.start()
  return { controller, writes, controls: () => ({ connects, disconnects }) }
}

describe("native chat connection test", () => {
  test("forwards project, agent and credentials while preserving connection and history", async () => {
    const calls: Parameters<NonNullable<AssistantBridge["testConnection"]>>[0][] = []
    const f = host(async (input) => {
      calls.push(input)
      return { ok: true, checks: ["agent", "jev"] }
    })
    try {
      await f.controller.connect(agent)
      await f.controller.flushHistory()
      const before = f.controller.getSnapshot()
      const writes = [...f.writes]
      const jev = assistantJevAgentSchema.parse({ kind: "jev", settings: {} })
      expect(await f.controller.testConnection(jev, { apiKey: "probe-secret" })).toEqual({
        ok: true,
        checks: ["agent", "jev"],
      })
      expect(calls).toEqual([
        { projectId: "project", agent: jev, jevCredentials: { apiKey: "probe-secret" } },
      ])
      expect(f.controller.getSnapshot()).toBe(before)
      expect(f.writes).toEqual(writes)
      expect(f.controls()).toEqual({ connects: 1, disconnects: 0 })
    } finally {
      f.controller.dispose()
    }
  })

  test("handles older bridges without changing state", async () => {
    const f = host()
    try {
      const before = f.controller.getSnapshot()
      expect(await f.controller.testConnection(agent)).toEqual({
        ok: false,
        code: "unsupported",
        stage: "agent",
      })
      expect(f.controller.getSnapshot()).toBe(before)
    } finally {
      f.controller.dispose()
    }
  })

  test("validates before bridge invocation and contains malformed responses and rejections", async () => {
    let calls = 0
    let result: unknown = {
      ok: false,
      stage: "jev",
      code: "request-failed",
      message: "private provider error",
    }
    const f = host(async () => {
      calls += 1
      if (result instanceof Error) throw result
      return result as AssistantConnectionTestResult
    })
    try {
      expect(await f.controller.testConnection({ command: "", args: [] })).toEqual({
        ok: false,
        code: "invalid-request",
        stage: "agent",
      })
      expect(calls).toBe(0)
      expect(await f.controller.testConnection(agent)).toEqual({
        ok: false,
        code: "protocol-error",
        stage: "agent",
      })
      result = new Error("private exception")
      expect(await f.controller.testConnection(agent)).toEqual({
        ok: false,
        code: "request-failed",
        stage: "agent",
      })
      f.controller.dispose()
      expect(await f.controller.testConnection(agent)).toEqual({
        ok: false,
        code: "stale-session",
        stage: "agent",
      })
    } finally {
      f.controller.dispose()
    }
  })
})
