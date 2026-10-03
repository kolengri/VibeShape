import {
  createExecutionContext,
  evictDurableObject,
  listDurableObjectIds,
  reset,
  runInDurableObject,
} from "cloudflare:test"
import { env } from "cloudflare:workers"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  remotePairResponseSchema,
  remoteServerMessageSchema,
} from "@vibeshape/automation-api/remote-session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RemoteEnv } from "./environment"
import worker from "./index"

const bindings = env as RemoteEnv
let address = 0
let ip = ""
const sockets: WebSocket[] = []
const verify = vi.fn<typeof fetch>()
function call(path: string, init: RequestInit = {}, configuration = bindings) {
  const headers = new Headers(init.headers)
  headers.set("CF-Connecting-IP", ip)
  return worker.fetch(
    new Request(`https://mcp.example${path}`, { ...init, headers }),
    configuration,
    createExecutionContext(),
  )
}
function challenge(
  result = { success: true, hostname: "editor.example", action: "vibeshape-pair" },
) {
  verify.mockResolvedValueOnce(Response.json(result))
}
function nextMessage(socket: WebSocket) {
  return new Promise<ReturnType<typeof remoteServerMessageSchema.parse>>((resolve) => {
    socket.addEventListener(
      "message",
      (event) => resolve(remoteServerMessageSchema.parse(JSON.parse(String(event.data)))),
      { once: true },
    )
  })
}
async function pair() {
  challenge()
  const response = await call("/browser/pair", {
    method: "POST",
    headers: { Origin: "https://editor.example", "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, turnstileToken: "verified-test-challenge" }),
  })
  expect(response.status).toBe(200)
  const credential = remotePairResponseSchema.parse(await response.json())
  const upgrade = await call(`/browser/socket/${credential.sessionId}`, {
    headers: { Origin: "https://editor.example", Upgrade: "websocket" },
  })
  expect(upgrade.status).toBe(101)
  const socket = upgrade.webSocket
  if (!socket) throw new Error("Expected the browser WebSocket.")
  socket.accept()
  sockets.push(socket)
  const paired = nextMessage(socket)
  socket.send(JSON.stringify({ type: "authenticate", token: credential.browserToken }))
  expect((await paired).type).toBe("paired")
  return { credential, socket }
}
async function registeredClient() {
  const response = await call("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "CAD test client",
      redirect_uris: ["https://client.example/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { client_id: string }
}
async function authorizationPage(clientId: string) {
  const verifier = "a".repeat(43)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    scope: "editor:session",
    state: "test-csrf-state",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    resource: "https://mcp.example/mcp",
  })
  const response = await call(`/authorize?${query}`)
  expect(response.status).toBe(200)
  const html = await response.text()
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1]
  if (!handle) throw new Error("Expected the official SDK consent handle.")
  const cookie = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? ""
  expect(cookie).toMatch(/^__Host-/)
  return { handle, cookie, verifier }
}
async function authorizeTab(tab: Awaited<ReturnType<typeof pair>>) {
  const client = await registeredClient()
  const page = await authorizationPage(client.client_id)
  const consent = nextMessage(tab.socket)
  const response = call("/authorize", {
    method: "POST",
    headers: {
      Origin: "https://mcp.example",
      Cookie: page.cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      handle: page.handle,
      pairingCode: tab.credential.pairingCode,
    }).toString(),
  })
  const request = await consent
  expect(request.type).toBe("consent")
  if (request.type !== "consent") throw new Error("Expected consent request.")
  expect(request.client.clientId).toBe(client.client_id)
  const ready = nextMessage(tab.socket)
  tab.socket.send(JSON.stringify({ type: "consent", requestId: request.requestId, approved: true }))
  expect((await ready).type).toBe("ready")
  const redirected = await response
  expect(redirected.status).toBe(302)
  const location = new URL(redirected.headers.get("Location") ?? "")
  expect(location.origin).toBe("https://client.example")
  expect(location.searchParams.get("state")).toBe("test-csrf-state")
  const code = location.searchParams.get("code")
  expect(code).toBeTruthy()
  const issued = await call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: code ?? "",
      redirect_uri: "https://client.example/callback",
      code_verifier: page.verifier,
      resource: "https://mcp.example/mcp",
    }).toString(),
  })
  expect(issued.status).toBe(200)
  const token = (await issued.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  expect(token.access_token).toBeTruthy()
  expect(token.refresh_token).toBeUndefined()
  expect(token.expires_in).toBe(900)
  return { token: token.access_token, clientId: client.client_id }
}
function mcp(token: string, id: number | undefined, method: string, params: unknown = {}) {
  return call("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })
}

beforeEach(async () => {
  await reset()
  ip = `198.51.100.${++address}`
  verify.mockReset().mockRejectedValue(new Error("Unexpected external request."))
  vi.stubGlobal("fetch", verify)
})
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  vi.unstubAllGlobals()
  await reset()
})

