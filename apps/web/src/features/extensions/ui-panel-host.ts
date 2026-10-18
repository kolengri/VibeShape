import { z } from "zod"
import type { UiPanelCopy } from "./ui-extensions-copy"
import { uiPanelHtml } from "./ui-panel-document"
import {
  type UiPluginCapability,
  type UiPluginPackage,
  uiPluginPanelSchema,
} from "./ui-plugin-package"

const messageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.enum(["ready", "calculated"]),
  extensionId: z.string().max(160),
  sessionNonce: z.string().max(64),
  panelId: z.string().max(48),
  capability: z.literal("ui.panel"),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

function readPanelMessage(value: unknown) {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length > 4096) return null
  } catch {
    return null
  }
  const parsed = messageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function matchesPanelSession(
  message: z.infer<typeof messageSchema>,
  extensionId: string,
  sessionNonce: string,
  panelId: string,
  sequence: number,
) {
  return [
    message.extensionId === extensionId,
    message.sessionNonce === sessionNonce,
    message.panelId === panelId,
    message.sequence === sequence,
    message.type === (sequence === 0 ? "ready" : "calculated"),
  ].every(Boolean)
}

export type UiPanelStatus = "loading" | "ready" | "failed"

export function mountUiPluginPanel(input: {
  iframe: HTMLIFrameElement
  plugin: UiPluginPackage
  panelId: string
  copy: UiPanelCopy
  authorize: (integrity: string, capability: UiPluginCapability) => boolean
  onStatus: (status: UiPanelStatus) => void
  timeoutMs?: number
}) {
  const { iframe, plugin } = input
  const sessionNonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  const channel = new MessageChannel()
  let closed = false
  let loaded = false
  let expectedSequence = 0
  const dispose = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    iframe.removeEventListener("load", onLoad)
    channel.port1.onmessage = null
    channel.port1.onmessageerror = null
    channel.port1.close()
    channel.port2.close()
    iframe.srcdoc = ""
  }
  const fail = () => {
    dispose()
    input.onStatus("failed")
  }
  const timer = setTimeout(fail, input.timeoutMs ?? 5000)
  const authorized = () =>
    input.authorize(plugin.integrity, "ui.command") && input.authorize(plugin.integrity, "ui.panel")
  const panel = uiPluginPanelSchema.safeParse(
    plugin.manifest.panels.find(({ id }) => id === input.panelId),
  )
  function onLoad() {
    if (closed) return
    if (loaded || !panel.success || !authorized() || !iframe.contentWindow) {
      fail()
      return
    }
    loaded = true
    try {
      iframe.contentWindow.postMessage(
        {
          type: "vibeshape.ui-plugin.initialize",
          schemaVersion: 1,
          extensionId: plugin.manifest.id,
          sessionNonce,
          panel: panel.data,
          copy: input.copy,
        },
        "*",
        [channel.port2],
      )
    } catch {
      fail()
    }
  }
  channel.port1.onmessage = (event: MessageEvent<unknown>) => {
    const message = readPanelMessage(event.data)
    if (!message || !authorized()) {
      fail()
      return
    }
    if (
      !matchesPanelSession(
        message,
        plugin.manifest.id,
        sessionNonce,
        input.panelId,
        expectedSequence,
      )
    ) {
      fail()
      return
    }
    expectedSequence += 1
    clearTimeout(timer)
    input.onStatus("ready")
  }
  channel.port1.onmessageerror = fail
  iframe.setAttribute("sandbox", "allow-scripts")
  iframe.setAttribute(
    "allow",
    "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'",
  )
  iframe.referrerPolicy = "no-referrer"
  iframe.addEventListener("load", onLoad)
  if (!panel.success || !authorized()) fail()
  else
    iframe.srcdoc = uiPanelHtml(
      sessionNonce,
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    )
  return { dispose }
}
