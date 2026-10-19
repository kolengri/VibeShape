import { describe, expect, it } from "bun:test"
import {
  ASSISTANT_EVENT_CHANNEL,
  ASSISTANT_REQUEST_CHANNEL,
  type AssistantBridge,
  type AssistantEvent,
} from "@vibeshape/automation-api/assistant"
import type { IpcMain, IpcMainInvokeEvent, IpcRendererEvent } from "electron"
import { registerAssistantIpc } from "./assistant-ipc"
import { exposeAssistantBridge } from "./assistant-preload"

describe("native assistant IPC boundary", () => {
  it("checks the exact owned sender and strict request schema before calling the service", async () => {
    const owned = {} as IpcMainInvokeEvent
    const foreign = {} as IpcMainInvokeEvent
    let handler: Parameters<IpcMain["handle"]>[1] | undefined
    let removed = ""
    let calls = 0
    const unregister = registerAssistantIpc({
      ipcMain: {
        handle(channel, listener) {
          expect(channel).toBe(ASSISTANT_REQUEST_CHANNEL)
          handler = listener
        },
        removeHandler(channel) {
          removed = channel
        },
      },
      isOwnedSender: (event) => event === owned,
      service: {
        async handle() {
          calls += 1
          return { ok: false, code: "stale-session" }
        },
        async close() {},
      },
    })
    if (!handler) throw new Error("Missing registered handler.")
    const request = {
      operation: "disconnect",
      input: { projectId: "project", sessionToken: "token" },
    }
    expect(await handler(foreign, request)).toEqual({ ok: false, code: "forbidden" })
    expect(await handler(owned, { ...request, unexpected: true })).toEqual({
      ok: false,
      code: "invalid-request",
    })
    expect(calls).toBe(0)
    expect(await handler(owned, request)).toEqual({ ok: false, code: "stale-session" })
    expect(calls).toBe(1)
    unregister()
    expect(removed).toBe(ASSISTANT_REQUEST_CHANNEL)
  })

  it("exposes a narrow bridge and validates requests, responses and streamed events", async () => {
    let bridge: AssistantBridge | undefined
    let listener: ((event: IpcRendererEvent, payload: unknown) => void) | undefined
    let invoked = 0
    let removed = false
    let response: unknown = { secret: "malformed native response" }
    exposeAssistantBridge(
      {
        exposeInMainWorld(name, value) {
          expect(name).toBe("vibeshapeAssistant")
          bridge = value
        },
      },
      {
        async invoke(channel) {
          expect(channel).toBe(ASSISTANT_REQUEST_CHANNEL)
          invoked += 1
          return response
        },
        on(channel, callback) {
          expect(channel).toBe(ASSISTANT_EVENT_CHANNEL)
          listener = callback
        },
        removeListener(channel, callback) {
          removed = channel === ASSISTANT_EVENT_CHANNEL && callback === listener
        },
      },
    )
    if (!bridge) throw new Error("Missing exposed bridge.")
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(
      await bridge.connect({ projectId: "project", agent: { command: "", args: [] } }),
    ).toEqual({ ok: false, code: "invalid-request" })
    expect(invoked).toBe(0)
    expect(await bridge.cancel({ projectId: "project", sessionToken: "token" })).toEqual({
      ok: false,
      code: "protocol-error",
    })
    response = { ok: false, code: "agent-busy" }
    expect(await bridge.cancel({ projectId: "project", sessionToken: "token" })).toEqual({
      ok: false,
      code: "agent-busy",
    })
    const events: AssistantEvent[] = []
    const unsubscribe = bridge.onEvent((event) => events.push(event))
    if (!listener) throw new Error("Missing registered listener.")
    const ipcEvent = {} as IpcRendererEvent
    listener(ipcEvent, { type: "text", text: "missing scope" })
    listener(ipcEvent, { projectId: "project", sessionToken: "token", type: "text", text: "Hello" })
    expect(events).toEqual([
      { projectId: "project", sessionToken: "token", type: "text", text: "Hello" },
    ])
    unsubscribe()
    expect(removed).toBe(true)
  })
})