describe("remote MCP in workerd", () => {
  it("fails closed before tab allocation for missing config, hostile origin, and a wrong challenge hostname", async () => {
    const disabled = await call("/browser/pair", {}, { ...bindings, TURNSTILE_SITE_KEY: "" })
    expect(disabled.status).toBe(503)
    const hostile = await call("/browser/pair", {
      method: "POST",
      headers: { Origin: "https://hostile.example" },
    })
    expect(hostile.status).toBe(403)
    challenge({ success: true, hostname: "hostile.example", action: "vibeshape-pair" })
    const rejected = await call("/browser/pair", {
      method: "POST",
      headers: { Origin: "https://editor.example", "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, turnstileToken: "wrong-host" }),
    })
    expect(rejected.status).toBe(403)
    expect(await listDurableObjectIds(bindings.TAB_SESSIONS)).toHaveLength(0)
  })

  it("rejects unauthenticated MCP and invalid DCR before writing OAuth state", async () => {
    const unauthenticated = await call("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource")
    const metadata = await call("/.well-known/oauth-authorization-server")
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({ code_challenge_methods_supported: ["S256"] })
    for (const uri of [
      "http://client.example/callback",
      "https://client.example/callback#token",
      "https://user:password@client.example/callback",
    ]) {
      const rejected = await call("/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [uri] }),
      })
      expect(rejected.status).toBe(400)
    }
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(0)
  })

  it("caps unauthenticated registration before SDK KV writes and active tabs before per-tab allocation", async () => {
    const payload = JSON.stringify({ redirect_uris: ["https://client.example/callback"] })
    for (let count = 0; count < 6; count++) {
      const registered = await call("/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
      expect(registered.status).toBe(201)
    }
    const second = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    })
    expect(second.status).toBe(429)
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(6)
    const tab = await pair()
    expect(tab.credential.browserToken).toHaveLength(43)
    const unknown = await call(`/browser/socket/${crypto.randomUUID()}`, {
      headers: { Origin: "https://editor.example", Upgrade: "websocket" },
    })
    expect(unknown.status).toBe(410)
    expect(await listDurableObjectIds(bindings.TAB_SESSIONS)).toHaveLength(1)
    await pair()
    await pair()
    ip = `198.51.100.${++address}`
    challenge()
    const fourth = await call("/browser/pair", {
      method: "POST",
      headers: { Origin: "https://editor.example", "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, turnstileToken: "valid-challenge" }),
    })
    expect(fourth.status).toBe(429)
    expect(await listDurableObjectIds(bindings.TAB_SESSIONS)).toHaveLength(3)
  })

  it("requires the SDK browser-bound one-use consent and rejects cross-origin consent", async () => {
    const client = await registeredClient()
    const page = await authorizationPage(client.client_id)
    const body = new URLSearchParams({
      handle: page.handle,
      pairingCode: "A".repeat(16),
    }).toString()
    expect(
      (
        await call("/authorize", {
          method: "POST",
          headers: {
            Origin: "https://hostile.example",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        })
      ).status,
    ).toBe(403)
    const noCookie = await call("/authorize", {
      method: "POST",
      headers: {
        Origin: "https://mcp.example",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    })
    expect(noCookie.status).toBeGreaterThanOrEqual(400)
    expect((await bindings.OAUTH_KV.list({ prefix: "grant:" })).keys).toHaveLength(0)
  })

  it("uses actual OAuth PKCE, routes one exact tab, deduplicates request IDs and revokes immediately", async () => {
    const a = await pair()
    const b = await pair()
    const authenticated = await authorizeTab(a)
    const initialized = await mcp(authenticated.token, 0, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "CAD test client", version: "1" },
    })
    expect(initialized.status).toBe(200)
    const listed = await mcp(authenticated.token, 1, "tools/list")
    expect(listed.status).toBe(200)
    const catalog = (await listed.json()) as { result: { tools: { name: string }[] } }
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("create_hole")
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("change_metadata")
    expect(catalog.result.tools.map((tool) => tool.name)).not.toContain("export_model")
    const bMessages: unknown[] = []
    b.socket.addEventListener("message", (event) => bMessages.push(event.data))
    const work = nextMessage(a.socket)
    const response = mcp(authenticated.token, 2, "tools/call", {
      name: "model_info",
      arguments: {},
    })
    const operation = await work
    expect(operation.type).toBe("work")
    if (operation.type !== "work") throw new Error("Expected browser work.")
    a.socket.send(
      JSON.stringify({
        type: "result",
        protocolVersion: 1,
        requestId: operation.requestId,
        tool: "model_info",
        result: localFailure("fixture-read", "Tab A"),
      }),
    )
    const result = await response
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      result: { structuredContent: { result: { diagnostic: { message: "Tab A" } } } },
    })
    expect(bMessages).toHaveLength(0)
    const duplicate = await mcp(authenticated.token, 2, "tools/call", {
      name: "model_info",
      arguments: {},
    })
    expect(await duplicate.json()).toMatchObject({
      result: {
        structuredContent: { result: { diagnostic: { code: "request-already-dispatched" } } },
      },
    })
    const revoked = await call(`/browser/revoke/${a.credential.sessionId}`, {
      method: "POST",
      headers: {
        Origin: "https://editor.example",
        Authorization: `Bearer ${a.credential.browserToken}`,
      },
    })
    expect(revoked.status).toBe(204)
    expect((await mcp(authenticated.token, 3, "tools/list")).status).toBe(401)
    expect(
      await bindings.TAB_SESSIONS.getByName(b.credential.sessionId).isAuthorized({
        sessionId: b.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  })

  it("keeps uncertain request markers through a DO restart and never restores their authority", async () => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const stub = bindings.TAB_SESSIONS.getByName(tab.credential.sessionId)
    await runInDurableObject(stub, async (_instance, state) => {
      const metadata = await state.storage.get<Record<string, unknown>>("session")
      expect(metadata).not.toHaveProperty("browserToken")
      expect(metadata).not.toHaveProperty("document")
      await state.storage.put("session", { ...metadata, active: crypto.randomUUID() })
    })
    await evictDurableObject(stub)
    expect(
      await stub.isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
    expect((await mcp(authenticated.token, 4, "tools/list")).status).toBe(401)
  })

  it("cancels an in-flight operation through a separate authenticated POST before acknowledging it", async () => {
    const a = await pair()
    const b = await pair()
    const authenticatedA = await authorizeTab(a)
    const authenticatedB = await authorizeTab(b)
    const grantA = { sessionId: a.credential.sessionId, clientId: authenticatedA.clientId }
    const grantB = { sessionId: b.credential.sessionId, clientId: authenticatedB.clientId }
    const tabA = bindings.TAB_SESSIONS.getByName(grantA.sessionId)
    const tabB = bindings.TAB_SESSIONS.getByName(grantB.sessionId)
    const work = nextMessage(a.socket)
    let settled = false
    const running = mcp(authenticatedA.token, 41, "tools/call", {
      name: "model_info",
      arguments: {},
    }).then((response) => {
      settled = true
      return response
    })
    expect((await work).type).toBe("work")

    // Request IDs preserve JSON-RPC type, and a different grant cannot cancel this tab.
    for (const [token, requestId] of [
      [authenticatedA.token, "41"],
      [authenticatedA.token, 42],
      [authenticatedB.token, 41],
    ] as const) {
      const ignored = await mcp(token, undefined, "notifications/cancelled", { requestId })
      expect(ignored.status).toBe(202)
      expect(settled).toBe(false)
      expect(await tabA.isAuthorized(grantA)).toBe(true)
    }
    const invalid = await mcp(authenticatedA.token, undefined, "notifications/cancelled", {
      requestId: [41],
    })
    expect(invalid.status).toBe(400)
    const unacceptable = await call("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authenticatedA.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 41 },
      }),
    })
    expect(unacceptable.status).toBe(406)
    expect(settled).toBe(false)
    expect(await tabA.isAuthorized(grantA)).toBe(true)

    const revocation = nextMessage(a.socket)
    const cancelled = await mcp(authenticatedA.token, undefined, "notifications/cancelled", {
      requestId: 41,
    })
    expect(cancelled.status).toBe(202)
    expect(await tabA.isAuthorized(grantA)).toBe(false)
    expect((await revocation).type).toBe("revoked")
    const outcome = await running
    expect(outcome.status).toBe(200)
    expect(await outcome.json()).toMatchObject({
      result: { structuredContent: { result: { diagnostic: { code: "outcome-unknown" } } } },
    })
    expect((await mcp(authenticatedA.token, 43, "tools/list")).status).toBe(401)
    expect(await tabB.isAuthorized(grantB)).toBe(true)
  })
})
