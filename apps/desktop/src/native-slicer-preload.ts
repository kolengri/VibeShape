import {
  NATIVE_SLICER_CHOOSE_CHANNEL,
  NATIVE_SLICER_LIST_CHANNEL,
  NATIVE_SLICER_REVEAL_CHANNEL,
  NATIVE_SLICER_SEND_CHANNEL,
  type NativeSlicerApi,
  nativeMeshRequestSchema,
  nativeMeshResultSchema,
  nativeSlicerApplicationsResultSchema,
  nativeSlicerChooseResultSchema,
  nativeSlicerFileIdSchema,
} from "@vibeshape/slicer-handoff/native"
import type { ContextBridge, IpcRenderer } from "electron"

export function exposeNativeSlicerBridge(
  contextBridge: Pick<ContextBridge, "exposeInMainWorld">,
  ipcRenderer: Pick<IpcRenderer, "invoke">,
) {
  const bridge = Object.freeze<NativeSlicerApi>({
    protocolVersion: 1,
    async listApplications() {
      try {
        return nativeSlicerApplicationsResultSchema.parse(
          await ipcRenderer.invoke(NATIVE_SLICER_LIST_CHANNEL),
        )
      } catch {
        return { ok: false, reason: "unavailable" }
      }
    },
    async chooseApplication() {
      try {
        return nativeSlicerChooseResultSchema.parse(
          await ipcRenderer.invoke(NATIVE_SLICER_CHOOSE_CHANNEL),
        )
      } catch {
        return { ok: false, reason: "unavailable" }
      }
    },
    async send(input) {
      const request = nativeMeshRequestSchema.safeParse(input)
      if (!request.success) return { ok: false, reason: "invalid-request" }
      try {
        return nativeMeshResultSchema.parse(
          await ipcRenderer.invoke(NATIVE_SLICER_SEND_CHANNEL, request.data),
        )
      } catch {
        return { ok: false, reason: "unavailable" }
      }
    },
    async reveal(input) {
      const id = nativeSlicerFileIdSchema.safeParse(input)
      if (!id.success) return false
      try {
        return (await ipcRenderer.invoke(NATIVE_SLICER_REVEAL_CHANNEL, id.data)) === true
      } catch {
        return false
      }
    },
  })
  contextBridge.exposeInMainWorld("vibeshapeSlicer", bridge)
}
