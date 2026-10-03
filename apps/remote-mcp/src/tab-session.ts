import { DurableObject } from "cloudflare:workers"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import { localFailure, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import {
  REMOTE_MESSAGE_MAX_BYTES,
  REMOTE_REQUEST_TIMEOUT_MS,
  REMOTE_SESSION_MAX_OPERATIONS,
  type RemoteClient,
  type RemoteGrant,
  remoteActorSchema,
  remoteBrowserMessageSchema,
  remoteClientSchema,
  remoteGrantSchema,
  remoteOperationSchema,
} from "@vibeshape/automation-api/remote-session"
import { z } from "zod"
import type { RemoteEnv } from "./environment"
import { digest, failure } from "./request-security"

const metadataSchema = z
  .object({
    id: z.string().uuid(),
    tokenHash: z.string().length(64),
    actor: remoteActorSchema,
    expiresAt: z.number().int().positive(),
    clientId: z.string().max(256).nullable(),
    revoked: z.boolean(),
    active: z.string().uuid().nullable(),
    seen: z.array(z.string().length(64)).max(REMOTE_SESSION_MAX_OPERATIONS),
    window: z
      .object({ minute: z.number().int(), operations: z.number().int().nonnegative() })
      .strict(),
  })
  .strict()
type Metadata = z.infer<typeof metadataSchema>
type Pending = {
  id: string
  tool: LocalOperation["tool"]
  resolve: (result: unknown) => void
  timer: ReturnType<typeof setTimeout>
}
type Consent = {
  id: string
  client: RemoteClient
  resolve: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
}
const attachmentSchema = z.object({ authenticated: z.boolean() }).strict()
type BrowserMessage = z.infer<typeof remoteBrowserMessageSchema>

export class TabSession extends DurableObject<RemoteEnv> {
  private metadata: Metadata | null = null
  private pending: Pending | null = null
  private consent: Consent | null = null
  private handshakes = new Map<WebSocket, ReturnType<typeof setTimeout>>()

  constructor(ctx: DurableObjectState, env: RemoteEnv) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<unknown>("session")
      this.metadata = saved === undefined ? null : metadataSchema.parse(saved)
      // Only the pending marker survives a restart. Its request is never reissued.
      if (this.metadata?.active || (this.metadata && this.metadata.expiresAt <= Date.now()))
        await this.revoke()
    })
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async initialize(input: Omit<Metadata, "clientId" | "revoked" | "active" | "seen" | "window">) {
    if (this.metadata) throw new Error("A tab session cannot be reinitialized.")
    this.metadata = metadataSchema.parse({
      ...input,
      clientId: null,
      revoked: false,
      active: null,
      seen: [],
      window: { minute: Math.floor(Date.now() / 60_000), operations: 0 },
    })
    await this.save()
    await this.ctx.storage.setAlarm(input.expiresAt)
  }
  private save() {
    return this.ctx.storage.put("session", this.metadata)
  }
  private live() {
    return this.metadata !== null && !this.metadata.revoked && this.metadata.expiresAt > Date.now()
  }
  private browser() {
    return this.ctx
      .getWebSockets()
      .find(
        (socket) => attachmentSchema.safeParse(socket.deserializeAttachment()).data?.authenticated,
      )
  }
  private send(message: unknown) {
    const socket = this.browser()
    if (!socket) return false
    socket.send(JSON.stringify(message))
    return true
  }

  // fallow-ignore-next-line unused-class-member -- Cloudflare dispatches the browser WebSocket upgrade.
  async fetch(request: Request) {
    if (!this.live()) return failure(410, "session_expired")
    if (request.headers.get("Upgrade") !== "websocket") return failure(400, "websocket_required")
    if (this.ctx.getWebSockets().length >= 2 || this.browser())
      return failure(409, "browser_already_connected")
    const pair = new WebSocketPair()
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ authenticated: false })
    // A bounded handshake deadline prevents unauthenticated sockets from occupying a tab.
    const handshake = setTimeout(() => {
      this.handshakes.delete(server)
      if (!attachmentSchema.safeParse(server.deserializeAttachment()).data?.authenticated)
        server.close(1008, "Authentication required.")
    }, 10_000)
    this.handshakes.set(server, handshake)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async authorize(input: RemoteClient) {
    const client = remoteClientSchema.parse(input)
    if (!this.live() || !this.metadata || this.metadata.clientId || this.consent || !this.browser())
      return false
    const id = crypto.randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.consent?.id === id) {
          this.consent = null
          resolve(false)
          void this.revoke()
        }
      }, 90_000)
      this.consent = { id, client, resolve, timer }
      this.send({ type: "consent", requestId: id, client })
    })
  }

  async isAuthorized(input: RemoteGrant) {
    const grant = remoteGrantSchema.parse(input)
    return (
      this.live() &&
      this.metadata?.id === grant.sessionId &&
      this.metadata.clientId === grant.clientId &&
      !!this.browser()
    )
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async invoke(input: RemoteGrant, requestKey: string, operationInput: unknown) {
    const operation = remoteOperationSchema.parse(operationInput)
    z.string().length(64).parse(requestKey)
    if (!(await this.isAuthorized(input)) || !this.metadata)
      return localFailure("session-revoked", "The paired browser session is unavailable.")
    const budgetError = this.operationBudget(this.metadata, requestKey)
    if (budgetError) return budgetError
    const id = crypto.randomUUID()
    this.metadata.seen.push(requestKey)
    this.metadata.window.operations += 1
    this.metadata.active = id
    await this.save()
    if (!this.live() || !this.browser())
      return localFailure("session-revoked", "The browser session closed.")
    return new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id === id) void this.revoke()
      }, REMOTE_REQUEST_TIMEOUT_MS)
      this.pending = { id, tool: operation.tool, resolve, timer }
      this.send({ type: "work", requestId: id, operation })
    })
  }
  private operationBudget(metadata: Metadata, requestKey: string) {
    if (metadata.active)
      return localFailure("session-busy", "Another browser operation is in progress.", true)
    if (metadata.seen.includes(requestKey))
      return localFailure(
        "request-already-dispatched",
        "This request was already dispatched. Inspect the current revision; it will not be replayed.",
      )
    if (metadata.seen.length >= REMOTE_SESSION_MAX_OPERATIONS)
      return localFailure("session-limit", "The session operation budget is exhausted. Pair again.")
    const minute = Math.floor(Date.now() / 60_000)
    if (metadata.window.minute !== minute) metadata.window = { minute, operations: 0 }
    if (metadata.window.operations >= 30)
      return localFailure(
        "session-rate-limit",
        "The session operation rate limit was reached.",
        true,
      )
    return null
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async cancel() {
    await this.revoke()
  }
  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async revokeBrowser(token: string) {
    if (!this.metadata || (await digest(token)) !== this.metadata.tokenHash) return false
    await this.revoke()
    return true
  }
  private async revoke() {
    if (!this.metadata) return
    this.metadata.revoked = true
    this.metadata.active = null
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.resolve(
        localFailure(
          "outcome-unknown",
          "The connection ended. Inspect the current document revision before making another change.",
        ),
      )
      this.pending = null
    }
    if (this.consent) {
      clearTimeout(this.consent.timer)
      this.consent.resolve(false)
      this.consent = null
    }
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ type: "revoked" }))
        socket.close(1000, "Session revoked.")
      } catch {
        /* Socket closure has no remaining authority. */
      }
    }
    await this.save()
    await this.env.ADMISSION.getByName("global").release(this.metadata.id)
  }

  // fallow-ignore-next-line unused-class-member -- Cloudflare dispatches hibernating WebSocket messages.
  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (!this.live()) {
      socket.close(1008, "Session expired.")
      return
    }
    const attachment = attachmentSchema.parse(socket.deserializeAttachment())
    let message: BrowserMessage
    try {
      if (
        typeof data !== "string" ||
        new TextEncoder().encode(data).length > REMOTE_MESSAGE_MAX_BYTES
      )
        throw new Error("Invalid browser message.")
      message = remoteBrowserMessageSchema.parse(JSON.parse(data))
    } catch {
      if (attachment.authenticated) await this.revoke()
      else socket.close(1008, "Invalid message.")
      return
    }
    if (!attachment.authenticated) {
      return this.authenticate(socket, message)
    }
    if (message.type === "consent") return this.resolveConsent(message)
    if (message.type === "result") return this.resolveResult(message)
    return this.revoke()
  }
  private async authenticate(socket: WebSocket, message: BrowserMessage) {
    if (
      message.type !== "authenticate" ||
      !this.metadata ||
      (await digest(message.token)) !== this.metadata.tokenHash ||
      this.browser()
    ) {
      socket.close(1008, "Invalid authentication.")
      return
    }
    const handshake = this.handshakes.get(socket)
    if (handshake) clearTimeout(handshake)
    this.handshakes.delete(socket)
    socket.serializeAttachment({ authenticated: true })
    socket.send(
      JSON.stringify({
        type: "paired",
        sessionId: this.metadata.id,
        expiresAt: this.metadata.expiresAt,
      }),
    )
  }
  private async resolveConsent(message: Extract<BrowserMessage, { type: "consent" }>) {
    if (this.consent?.id !== message.requestId || !this.metadata) return this.revoke()
    const consent = this.consent
    this.consent = null
    clearTimeout(consent.timer)
    if (!message.approved) {
      consent.resolve(false)
      return this.revoke()
    }
    this.metadata.clientId = consent.client.clientId
    await this.save()
    if (!this.live() || !this.browser()) {
      consent.resolve(false)
      return this.revoke()
    }
    this.send({ type: "ready", actor: this.metadata.actor, expiresAt: this.metadata.expiresAt })
    consent.resolve(true)
  }
  private async resolveResult(message: Extract<BrowserMessage, { type: "result" }>) {
    if (
      this.pending?.id !== message.requestId ||
      this.pending.tool !== message.tool ||
      !this.metadata
    )
      return this.revoke()
    const result = localToolOutputs[message.tool].parse(message.result)
    const pending = this.pending
    this.pending = null
    this.metadata.active = null
    clearTimeout(pending.timer)
    await this.save()
    pending.resolve(result)
  }
  async webSocketClose(socket: WebSocket) {
    const handshake = this.handshakes.get(socket)
    if (handshake) clearTimeout(handshake)
    this.handshakes.delete(socket)
    if (attachmentSchema.safeParse(socket.deserializeAttachment()).data?.authenticated)
      await this.revoke()
  }
  // fallow-ignore-next-line unused-class-member -- Cloudflare dispatches hibernating WebSocket errors.
  async webSocketError(socket: WebSocket) {
    await this.webSocketClose(socket)
  }
  // fallow-ignore-next-line unused-class-member -- Cloudflare dispatches the persisted expiry alarm.
  async alarm() {
    await this.revoke()
    await this.ctx.storage.deleteAll()
  }
}
