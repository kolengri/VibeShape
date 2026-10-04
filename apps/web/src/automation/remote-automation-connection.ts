import { localFailure, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import {
  REMOTE_MESSAGE_MAX_BYTES,
  type RemoteClient,
  type RemotePair,
  type RemoteServerMessage,
  remoteOperationSchema,
  remotePairResponseSchema,
  remoteServerMessageSchema,
} from "@vibeshape/automation-api/remote-session"
import type { CommandActor } from "@vibeshape/domain/commands"
import { z } from "zod"
import {
  createActiveDocumentAutomationSession,
  getProjectActiveWorkBlock,
} from "../document/document-controller"
import { automationReviews } from "./automation-review-controller"
import { createLocalToolExecutor } from "./local-tool-executor"

type Handle = Extract<ReturnType<typeof createActiveDocumentAutomationSession>, { ok: true }>
type Pair = {
  credential: RemotePair
  handle: Handle
  socket: WebSocket
  executor: ReturnType<typeof createLocalToolExecutor> | null
  actor: CommandActor | null
  approvedClient: RemoteClient | null
  active: AbortController | null
  expiry: ReturnType<typeof setTimeout>
}
type Snapshot = Readonly<{
  available: boolean
  pairingCode: string | null
  connected: boolean
  connecting: boolean
  autoApply: boolean
  busy: boolean
  client: RemoteClient | null
  consent: Extract<RemoteServerMessage, { type: "consent" }> | null
  error: boolean
}>
const endpointSchema = z
  .string()
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) =>
      url.protocol === "https:" &&
      url.pathname === "/mcp" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
  )
function remoteOrigin(value: unknown) {
  const parsed = endpointSchema.safeParse(value)
  return parsed.success ? parsed.data.origin : null
}

