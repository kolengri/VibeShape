import { describe, expect, test } from "bun:test"
import {
  ASSISTANT_CONNECTION_TEST_CHANNEL,
  type AssistantBridge,
  type AssistantConnectionTestResult,
} from "@vibeshape/automation-api/assistant"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { registerAssistantIpc } from "./assistant-ipc"
import { exposeAssistantBridge } from "./assistant-preload"

const input = { projectId: "project", agent: { command: "/adapter", args: [] } }

describe("connection-test IPC boundary", () => {
  test("uses the exact owned-sender check, validates input and output, and removes both handlers", async () => {
    const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>()
    const owned = {} as IpcMainInvokeEvent
    let calls = 0
    let response: unknown = { ok: true, checks: ["agent"] }
    const remove = registerAssistantIpc({
      ipcMain: {
        handle: (channel, listener) => {
          handlers.set(channel, listener)
        },
        removeHandler: (channel) => {
          handlers.delete(channel)
        },
      },
      isOwnedSender: (event) => event === owned,
      service: {
        handle: async () => ({ ok: false, code: "request-failed" }),
        close: async () => {},
        testConnection: async () => {
          calls += 1
          if (response instanceof Error) throw response
          return response as AssistantConnectionTestResult
        },
      },
    })
    const handler = handlers.get(ASSISTANT_CONNECTION_TEST_CHANNEL)
    if (!handler) throw new Error("Missing probe handler.")
    expect(await handler({} as IpcMainInvokeEvent, input)).toEqual({
      ok: false,
      code: "forbidden",
      stage: "agent",
    })
    expect(await handler(owned, { ...input, model: {} })).toEqual({
      ok: false,
      code: "invalid-request",
      stage: "agent",
    })
    expect(calls).toBe(0)
    expect(await handler(owned, input)).toEqual({ ok: true, checks: ["agent"] })
    response = { ok: false, code: "request-failed", stage: "jev", message: "private secret" }
    expect(await handler(owned, input)).toEqual({
      ok: false,
      code: "protocol-error",
      stage: "agent",
    })
    response = new Error("private secret")
    expect(await handler(owned, input)).toEqual({
      ok: false,
      code: "request-failed",
      stage: "agent",
    })
    expect(handlers.size).toBe(2)
    remove()
    expect(handlers.size).toBe(0)
  })

  test("validates preload requests and replies in both directions and contains transport errors", async () => {
    let bridge: AssistantBridge | undefined
    let calls = 0
    let response: unknown = {
      ok: false,
      code: "request-failed",
      stage: "arguments",
      httpStatus: 401,
    }
    exposeAssistantBridge(
      {
        exposeInMainWorld: (_name, value) => {
          bridge = value
        },
      },
      {
        invoke: async (channel, payload) => {
          expect(channel).toBe(ASSISTANT_CONNECTION_TEST_CHANNEL)
          expect(payload).toEqual(input)
          calls += 1
          if (response instanceof Error) throw response
          return response
        },
        on: () => {},
        removeListener: () => {},
      },
    )
    if (!bridge?.testConnection) throw new Error("Missing exposed probe.")
    expect(await bridge.testConnection({ ...input, projectId: "" })).toEqual({
      ok: false,
      code: "invalid-request",
      stage: "agent",
    })
    expect(calls).toBe(0)
    expect(await bridge.testConnection(input)).toEqual({
      ok: false,
      code: "request-failed",
      stage: "arguments",
      httpStatus: 401,
    })
    response = { ok: true, checks: ["agent"], secret: "private" }
    expect(await bridge.testConnection(input)).toEqual({
      ok: false,
      code: "protocol-error",
      stage: "agent",
    })
    response = new Error("private transport error")
    expect(await bridge.testConnection(input)).toEqual({
      ok: false,
      code: "request-failed",
      stage: "agent",
    })
  })
})
