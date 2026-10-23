import {
  DESKTOP_COMMAND_CHANNEL,
  DESKTOP_COMMAND_STATE_CHANNEL,
  DESKTOP_FULL_SCREEN_CHANGED_CHANNEL,
  DESKTOP_FULL_SCREEN_CHANNEL,
  DESKTOP_MCP_SETUP_CHANNEL,
  DESKTOP_TEXT_EDIT_CHANNEL,
  type DesktopHostBridge,
  desktopCommandEventSchema,
  desktopCommandStateSchema,
  desktopMcpSetupSchema,
  desktopTextEditSchema,
} from "@vibeshape/automation-api/desktop-host"
import { contextBridge, ipcRenderer } from "electron"
import { z } from "zod"
import { exposeAssistantBridge } from "./assistant-preload"
import { exposeNativeSlicerBridge } from "./native-slicer-preload"

z.config({ jitless: true })

const bridge: DesktopHostBridge = Object.freeze({
  protocolVersion: 1,
  localAutomationAccess: "current-project",
  platform: process.platform === "darwin" ? "darwin" : "other",
  windowChrome: process.argv.includes("--vibeshape-unified-chrome") ? "unified" : "standard",
  onFullScreenChange(callback) {
    let active = true
    let receivedEvent = false
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (active && typeof payload === "boolean") {
        receivedEvent = true
        callback(payload)
      }
    }
    ipcRenderer.on(DESKTOP_FULL_SCREEN_CHANGED_CHANNEL, listener)
    void ipcRenderer
      .invoke(DESKTOP_FULL_SCREEN_CHANNEL)
      .then((payload: unknown) => {
        // A transition received after subscribing supersedes the initial snapshot.
        if (active && !receivedEvent && typeof payload === "boolean") callback(payload)
      })
      .catch(() => {})
    return () => {
      active = false
      ipcRenderer.removeListener(DESKTOP_FULL_SCREEN_CHANGED_CHANNEL, listener)
    }
  },
  async getMcpSetup() {
    return desktopMcpSetupSchema.parse(await ipcRenderer.invoke(DESKTOP_MCP_SETUP_CHANNEL))
  },
  onCommand(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const event = desktopCommandEventSchema.safeParse(payload)
      if (event.success) callback(event.data.id)
    }
    ipcRenderer.on(DESKTOP_COMMAND_CHANNEL, listener)
    return () => ipcRenderer.removeListener(DESKTOP_COMMAND_CHANNEL, listener)
  },
  async updateCommandState(state) {
    await ipcRenderer.invoke(DESKTOP_COMMAND_STATE_CHANNEL, desktopCommandStateSchema.parse(state))
  },
  async editText(action) {
    await ipcRenderer.invoke(DESKTOP_TEXT_EDIT_CHANNEL, desktopTextEditSchema.parse(action))
  },
})

contextBridge.exposeInMainWorld("vibeshapeDesktop", bridge)

exposeAssistantBridge(contextBridge, ipcRenderer)
exposeNativeSlicerBridge(contextBridge, ipcRenderer)
