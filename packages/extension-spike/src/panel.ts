import type { ExtensionCapability } from "./schemas"
import {
  type PanelExtensionMessage,
  panelExtensionMessageSchema,
  panelHostMessageSchema,
} from "./schemas"

export interface ExtensionPanelConnection {
  ready: PanelExtensionMessage
  nextCommand: () => Promise<PanelExtensionMessage>
  close: () => void
}

function iframeLoaded(iframe: HTMLIFrameElement) {
  return new Promise<void>((resolve) =>
    iframe.addEventListener("load", () => resolve(), { once: true }),
  )
}

function createCommandQueue() {
  const commands: PanelExtensionMessage[] = []
  const waiting: Array<(message: PanelExtensionMessage) => void> = []
  return {
    push(message: PanelExtensionMessage) {
      const resolve = waiting.shift()
      if (resolve) resolve(message)
      else commands.push(message)
    },
    next() {
      const command = commands.shift()
      return command
        ? Promise.resolve(command)
        : new Promise<PanelExtensionMessage>((resolve) => waiting.push(resolve))
    },
  }
}

function validPanelMessage(
  value: unknown,
  extensionId: string,
  sessionNonce: string,
  expectedSequence: number,
) {
  const parsed = panelExtensionMessageSchema.safeParse(value)
  if (!parsed.success) return null
  const matches = [
    parsed.data.extensionId === extensionId,
    parsed.data.sessionNonce === sessionNonce,
    parsed.data.sequence === expectedSequence,
    JSON.stringify(value).length <= 16 * 1024,
  ].every(Boolean)
  return matches ? parsed.data : null
}

export async function connectExtensionPanel(input: {
  iframe: HTMLIFrameElement
  html: string
  extensionId: string
  sessionNonce: string
  authorize: (capability: ExtensionCapability) => boolean
  timeoutMs?: number
}): Promise<ExtensionPanelConnection> {
  const queue = createCommandQueue()
  const loaded = iframeLoaded(input.iframe)
  input.iframe.setAttribute("sandbox", "allow-scripts")
  input.iframe.referrerPolicy = "no-referrer"
  input.iframe.srcdoc = input.html
  await loaded
  const contentWindow = input.iframe.contentWindow
  if (!contentWindow) throw new Error("The extension panel window is unavailable.")
  const channel = new MessageChannel()
  const hostMessage = panelHostMessageSchema.parse({
    type: "vibeshape.extension.initialize",
    schemaVersion: 0,
    extensionId: input.extensionId,
    sessionNonce: input.sessionNonce,
  })
  const ready = await new Promise<PanelExtensionMessage>((resolve, reject) => {
    let expectedSequence = 0
    const timeout = window.setTimeout(
      () => reject(new Error("The extension panel did not become ready.")),
      input.timeoutMs ?? 5_000,
    )
    channel.port1.onmessage = (event) => {
      const message = validPanelMessage(
        event.data,
        input.extensionId,
        input.sessionNonce,
        expectedSequence,
      )
      if (!message || !input.authorize(message.capability)) {
        window.clearTimeout(timeout)
        reject(new Error("The extension panel message was rejected."))
        channel.port1.close()
        return
      }
      expectedSequence += 1
      if (message.type === "ready") {
        window.clearTimeout(timeout)
        resolve(message)
        return
      }
      queue.push(message)
    }
    contentWindow.postMessage(hostMessage, "*", [channel.port2])
  })
  return {
    ready,
    nextCommand: queue.next,
    close() {
      channel.port1.close()
      input.iframe.remove()
    },
  }
}
