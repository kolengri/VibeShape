import { describe, expect, it } from "bun:test"
import {
  NATIVE_SLICER_CHOOSE_CHANNEL,
  NATIVE_SLICER_LIST_CHANNEL,
  NATIVE_SLICER_REVEAL_CHANNEL,
  NATIVE_SLICER_SEND_CHANNEL,
  type NativeSlicerApi,
} from "@vibeshape/slicer-handoff/native"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { registerNativeSlicerIpc } from "./native-slicer-ipc"
import { exposeNativeSlicerBridge } from "./native-slicer-preload"

describe("native slicer IPC boundary", () => {
  it("rejects unowned frames before discovery, dialogs, files or processes", async () => {
    const owned = {} as IpcMainInvokeEvent
    const foreign = {} as IpcMainInvokeEvent
    const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>()
    let calls = 0
    const unregister = registerNativeSlicerIpc({
      ipcMain: {
        handle: (channel, handler) => {
          handlers.set(channel, handler)
        },
        removeHandler: (channel) => {
          handlers.delete(channel)
        },
      },
      isOwnedSender: (event) => event === owned,
      service: {
        async listApplications() {
          calls++
          return { ok: true, targets: [] }
        },
        async chooseApplication() {
          calls++
          return { ok: true, target: null }
        },
        async send() {
          calls++
          return { ok: false, reason: "invalid-request" }
        },
        async reveal() {
          calls++
          return false
        },
        close() {},
      },
    })
    for (const [channel, handler] of handlers)
      expect(await handler(foreign, {})).toEqual(
        channel === NATIVE_SLICER_REVEAL_CHANNEL ? false : { ok: false, reason: "forbidden" },
      )
    expect(calls).toBe(0)
    expect(await handlers.get(NATIVE_SLICER_LIST_CHANNEL)?.(owned, { path: "/arbitrary" })).toEqual(
      { ok: false, reason: "invalid-request" },
    )
    expect(calls).toBe(0)
    expect(await handlers.get(NATIVE_SLICER_LIST_CHANNEL)?.(owned)).toEqual({
      ok: true,
      targets: [],
    })
    expect(calls).toBe(1)
    unregister()
    expect(handlers.size).toBe(0)
  })
  it("exposes only typed methods and rejects invalid inputs and native responses", async () => {
    let api: NativeSlicerApi | undefined
    let calls = 0
    let response: unknown = { internalPath: "/private/never-exposed" }
    exposeNativeSlicerBridge(
      {
        exposeInMainWorld(name, value) {
          expect(name).toBe("vibeshapeSlicer")
          api = value
        },
      },
      {
        async invoke(channel) {
          expect([
            NATIVE_SLICER_LIST_CHANNEL,
            NATIVE_SLICER_CHOOSE_CHANNEL,
            NATIVE_SLICER_SEND_CHANNEL,
            NATIVE_SLICER_REVEAL_CHANNEL,
          ]).toContain(channel)
          calls++
          return response
        },
      },
    )
    if (!api) throw new Error("Missing native slicer bridge.")
    expect(Object.keys(api).sort()).toEqual([
      "chooseApplication",
      "listApplications",
      "protocolVersion",
      "reveal",
      "send",
    ])
    expect(await api.reveal("/arbitrary/file.3mf")).toBe(false)
    expect(
      await api.send({
        slicerId: "orca-slicer",
        filename: "../file.3mf",
        format: "3mf",
        file: new Uint8Array([80, 75, 3, 4]),
      }),
    ).toEqual({ ok: false, reason: "invalid-request" })
    expect(calls).toBe(0)
    expect(await api.listApplications()).toEqual({ ok: false, reason: "unavailable" })
    response = { ok: true, targets: [{ id: "orca-slicer", name: "OrcaSlicer" }] }
    expect(await api.listApplications()).toEqual({
      ok: true,
      targets: [{ id: "orca-slicer", name: "OrcaSlicer" }],
    })
    response = { ok: true, target: { id: "/arbitrary/executable", name: "Untrusted" } }
    expect(await api.chooseApplication()).toEqual({ ok: false, reason: "unavailable" })
  })
})