export function createRemoteAutomationConnection(endpoint: unknown) {
  const origin = remoteOrigin(endpoint)
  let snapshot: Snapshot = {
    available: origin !== null,
    pairingCode: null,
    connected: false,
    connecting: false,
    autoApply: false,
    busy: false,
    client: null,
    consent: null,
    error: false,
  }
  let pair: Pair | null = null
  let generation = 0
  let enabling = false
  const listeners = new Set<() => void>()
  function publish(next: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }
  async function request(path: string, input?: unknown, token?: string) {
    if (!origin) throw new Error("Remote automation is not configured.")
    return fetch(`${origin}${path}`, {
      method: input === undefined ? "GET" : "POST",
      credentials: "omit",
      cache: "no-store",
      mode: "cors",
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      headers: {
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }
  async function revoke(credential: RemotePair) {
    await request(`/browser/revoke/${credential.sessionId}`, {}, credential.browserToken).catch(
      () => undefined,
    )
  }
  async function disable() {
    generation += 1
    const current = pair
    pair = null
    if (current) {
      current.active?.abort()
      current.handle.dispose()
      clearTimeout(current.expiry)
      current.socket.close()
    }
    publish({
      pairingCode: null,
      connected: false,
      connecting: false,
      autoApply: false,
      busy: false,
      client: null,
      consent: null,
    })
    if (current) await revoke(current.credential)
  }
  function fail(current: Pair) {
    if (pair !== current) return
    void disable()
    publish({ error: true })
  }
  async function work(current: Pair, message: Extract<RemoteServerMessage, { type: "work" }>) {
    if (!current.executor || !snapshot.connected || current.active || !current.handle.readInfo()) {
      fail(current)
      return
    }
    const operation = remoteOperationSchema.safeParse(message.operation)
    if (!operation.success) {
      fail(current)
      return
    }
    const controller = new AbortController()
    current.active = controller
    publish({ busy: true })
    let result: unknown
    try {
      result = localToolOutputs[message.operation.tool].parse(
        await current.executor.execute(operation.data, controller.signal),
      )
    } catch {
      result = localFailure(
        "automation-failed",
        "The browser automation request could not be confirmed.",
      )
    }
    if (pair !== current || controller.signal.aborted) return
    sendResult(current, message, result)
  }
  function sendResult(
    current: Pair,
    message: Extract<RemoteServerMessage, { type: "work" }>,
    result: unknown,
  ) {
    const serialized = JSON.stringify({
      type: "result",
      protocolVersion: 1,
      requestId: message.requestId,
      tool: message.operation.tool,
      result,
    })
    if (new TextEncoder().encode(serialized).length > REMOTE_MESSAGE_MAX_BYTES) {
      fail(current)
      return
    }
    try {
      current.socket.send(serialized)
    } catch {
      fail(current)
      return
    }
    current.active = null
    publish({ busy: false })
  }
  function receivePaired(current: Pair, message: Extract<RemoteServerMessage, { type: "paired" }>) {
    if (
      message.sessionId !== current.credential.sessionId ||
      message.expiresAt !== current.credential.expiresAt ||
      current.actor
    ) {
      fail(current)
      return
    }
    publish({ pairingCode: current.credential.pairingCode, connecting: false })
  }
  function receiveReady(current: Pair, message: Extract<RemoteServerMessage, { type: "ready" }>) {
    if (
      !current.approvedClient ||
      current.actor ||
      message.actor.sessionId !== current.credential.sessionId ||
      message.expiresAt !== current.credential.expiresAt ||
      !current.handle.readInfo()
    ) {
      fail(current)
      return
    }
    current.actor = message.actor
    current.executor = createLocalToolExecutor(current.handle, message.actor)
    publish({
      connected: true,
      connecting: false,
      client: current.approvedClient,
      consent: null,
    })
  }
  function receiveConsent(
    current: Pair,
    message: Extract<RemoteServerMessage, { type: "consent" }>,
  ) {
    if (current.actor || snapshot.consent || current.approvedClient || !current.handle.readInfo()) {
      fail(current)
      return
    }
    publish({ consent: message })
  }
  function receive(current: Pair, event: MessageEvent) {
    if (pair !== current) return
    try {
      if (
        typeof event.data !== "string" ||
        new TextEncoder().encode(event.data).length > REMOTE_MESSAGE_MAX_BYTES
      ) {
        fail(current)
        return
      }
      dispatch(current, remoteServerMessageSchema.parse(JSON.parse(event.data)))
    } catch {
      fail(current)
    }
  }
  function dispatch(current: Pair, message: RemoteServerMessage) {
    switch (message.type) {
      case "revoked":
        fail(current)
        return
      case "paired":
        receivePaired(current, message)
        return
      case "ready":
        receiveReady(current, message)
        return
      case "consent":
        receiveConsent(current, message)
        return
      case "work":
        void work(current, message)
    }
  }
  function connect(credential: RemotePair, handle: Handle) {
    if (!origin) throw new Error("Remote automation is not configured.")
    const socket = new WebSocket(
      `${origin.replace("https:", "wss:")}/browser/socket/${credential.sessionId}`,
    )
    const current: Pair = {
      credential,
      handle,
      socket,
      executor: null,
      actor: null,
      approvedClient: null,
      active: null,
      expiry: setTimeout(() => {
        if (pair === current) void disable()
      }, credential.expiresAt - Date.now()),
    }
    pair = current
    socket.onopen = () => {
      if (pair !== current) return
      socket.send(JSON.stringify({ type: "authenticate", token: current.credential.browserToken }))
    }
    socket.onmessage = (event) => receive(current, event)
    socket.onerror = () => fail(current)
    socket.onclose = () => fail(current)
  }
  async function pairHandle(handle: Handle, turnstileToken: string, at: number) {
    let credential: RemotePair | null = null
    try {
      const response = await request("/browser/pair", { protocolVersion: 1, turnstileToken })
      if (!response.ok) throw new Error("Remote pairing was rejected.")
      credential = remotePairResponseSchema.parse(await response.json())
      if (at !== generation || !handle.readInfo() || credential.expiresAt <= Date.now()) {
        handle.dispose()
        await revoke(credential)
        return false
      }
      connect(credential, handle)
      return true
    } catch {
      handle.dispose()
      if (credential) await revoke(credential)
      if (at === generation) publish({ error: true, connecting: false })
      return false
    }
  }
  async function enable(turnstileToken: string) {
    if (
      !origin ||
      enabling ||
      pair ||
      getProjectActiveWorkBlock() ||
      automationReviews.getSnapshot()
    )
      return false
    enabling = true
    const at = generation
    const handle = createActiveDocumentAutomationSession()
    if (!handle.ok) {
      enabling = false
      publish({ error: true })
      return false
    }
    publish({ connecting: true, error: false })
    try {
      return await pairHandle(handle, turnstileToken, at)
    } finally {
      enabling = false
    }
  }
  function consent(approved: boolean) {
    const current = pair
    const pending = snapshot.consent
    if (!current || !pending) return false
    if (
      approved &&
      (!current.handle.readInfo() || current.active || automationReviews.getSnapshot())
    )
      return false
    return sendConsent(current, pending, approved)
  }
  function sendConsent(
    current: Pair,
    pending: NonNullable<Snapshot["consent"]>,
    approved: boolean,
  ) {
    if (approved) current.approvedClient = pending.client
    publish({ consent: null, connecting: approved })
    try {
      current.socket.send(
        JSON.stringify({ type: "consent", requestId: pending.requestId, approved }),
      )
    } catch {
      fail(current)
      return false
    }
    if (!approved) void disable()
    return true
  }
  const onPageHide = () => {
    void disable()
  }
  return {
    enable,
    disable,
    consent,
    async configuration() {
      const response = await request("/browser/config")
      if (!response.ok) throw new Error("Remote admission is unavailable.")
      return z
        .object({ siteKey: z.string().min(1).max(256) })
        .strict()
        .parse(await response.json())
    },
    enableAutoApply() {
      const current = pair
      if (
        !current ||
        !snapshot.connected ||
        current.active ||
        snapshot.consent ||
        !current.actor ||
        !current.handle.enableAutoApply(current.actor)
      )
        return false
      publish({ autoApply: true })
      return true
    },
    disableAutoApply() {
      const current = pair
      if (
        !current ||
        snapshot.busy ||
        automationReviews.getSnapshot() ||
        !current.handle.disableAutoApply()
      )
        return false
      publish({ autoApply: false })
      return true
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      window.addEventListener("pagehide", onPageHide)
    },
    dispose() {
      window.removeEventListener("pagehide", onPageHide)
      void disable()
    },
  }
}
