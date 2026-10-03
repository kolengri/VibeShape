import {
  createExecutionContext,
  evictDurableObject,
  listDurableObjectIds,
  reset,
  runInDurableObject,
} from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
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
async function registeredClient(redirectUri = "https://client.example/callback") {
  const response = await call("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "CAD test client",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { client_id: string }
}
async function authorizationPage(
  clientId: string,
  redirectUri = "https://client.example/callback",
) {
  const verifier = "a".repeat(43)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "editor:session",
    state: "test-csrf-state",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    resource: "https://mcp.example/mcp",
  })
  const response = await call(`/authorize?${query}`)
  expect(response.status).toBe(200)
  expect(response.headers.get("Referrer-Policy")).toBe("same-origin")
  const html = await response.text()
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1]
  if (!handle) throw new Error("Expected the official SDK consent handle.")
  const cookie = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? ""
  expect(cookie).toMatch(/^__Host-/)
  return { handle, cookie, verifier, html, policy: response.headers.get("Content-Security-Policy") }
}
async function authorizeTab(
  tab: Awaited<ReturnType<typeof pair>>,
  redirectUri = "https://client.example/callback",
) {
  const client = await registeredClient(redirectUri)
  const page = await authorizationPage(client.client_id, redirectUri)
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
  expect(redirected.status).toBe(200)
  expect(redirected.headers.get("Cache-Control")).toBe("no-store")
  expect(redirected.headers.get("Referrer-Policy")).toBe("no-referrer")
  expect(redirected.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  )
  const refresh = redirected.headers.get("Refresh") ?? ""
  expect(refresh.startsWith("0;url=")).toBe(true)
  const location = new URL(refresh.slice(6))
  expect(location.origin).toBe(new URL(redirectUri).origin)
  expect(location.pathname).toBe(new URL(redirectUri).pathname)
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
      redirect_uri: redirectUri,
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
  it("keeps a standard SDK client usable after its optional SSE probe", async () => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const probes: number[] = []
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.example/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${authenticated.token}` } },
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const response = await call("/mcp", {
          method: request.method,
          headers: request.headers,
          ...(request.method === "POST" ? { body: await request.text() } : {}),
        })
        if (request.method === "GET") probes.push(response.status)
        return response
      },
    })
    const client = new Client({ name: "Standard SDK test client", version: "1" })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.some((tool) => tool.name === "model_info")).toBe(true)
      await vi.waitFor(() => expect(probes).toEqual([405]))
      expect((await client.listResources()).resources.length).toBeGreaterThan(0)
      expect(
        await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
          sessionId: tab.credential.sessionId,
          clientId: authenticated.clientId,
        }),
      ).toBe(true)
    } finally {
      await client.close()
    }
  })

  it("serves the operator skill resources and tool only under live-tab OAuth authority without browser work", async () => {
    expect((await mcp("invalid-token", 1, "resources/list")).status).toBe(401)
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const messages: unknown[] = []
    tab.socket.addEventListener("message", (event) => {
      messages.push(event.data)
    })
    const initialized = await mcp(authenticated.token, 2, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "skill-reader", version: "1" },
    })
    expect(await initialized.json()).toMatchObject({
      result: {
        capabilities: { resources: {} },
        instructions: expect.stringContaining("read_agent_skill"),
      },
    })
    const listed = await mcp(authenticated.token, 3, "resources/list")
    const resources = (await listed.json()) as { result: { resources: { uri: string }[] } }
    expect(resources.result.resources).toHaveLength(10)
    expect(resources.result.resources).not.toContainEqual(
      expect.objectContaining({ uri: "vibeshape://model" }),
    )
    const indexUri = "vibeshape://agent-skills"
    const read = await mcp(authenticated.token, 4, "resources/read", { uri: indexUri })
    const indexContent = ((await read.json()) as { result: { contents: { text: string }[] } })
      .result.contents[0]
    if (!indexContent) throw new Error("Expected skill index.")
    const index = JSON.parse(indexContent.text) as {
      entrypoint: string
      skills: { name: string }[]
    }
    expect(index.skills.map((skill) => skill.name)).toEqual([
      "vibeshape-use",
      "vibeshape-modeling",
      "vibeshape-inspection",
      "vibeshape-organization",
      "vibeshape-export",
    ])
    const toolIndex = await mcp(authenticated.token, 5, "tools/call", {
      name: "read_agent_skill",
      arguments: {},
    })
    expect(await toolIndex.json()).toMatchObject({
      result: {
        isError: false,
        structuredContent: { result: { value: { uri: indexUri, text: indexContent.text } } },
      },
    })
    const skill = await mcp(authenticated.token, 6, "tools/call", {
      name: "read_agent_skill",
      arguments: { uri: index.entrypoint },
    })
    expect(await skill.json()).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          result: {
            value: {
              mimeType: "text/markdown",
              text: expect.stringContaining("vibeshape://agent-skills/vibeshape-modeling/SKILL.md"),
            },
          },
        },
      },
    })
    const unknown = await mcp(authenticated.token, 7, "resources/read", {
      uri: `${indexUri}/../session`,
    })
    expect(await unknown.json()).toMatchObject({ error: { code: -32602 } })
    const oversized = await mcp(authenticated.token, 8, "tools/call", {
      name: "read_agent_skill",
      arguments: { uri: "x".repeat(257) },
    })
    expect(await oversized.json()).toMatchObject({
      result: {
        isError: true,
        structuredContent: { result: { diagnostic: { code: "invalid-operation" } } },
      },
    })
    expect(messages).toHaveLength(0)
    expect(
      (
        await call(`/browser/revoke/${tab.credential.sessionId}`, {
          method: "POST",
          headers: {
            Origin: "https://editor.example",
            Authorization: `Bearer ${tab.credential.browserToken}`,
          },
        })
      ).status,
    ).toBe(204)
    expect((await mcp(authenticated.token, 9, "resources/read", { uri: indexUri })).status).toBe(
      401,
    )
    expect(
      (
        await mcp(authenticated.token, 10, "tools/call", {
          name: "read_agent_skill",
          arguments: {},
        })
      ).status,
    ).toBe(401)
  })

  it("registers Codex native metadata while discarding unsupported extension fields", async () => {
    const redirect = "http://127.0.0.1:49854/callback/test-client"
    const response = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Codex",
        redirect_uris: [redirect],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
        response_types: ["code"],
        scope: "editor:session",
        application_type: "native",
        contacts: ["test-client@example.com"],
        policy_uri: "https://client.example/policy",
        software_version: "0.160.0",
      }),
    })
    expect(response.status).toBe(201)
    const registered = (await response.json()) as { client_id: string }
    expect(registered).toMatchObject({
      client_name: "Codex",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    })
    for (const ignored of ["application_type", "contacts", "policy_uri", "software_version"]) {
      expect(registered).not.toHaveProperty(ignored)
    }
    expect(registered).not.toHaveProperty("client_secret")
    await authorizationPage(registered.client_id, redirect)
  })

  it("does not let extension metadata bypass redirects, grants, or scopes", async () => {
    for (const invalid of [
      { redirect_uris: ["codex://callback"] },
      { grant_types: ["client_credentials"] },
      { scope: "editor:session admin" },
      { token_endpoint_auth_method: "private_key_jwt" },
    ]) {
      const response = await call("/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://client.example/callback"],
          application_type: "native",
          ...invalid,
        }),
      })
      expect(response.status).toBe(400)
    }
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(0)
  })

  it.each([
    "https://client.example/callback?context=one",
    "http://127.0.0.1:8977/callback",
    "http://[::1]:8977/callback",
  ])("completes PKCE through a fresh navigation with restrictive CSP for %s", async (uri) => {
    const tab = await pair()
    const granted = await authorizeTab(tab, uri)
    expect(granted.token).toBeTruthy()
  })

  it.each(["https://*.example/callback", "https://example;script-src/callback"])(
    "does not interpolate client hostnames into consent CSP for %s",
    async (uri) => {
      const client = await registeredClient(uri)
      const page = await authorizationPage(client.client_id, uri)
      const nonce = /<script nonce="([A-Za-z0-9_-]+)">/.exec(page.html)?.[1]
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(page.policy).toBe(
        `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      )
    },
  )

  it("fails closed before tab allocation for missing config, hostile origin, and a wrong challenge hostname", async () => {
    const allocatedBefore = (await listDurableObjectIds(bindings.TAB_SESSIONS)).length
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
    expect(await listDurableObjectIds(bindings.TAB_SESSIONS)).toHaveLength(allocatedBefore)
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

  it("caps pairing attempts per IP while preserving the global daily budget", async () => {
    const admission = bindings.ADMISSION.getByName("global")
    const ipHash = "a".repeat(64)
    for (let attempt = 0; attempt < 12; attempt++) {
      expect(await admission.admit("session", ipHash)).toBe(true)
    }
    expect(await admission.admit("session", ipHash)).toBe(false)
    expect(await admission.admit("session", "b".repeat(64))).toBe(false)
  })

  it("caps unauthenticated registration before SDK KV writes and active tabs before per-tab allocation", async () => {
    const allocatedBefore = (await listDurableObjectIds(bindings.TAB_SESSIONS)).length
    const payload = JSON.stringify({ redirect_uris: ["https://client.example/callback"] })
    for (let count = 0; count < 12; count++) {
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
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(12)
    ip = `198.51.100.${++address}`
    for (let count = 0; count < 12; count++) {
      expect(
        (
          await call("/oauth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          })
        ).status,
      ).toBe(201)
    }
    ip = `198.51.100.${++address}`
    expect(
      (
        await call("/oauth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        })
      ).status,
    ).toBe(429)
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(24)
    const tab = await pair()
    expect(tab.credential.browserToken).toHaveLength(43)
    const unknown = await call(`/browser/socket/${crypto.randomUUID()}`, {
      headers: { Origin: "https://editor.example", Upgrade: "websocket" },
    })
    expect(unknown.status).toBe(410)
    expect(await listDurableObjectIds(bindings.TAB_SESSIONS)).toHaveLength(allocatedBefore + 1)
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
    expect(await listDurableObjectIds(bindings.TAB_SESSIONS)).toHaveLength(allocatedBefore + 3)
  })

  it("allows twelve OAuth consent pages per IP and preserves the global budget before SDK writes", async () => {
    const client = await registeredClient()
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      scope: "editor:session",
      state: "admission-test-state",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      resource: "https://mcp.example/mcp",
    })
    const path = `/authorize?${query}`
    for (let count = 0; count < 12; count++) expect((await call(path)).status).toBe(200)
    const beforeIpRejection = (await bindings.OAUTH_KV.list()).keys.length
    expect((await call(path)).status).toBe(429)
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(beforeIpRejection)
    ip = `198.51.100.${++address}`
    for (let count = 0; count < 12; count++) expect((await call(path)).status).toBe(200)
    ip = `198.51.100.${++address}`
    const beforeGlobalRejection = (await bindings.OAUTH_KV.list()).keys.length
    expect((await call(path)).status).toBe(429)
    expect((await bindings.OAUTH_KV.list()).keys).toHaveLength(beforeGlobalRejection)
  })

  it("requires the SDK browser-bound one-use consent and rejects cross-origin consent", async () => {
    const client = await registeredClient()
    const page = await authorizationPage(client.client_id)
    const body = new URLSearchParams({
      handle: page.handle,
      pairingCode: "A".repeat(16),
    }).toString()
    for (const origin of ["https://hostile.example", "null"])
      expect(
        (
          await call("/authorize", {
            method: "POST",
            headers: {
              Origin: origin,
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
    const eventStream = await call("/mcp", {
      headers: {
        Authorization: `Bearer ${authenticated.token}`,
        Accept: "text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
    })
    expect(eventStream.status).toBe(405)
    expect(eventStream.headers.get("Allow")).toBe("POST")
    expect(await eventStream.json()).toEqual({ error: "sse_not_supported" })
    const listed = await mcp(authenticated.token, 1, "tools/list")
    expect(listed.status).toBe(200)
    const catalog = (await listed.json()) as { result: { tools: { name: string }[] } }
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("create_hole")
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("change_metadata")
    expect(catalog.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "create_datum_plane",
        "update_datum_plane",
        "create_boolean",
        "update_boolean",
        "create_union",
        "update_union",
        "create_compound",
        "update_compound",
      ]),
    )
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
    const body = {
      schemaVersion: 0,
      featureId: "0195b5ac-b250-7a2c-8c33-000000000004",
      outputRole: "split.negative",
    }
    const unionArguments = {
      draftId: "0195b5ac-b250-7a2c-8c33-000000000001",
      commandId: "0195b5ac-b250-7a2c-8c33-000000000002",
      featureId: "0195b5ac-b250-7a2c-8c33-000000000003",
      baseRevision: 7,
      dependencies: [body.featureId],
      references: [],
      suppressed: false,
      parameters: { bodies: [body, { ...body, outputRole: "split.positive" }] },
    }
    const unionWork = nextMessage(a.socket)
    const unionResponse = mcp(authenticated.token, 10, "tools/call", {
      name: "create_union",
      arguments: unionArguments,
    })
    const unionOperation = await unionWork
    expect(unionOperation).toMatchObject({
      type: "work",
      operation: { tool: "create_union", arguments: unionArguments },
    })
    if (unionOperation.type !== "work") throw new Error("Expected body combination browser work.")
    a.socket.send(
      JSON.stringify({
        type: "result",
        protocolVersion: 1,
        requestId: unionOperation.requestId,
        tool: "create_union",
        result: localFailure("fixture-draft", "Tab A draft"),
      }),
    )
    expect(await (await unionResponse).json()).toMatchObject({
      result: { structuredContent: { result: { diagnostic: { message: "Tab A draft" } } } },
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
