import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { mountUiPluginPanel } from "./ui-panel-host"
import { readUiPluginPackage } from "./ui-plugin-package"
import { sampleUiPlugin } from "./ui-plugin-sample"

class TestPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onmessageerror: (() => void) | null = null
  close = vi.fn()
  postMessage = vi.fn()
}
const channels: TestChannel[] = []
class TestChannel {
  port1 = new TestPort()
  port2 = new TestPort()
  constructor() {
    channels.push(this)
  }
}
beforeEach(() => {
  channels.length = 0
  vi.stubGlobal("MessageChannel", TestChannel)
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function fixture(allowed = true, timeoutMs = 5000) {
  const pkg = await readUiPluginPackage(new TextEncoder().encode(JSON.stringify(sampleUiPlugin)))
  if (!pkg.ok) throw new Error(pkg.error)
  const iframe = document.createElement("iframe")
  document.body.append(iframe)
  const child = iframe.contentWindow
  if (!child) throw new Error("Missing frame window")
  const post = vi.fn<(message: unknown, targetOrigin: string, transfer: Transferable[]) => void>()
  Object.defineProperty(child, "postMessage", { configurable: true, value: post })
  const onStatus = vi.fn()
  let permission = allowed
  const connection = mountUiPluginPanel({
    iframe,
    plugin: pkg.value,
    panelId: "fit",
    timeoutMs,
    copy: { compute: "Calculate", invalidInputs: "Invalid inputs", results: "Results" },
    authorize: () => permission,
    onStatus,
  })
  const channel = channels.at(-1)
  if (!channel) throw new Error("Missing test channel")
  const nonce = iframe.srcdoc.match(/data-session="([a-f0-9]+)"/)?.[1]
  const message = (sequence: number, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    type: sequence === 0 ? "ready" : "calculated",
    sequence,
    extensionId: sampleUiPlugin.id,
    sessionNonce: nonce,
    panelId: "fit",
    capability: "ui.panel",
    ...overrides,
  })
  return {
    iframe,
    post,
    onStatus,
    connection,
    channel,
    message,
    revoke: () => {
      permission = false
    },
    load: () => iframe.dispatchEvent(new window.Event("load")),
    send: (value: unknown) =>
      channel.port1.onmessage?.(new window.MessageEvent("message", { data: value })),
  }
}

describe("opaque UI plugin host boundary", () => {
  it("uses an opaque sandbox, a private transferred port, CSP, and explicit disposal", async () => {
    const f = await fixture()
    expect(f.iframe.getAttribute("sandbox")).toBe("allow-scripts")
    expect(f.iframe.referrerPolicy).toBe("no-referrer")
    expect(f.iframe.srcdoc).toContain("default-src 'none'")
    expect(f.iframe.srcdoc).toContain("connect-src 'none'")
    expect(f.iframe.srcdoc).toContain("form-action 'none'")
    expect(f.iframe.srcdoc).toContain("ui-panel-runtime.js")
    expect(f.iframe.srcdoc).not.toContain(sampleUiPlugin.name)
    f.load()
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.post.mock.calls[0]?.[2]).toEqual([f.channel.port2])
    f.send(f.message(0))
    f.send(f.message(1))
    expect(f.onStatus.mock.calls).toEqual([["ready"], ["ready"]])
    f.connection.dispose()
    expect(f.iframe.srcdoc).toBe("")
    expect(f.channel.port1.onmessage).toBeNull()
    expect(f.channel.port1.close).toHaveBeenCalledTimes(1)
  })

  it("rejects forged IDs/nonces, unknown authority, invalid shapes, oversized messages, and replay", async () => {
    const variants = [
      { extensionId: "org.attacker.other" },
      { sessionNonce: "forged" },
      { capability: "model.command" },
      { type: "model.command", command: "delete" },
      { sequence: 1 },
      { unexpected: "value" },
      { unexpected: "x".repeat(5000) },
    ]
    for (const variant of variants) {
      const f = await fixture()
      f.load()
      f.send(f.message(0, variant))
      expect(f.onStatus.mock.calls).toEqual([["failed"]])
      expect(f.iframe.srcdoc).toBe("")
    }
    const replay = await fixture()
    replay.load()
    replay.send(replay.message(0))
    replay.send(replay.message(0))
    expect(replay.onStatus.mock.calls).toEqual([["ready"], ["failed"]])
  })

  it("denies missing grants and revocation and closes a handshake that never becomes ready", async () => {
    const denied = await fixture(false)
    expect(denied.onStatus.mock.calls).toEqual([["failed"]])
    expect(denied.post).not.toHaveBeenCalled()
    const revoked = await fixture()
    revoked.load()
    revoked.send(revoked.message(0))
    revoked.revoke()
    revoked.send(revoked.message(1))
    expect(revoked.onStatus.mock.calls).toEqual([["ready"], ["failed"]])
    const timeout = await fixture(true, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(timeout.onStatus.mock.calls).toEqual([["failed"]])
  })

  it("keeps a healthy monotonic calculator session open beyond 128 interactions", async () => {
    const f = await fixture()
    f.load()
    for (let sequence = 0; sequence < 140; sequence++) f.send(f.message(sequence))
    expect(f.onStatus).toHaveBeenCalledTimes(140)
    expect(f.onStatus.mock.calls.every(([status]) => status === "ready")).toBe(true)
    expect(f.channel.port1.close).not.toHaveBeenCalled()
    f.connection.dispose()
  })
})

async function loadHostPanelRuntime(nonce: string) {
  const bootstrap = document.createElement("script")
  bootstrap.setAttribute("data-session", nonce)
  const previousScript = Object.getOwnPropertyDescriptor(document, "currentScript")
  Object.defineProperty(document, "currentScript", { configurable: true, value: bootstrap })
  const listeners: { type: string; listener: EventListenerOrEventListenerObject }[] = []
  const attachListener = window.addEventListener.bind(window)
  const release = () => {
    for (const { type, listener } of listeners) window.removeEventListener(type, listener)
  }
  vi.stubGlobal(
    "addEventListener",
    (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.push({ type, listener })
      attachListener(type, listener)
    },
  )
  try {
    const runtimeModule = "./ui-panel-runtime.js?host-runtime-test"
    await import(runtimeModule)
  } catch (error) {
    release()
    throw error
  } finally {
    if (previousScript) Object.defineProperty(document, "currentScript", previousScript)
    else Reflect.deleteProperty(document, "currentScript")
  }
  return release
}

describe("host-owned declarative panel runtime", () => {
  it("calculates interactive outputs and treats package markup as text", async () => {
    const nonce = "a".repeat(48)
    const release = await loadHostPanelRuntime(nonce)
    try {
      const panel = structuredClone(sampleUiPlugin.panels[0])
      if (!panel) throw new Error("Missing sample panel")
      panel.title = '<img src="https://attacker.invalid/" onerror="parent.localStorage.clear()">'
      const messages: unknown[] = []
      const event = new window.MessageEvent("message", {
        data: {
          type: "vibeshape.ui-plugin.initialize",
          schemaVersion: 1,
          extensionId: sampleUiPlugin.id,
          sessionNonce: nonce,
          panel,
          copy: { compute: "Calculate", invalidInputs: "Invalid inputs", results: "Results" },
        },
      })
      Object.defineProperty(event, "source", { value: window })
      Object.defineProperty(event, "ports", {
        value: [{ postMessage: (message: unknown) => messages.push(message) }],
      })
      window.dispatchEvent(event)
      const body = document.body
      expect(body.querySelector("h1")?.textContent).toBe(panel.title)
      expect(body.querySelector("img")).toBeNull()
      expect(body.querySelector("output")?.textContent).toBe("10.4")
      const diameter = body.querySelector<HTMLInputElement>('[id="diameter"]')
      if (!diameter) throw new Error("Missing diameter input")
      diameter.value = "20"
      body.querySelector("button")?.click()
      expect(body.querySelector("output")?.textContent).toBe("20.4")
      diameter.value = "30"
      diameter.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      )
      expect(body.querySelector("output")?.textContent).toBe("30.4")
      diameter.value = "10001"
      body.querySelector("button")?.click()
      expect(body.querySelector('[role="alert"]')?.textContent).toBe("Invalid inputs")
      expect(body.querySelector("output")).toBeNull()
      expect(body.querySelector("form")).toBeNull()
      expect(messages).toHaveLength(4)
    } finally {
      release()
    }
  })
})
