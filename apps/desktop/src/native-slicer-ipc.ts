import {
  NATIVE_SLICER_CHOOSE_CHANNEL,
  NATIVE_SLICER_LIST_CHANNEL,
  NATIVE_SLICER_REVEAL_CHANNEL,
  NATIVE_SLICER_SEND_CHANNEL,
} from "@vibeshape/slicer-handoff/native"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { createNativeSlicerService } from "./native-slicer"

export function registerNativeSlicerIpc(options: {
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  isOwnedSender: (event: IpcMainInvokeEvent) => boolean
  service: ReturnType<typeof createNativeSlicerService>
}) {
  const channels = [
    NATIVE_SLICER_LIST_CHANNEL,
    NATIVE_SLICER_CHOOSE_CHANNEL,
    NATIVE_SLICER_SEND_CHANNEL,
    NATIVE_SLICER_REVEAL_CHANNEL,
  ]
  for (const channel of channels)
    options.ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!options.isOwnedSender(event))
        return channel === NATIVE_SLICER_REVEAL_CHANNEL ? false : { ok: false, reason: "forbidden" }
      if (channel === NATIVE_SLICER_REVEAL_CHANNEL) return options.service.reveal(payload)
      if (channel === NATIVE_SLICER_SEND_CHANNEL) return options.service.send(payload)
      if (payload !== undefined) return { ok: false, reason: "invalid-request" }
      return channel === NATIVE_SLICER_LIST_CHANNEL
        ? options.service.listApplications()
        : options.service.chooseApplication()
    })
  return () => {
    for (const channel of channels) options.ipcMain.removeHandler(channel)
  }
}
