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
import { agentSkillResources } from "@vibeshape/automation-api/agent-skills"
import { BINARY_EXPORT_CHUNK_MAX_BYTES } from "@vibeshape/automation-api/binary-exports"
import { lightweightingOperationSchema } from "@vibeshape/automation-api/lightweighting-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { quickLightweightingOperationSchema } from "@vibeshape/automation-api/quick-lightweighting-tools"
import {
  remotePairResponseSchema,
  remoteServerMessageSchema,
} from "@vibeshape/automation-api/remote-session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  lightweightingId,
  lightweightingOperation,
  lightweightingSnapshot,
  lightweightingStiffnessSummary,
  lightweightingSummary,
} from "../../../packages/automation-api/src/lightweighting.test-fixtures"
import {
  quickLightweightingOperation,
  quickLightweightingValue,
} from "../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { nativeImportInspection } from "../../../tests/support/native-import-inspection"
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
  vi.useRealTimers()
  for (const socket of sockets.splice(0)) socket.close()
  vi.unstubAllGlobals()
  await reset()
})

it.each(["direction", "documentId"] as const)(
  "forwards guarded dependency pages and rejects a different %s",
  async (field) => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const entity = { kind: "sketch" as const, id: "0195b5ac-b280-7a2c-8c33-000000000001" }
    const result = {
      ok: true,
      value: {
        kind: "org.vibeshape.cad.dependencies",
        schemaVersion: 1,
        documentId: "0195b5ac-b280-7a2c-8c33-000000000002",
        revision: 4,
        entity,
        direction: "dependents",
        transitive: false,
        classification: "semantic",
        nextCursor: null,
        data: { coverage: "complete", total: 0, items: [] },
      },
    }
    const send = async (requestId: number, value: typeof result) => {
      const work = nextMessage(tab.socket)
      const response = mcp(authenticated.token, requestId, "tools/call", {
        name: "model_dependencies",
        arguments: { revision: 4, entity, projectId: result.value.documentId },
      })
      const operation = await work
      if (operation.type !== "work") throw new Error("Expected dependency inspection work.")
      tab.socket.send(
        JSON.stringify({
          type: "result",
          protocolVersion: 1,
          requestId: operation.requestId,
          tool: "model_dependencies",
          result: value,
        }),
      )
      return (await response).json()
    }
    expect(await send(1, result)).toMatchObject({ result: { structuredContent: { result } } })
    const changed = structuredClone(result)
    changed.value[field] =
      field === "direction" ? "dependencies" : "0195b5ac-b280-7a2c-8c33-000000000099"
    expect(await send(2, changed)).toMatchObject({
      result: {
        structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
      },
    })
    expect(
      await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  },
)

it.each(["variableId", "revision", "transitive", "documentId", "nextCursor"] as const)(
  "correlates saved variable usage %s before forwarding remote success",
  async (field) => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const variableId = "0195b5ac-b280-7a2c-8c33-000000000001"
    const result = {
      ok: true,
      value: {
        kind: "org.vibeshape.cad.variable-usage",
        schemaVersion: 1,
        documentId: "0195b5ac-b280-7a2c-8c33-000000000002",
        revision: 4,
        variableId,
        variableName: "root",
        transitive: false,
        classification: "semantic",
        nextCursor: null,
        data: { coverage: "complete", total: 0, items: [], diagnosticTotal: 0, diagnostics: [] },
      },
    }
    const send = async (requestId: number, value: unknown) => {
      const work = nextMessage(tab.socket)
      const response = mcp(authenticated.token, requestId, "tools/call", {
        name: "model_variable_usage",
        arguments: { revision: 4, variableId, projectId: result.value.documentId },
      })
      const operation = await work
      if (operation.type !== "work") throw new Error("Expected variable usage inspection work.")
      tab.socket.send(
        JSON.stringify({
          type: "result",
          protocolVersion: 1,
          requestId: operation.requestId,
          tool: "model_variable_usage",
          result: value,
        }),
      )
      return (await response).json()
    }
    expect(await send(1, result)).toMatchObject({ result: { structuredContent: { result } } })
    const changed = {
      ...result,
      value: {
        ...result.value,
        [field]:
          field === "revision"
            ? 3
            : field === "transitive"
              ? true
              : field === "nextCursor"
                ? "1"
                : "0195b5ac-b280-7a2c-8c33-000000000099",
      },
    }
    expect(await send(2, changed)).toMatchObject({
      result: {
        structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
      },
    })
    expect(
      await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  },
)

it.each(["draftId", "revision", "outputRole", "rebuildId"] as const)(
  "correlates draft body inspection %s before forwarding remote success",
  async (field) => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const documentId = "0195b5ac-b280-7a2c-8c33-000000000001"
    const draftId = "0195b5ac-b280-7a2c-8c33-000000000002"
    const featureId = "0195b5ac-b280-7a2c-8c33-000000000003"
    const provenance = {
      documentId,
      revision: 4,
      generation: 7,
      rebuildId: "fresh-rebuild",
      featureId,
      contentHash: "a".repeat(64),
      outputRole: "result",
      topologyKind: "face",
    }
    const args = {
      draftId,
      revision: 4,
      featureId,
      outputRole: "result",
      topologyKind: "face",
      cursor: field === "rebuildId" ? { ...provenance, offset: 0 } : null,
      limit: 10,
    }
    const result = {
      ok: true,
      value: {
        schemaVersion: 1,
        draft: {
          schemaVersion: 1,
          draftId,
          documentId,
          baseRevision: 3,
          revision: 4,
          commandCount: 1,
          expiresAt: "2026-10-04T12:00:00.000Z",
        },
        view: {
          ...provenance,
          kind: "org.vibeshape.model.body-topology",
          schemaVersion: 1,
          classification: "derived",
          nextCursor: null,
          data: { topology: [], total: 0 },
        },
      },
    }
    const sendResult = async (requestId: number, value: typeof result) => {
      const work = nextMessage(tab.socket)
      const response = mcp(authenticated.token, requestId, "tools/call", {
        name: "draft_body_topology",
        arguments: args,
      })
      const operation = await work
      if (operation.type !== "work") throw new Error("Expected browser work")
      tab.socket.send(
        JSON.stringify({
          type: "result",
          protocolVersion: 1,
          requestId: operation.requestId,
          tool: "draft_body_topology",
          result: value,
        }),
      )
      return (await response).json()
    }
    expect(await sendResult(1, result)).toMatchObject({ result: { structuredContent: { result } } })
    const changed = structuredClone(result)
    if (field === "draftId") changed.value.draft.draftId = documentId
    if (field === "revision") {
      changed.value.draft.revision = 5
      changed.value.view.revision = 5
    }
    if (field === "outputRole") changed.value.view.outputRole = "other"
    if (field === "rebuildId") changed.value.view.rebuildId = "other-rebuild"
    expect(await sendResult(2, changed)).toMatchObject({
      result: {
        structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
      },
    })
    expect(
      await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  },
)

function previewOptions(
  quality: "overview" | "detail" | undefined,
  framing: "default" | "camera" | "views",
) {
  const resolved = quality ?? "overview"
  const requestedQuality = quality ? { quality } : {}
  if (framing === "camera") {
    const camera = { position: [30, -30, 20], target: [0, 0, 5], viewHeightMm: 12 }
    return {
      resolved,
      options: { ...requestedQuality, camera },
      evidence: { camera },
      views: ["custom"],
    }
  }
  if (framing === "views") {
    const views = ["top", "front"]
    return { resolved, options: { ...requestedQuality, views }, evidence: {}, views }
  }
  return {
    resolved,
    options: requestedQuality,
    evidence: {},
    views: resolved === "detail" ? ["isometric", "front", "right", "top"] : ["isometric"],
  }
}

describe("remote MCP in workerd", () => {
  it.each(["document", "base", "direction", "command"] as const)(
    "revokes a well-shaped forged history %s result",
    async (forged) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const documentId = "0195b5ac-b280-7a2c-8c33-000000000004"
      const commandId = "0195b5ac-b280-7a2c-8c33-000000000777"
      const exact = {
        documentId,
        baseRevision: 4,
        revision: 5,
        commandId,
        direction: "undo",
        targetRevision: 3,
      }
      const send = async (id: number, value: typeof exact) => {
        const work = nextMessage(tab.socket)
        const pending = mcp(authenticated.token, id, "tools/call", {
          name: "undo_model",
          arguments: { documentId, baseRevision: 4, commandId },
        })
        const operation = await work
        if (operation.type !== "work") throw new Error("Expected history browser work")
        tab.socket.send(
          JSON.stringify({
            type: "result",
            protocolVersion: 1,
            requestId: operation.requestId,
            tool: "undo_model",
            result: { ok: true, value },
          }),
        )
        return (await pending).json()
      }
      expect(await send(1, exact)).toMatchObject({
        result: { structuredContent: { result: { ok: true } } },
      })
      const altered = {
        document: { ...exact, documentId: commandId },
        base: { ...exact, baseRevision: 3, revision: 4 },
        direction: { ...exact, direction: "redo" },
        command: { ...exact, commandId: documentId },
      }
      expect(await send(2, altered[forged])).toMatchObject({
        result: {
          structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
        },
      })
      expect(
        await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
          sessionId: tab.credential.sessionId,
          clientId: authenticated.clientId,
        }),
      ).toBe(false)
    },
  )
  it.each(["revision", "featureId"] as const)(
    "revokes a surface texture read receipt with the wrong %s",
    async (field) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const featureId = "0195b5ac-b280-7a2c-8c33-000000000001"
      const value = {
        schemaVersion: 1,
        documentId: "0195b5ac-b280-7a2c-8c33-000000000002",
        revision: 4,
        featureId,
        layers: [],
      }
      const send = async (id: number, patch: Record<string, unknown>) => {
        const work = nextMessage(tab.socket)
        const pending = mcp(authenticated.token, id, "tools/call", {
          name: "model_surface_textures",
          arguments: { revision: 4, featureId },
        })
        const operation = await work
        if (operation.type !== "work") throw new Error("Expected surface texture work")
        tab.socket.send(
          JSON.stringify({
            type: "result",
            protocolVersion: 1,
            requestId: operation.requestId,
            tool: "model_surface_textures",
            result: { ok: true, value: { ...value, ...patch } },
          }),
        )
        return (await pending).json()
      }
      expect(await send(1, {})).toMatchObject({
        result: { structuredContent: { result: { ok: true, value } } },
      })
      expect(
        await send(2, field === "revision" ? { revision: 5 } : { featureId: value.documentId }),
      ).toMatchObject({
        result: {
          structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
        },
      })
      expect(
        await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
          sessionId: tab.credential.sessionId,
          clientId: authenticated.clientId,
        }),
      ).toBe(false)
    },
  )
  it("revokes a forged exact-solid result for a mesh import", async () => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const value = nativeImportInspection("stl")
    const work = nextMessage(tab.socket)
    const pending = mcp(authenticated.token, 1, "tools/call", {
      name: "inspect_import_upload",
      arguments: { uploadId: value.upload.uploadId },
    })
    const operation = await work
    if (operation.type !== "work") throw new Error("Expected import inspection work.")
    tab.socket.send(
      JSON.stringify({
        type: "result",
        protocolVersion: 1,
        requestId: operation.requestId,
        tool: "inspect_import_upload",
        result: {
          ok: true,
          value: {
            ...value,
            representation: "exact-solid",
            outputs: value.outputs.map((output) => ({ ...output, volumeMm3: 1 })),
          },
        },
      }),
    )
    expect(await (await pending).json()).toMatchObject({
      result: {
        structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
      },
    })
    expect(
      await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  })

  it.each(["duplicate", "reversed-duplicate", "foreign", "missing", "extra"] as const)(
    "requires exact unique interference coverage and revokes a %s response",
    async (invalid) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const a = "0195b5ac-b280-7a2c-8c33-000000000001"
      const b = "0195b5ac-b280-7a2c-8c33-000000000002"
      const c = "0195b5ac-b280-7a2c-8c33-000000000003"
      const interference = (leftInstanceId: string, rightInstanceId: string) => ({
        leftInstanceId,
        rightInstanceId,
        status: "clear",
        volume: 0,
        solidCount: 0,
      })
      const send = async (id: number, pairs: ReturnType<typeof interference>[]) => {
        const work = nextMessage(tab.socket)
        const pending = mcp(authenticated.token, id, "tools/call", {
          name: "inspect_assembly",
          arguments: {
            revision: 4,
            interferencePairs: [
              { leftInstanceId: a, rightInstanceId: b },
              { leftInstanceId: a, rightInstanceId: c },
            ],
          },
        })
        const operation = await work
        if (operation.type !== "work") throw new Error("Expected browser inspection work.")
        tab.socket.send(
          JSON.stringify({
            type: "result",
            protocolVersion: 1,
            requestId: operation.requestId,
            tool: "inspect_assembly",
            result: {
              ok: true,
              value: {
                schemaVersion: 1,
                documentId: "0195b5ac-b280-7a2c-8c33-000000000004",
                revision: 4,
                occurrences: [],
                interference: pairs,
              },
            },
          }),
        )
        return (await pending).json()
      }
      expect(await send(1, [interference(c, a), interference(b, a)])).toMatchObject({
        result: { structuredContent: { result: { ok: true } } },
      })
      const invalidPairs = {
        duplicate: [interference(a, b), interference(a, b)],
        "reversed-duplicate": [interference(a, b), interference(b, a)],
        foreign: [interference(a, b), interference(b, c)],
        missing: [interference(a, b)],
        extra: [interference(a, b), interference(a, c), interference(b, c)],
      }
      expect(await send(2, invalidPairs[invalid])).toMatchObject({
        result: {
          structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
        },
      })
      expect(
        await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
          sessionId: tab.credential.sessionId,
          clientId: authenticated.clientId,
        }),
      ).toBe(false)
    },
  )
  it.each([
    ["model", undefined, "default", null],
    ["model", "detail", "default", null],
    ["model", "overview", "camera", null],
    ["draft", "detail", "camera", null],
    ["draft", "overview", "views", null],
    ["model", "detail", "views", null],
    ["model", undefined, "default", "quality"],
    ["model", undefined, "default", "missing"],
    ["model", undefined, "default", "views"],
  ] as const)(
    "correlates remote %s preview quality=%s framing=%s change=%s",
    async (source, quality, framing, change) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
      const { resolved, options, evidence, views } = previewOptions(quality, framing)
      const draftId = "0195b5ac-b250-7a2c-8c33-000000000002"
      const args = {
        source,
        revision: 4,
        ...(source === "draft" ? { draftId } : {}),
        ...options,
      }
      const work = nextMessage(tab.socket)
      const pending = mcp(authenticated.token, 1, "tools/call", {
        name: "render_preview",
        arguments: args,
      })
      const operation = await work
      if (operation.type !== "work") throw new Error("Expected owned browser work.")
      expect(operation.operation).toMatchObject({ tool: "render_preview", arguments: args })
      const value = {
        source,
        documentId: "0195b5ac-b250-7a2c-8c33-000000000001",
        revision: 4,
        generation: 1,
        geometryStatus: "valid",
        bodyCount: 1,
        quality: change === "quality" ? "detail" : resolved,
        ...(source === "draft" ? { draftId, baseRevision: 3 } : {}),
        ...evidence,
        image: {
          mimeType: "image/png",
          base64: png,
          width: 1,
          height: 1,
          views: change === "views" ? ["isometric", "front", "right", "top"] : views,
        },
      }
      if (change === "missing") Reflect.deleteProperty(value, "quality")
      const revoked = change ? nextMessage(tab.socket) : null
      tab.socket.send(
        JSON.stringify({
          type: "result",
          protocolVersion: 1,
          requestId: operation.requestId,
          tool: "render_preview",
          result: { ok: true, value },
        }),
      )
      const response = (await (await pending).json()) as {
        result: { content: unknown[]; structuredContent: unknown }
      }
      if (revoked) {
        expect(response.result).toMatchObject({ structuredContent: { result: { ok: false } } })
        expect(response.result.content).not.toContainEqual(
          expect.objectContaining({ type: "image" }),
        )
        expect((await revoked).type).toBe("revoked")
        return
      }
      expect(response.result.content).toContainEqual({
        type: "image",
        data: png,
        mimeType: "image/png",
      })
      expect(response.result.content).toHaveLength(2)
      expect(response.result.structuredContent).toMatchObject({
        result: { ok: true, value: { quality: resolved, image: { views } } },
      })
      expect(JSON.stringify(response.result.structuredContent)).not.toContain(png)
    },
  )
  it.each([
    { quick: null, request: false },
    { quick: true, request: false },
    { quick: true, request: true },
    { quick: false, request: false },
    { quick: false, request: true },
  ])(
    "keeps CAD work alive beyond ten minutes and honors revocation (quick=$quick, request=$request)",
    async ({ quick, request }) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      vi.useFakeTimers()
      const command =
        quick === null
          ? { tool: "model_info", arguments: {} }
          : quick
            ? quickLightweightingOperation(request)
            : lightweightingOperation(request)
      const work = nextMessage(tab.socket)
      const pending = mcp(authenticated.token, 1, "tools/call", {
        name: command.tool,
        arguments: command.arguments,
      })
      expect((await work).type).toBe("work")
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      const stub = bindings.TAB_SESSIONS.getByName(tab.credential.sessionId)
      expect(
        await stub.isAuthorized({
          sessionId: tab.credential.sessionId,
          clientId: authenticated.clientId,
        }),
      ).toBe(true)
      await stub.revokeBrowser(tab.credential.browserToken)
      expect(await (await pending).json()).toMatchObject({
        result: {
          structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
        },
      })
    },
  )

  it.each(["jobId", "documentId", "nestedRevision", null] as const)(
    "routes numerical receipts and rejects forged job status (%s)",
    async (forged) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const jobId = lightweightingId(30)
      const documentId = lightweightingId(3)
      const command = quickLightweightingOperation(true)
      const receipt = { jobId, documentId, baseRevision: 4, tool: command.tool, status: "running" }
      const send = async (id: number, tool: string, args: unknown, value: unknown) => {
        const work = nextMessage(tab.socket)
        const pending = mcp(authenticated.token, id, "tools/call", { name: tool, arguments: args })
        const operation = await work
        if (operation.type !== "work") throw new Error("Expected numerical job work.")
        tab.socket.send(
          JSON.stringify({
            type: "result",
            protocolVersion: 1,
            requestId: operation.requestId,
            tool,
            result: { ok: true, value },
          }),
        )
        return (await pending).json()
      }
      expect(
        await send(1, command.tool, { ...command.arguments, projectId: documentId }, receipt),
      ).toMatchObject({ result: { structuredContent: { result: { ok: true, value: receipt } } } })
      const cancelling = { ...receipt, status: "cancelling", result: null }
      expect(
        await send(2, "cancel_numerical_job", { jobId, projectId: documentId }, cancelling),
      ).toMatchObject({
        result: { structuredContent: { result: { ok: true, value: cancelling } } },
      })
      const original = quickLightweightingValue(true)
      const completed = {
        ...receipt,
        status: "completed",
        result: {
          ok: true,
          value: { ...original, baseRevision: forged === "nestedRevision" ? 3 : 4 },
        },
        ...(forged === "jobId" ? { jobId: lightweightingId(99) } : {}),
        ...(forged === "documentId" ? { documentId: lightweightingId(99) } : {}),
      }
      const response = await send(
        3,
        "get_numerical_job",
        { jobId, projectId: documentId },
        completed,
      )
      if (forged) {
        expect(response).toMatchObject({
          result: {
            structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
          },
        })
        expect(
          await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
            sessionId: tab.credential.sessionId,
            clientId: authenticated.clientId,
          }),
        ).toBe(false)
      } else
        expect(response).toMatchObject({
          result: { structuredContent: { result: { ok: true, value: completed } } },
        })
    },
  )

  it.each([
    { quick: false, request: false, variant: false },
    { quick: false, request: true, variant: false },
    { quick: true, request: false, variant: false },
    { quick: true, request: true, variant: false },
    { quick: false, request: false, variant: true },
    { quick: true, request: false, variant: true },
  ])(
    "routes bounded lightweighting evidence and revokes a forged source (quick=$quick, request=$request, variant=$variant)",
    async ({ quick, request, variant }) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const base = quick ? quickLightweightingOperation(request) : lightweightingOperation(request)
      const command = !variant
        ? base
        : quick
          ? quickLightweightingOperationSchema.parse({
              ...base,
              arguments: {
                ...base.arguments,
                settings: {
                  ...base.arguments.settings,
                  cellType: "schwarz-d",
                  latticeCellSizeMm: 9,
                },
              },
            })
          : lightweightingOperationSchema.parse({
              ...base,
              arguments: {
                ...base.arguments,
                settings: {
                  ...base.arguments.settings,
                  objective: { kind: "maximize-stiffness", retainedMassFraction: 0.8 },
                },
              },
            })
      const quickValue = quickLightweightingValue(request)
      const value = quick
        ? {
            ...quickValue,
            ...(variant
              ? { summary: { ...quickValue.summary, cellType: "schwarz-d", latticeCellSizeMm: 9 } }
              : {}),
          }
        : {
            documentId: lightweightingId(3),
            baseRevision: 4,
            source: command.arguments.source,
            summary: variant ? lightweightingStiffnessSummary() : lightweightingSummary(),
            ...(request ? { snapshot: lightweightingSnapshot() } : {}),
          }
      const send = async (id: number, output: unknown) => {
        const work = nextMessage(tab.socket)
        const pending = mcp(authenticated.token, id, "tools/call", {
          name: command.tool,
          arguments: command.arguments,
        })
        const operation = await work
        if (operation.type !== "work") throw new Error("Expected paired lightweighting work.")
        expect(operation.operation).toEqual(command)
        tab.socket.send(
          JSON.stringify({
            type: "result",
            protocolVersion: 1,
            requestId: operation.requestId,
            tool: command.tool,
            result: { ok: true, value: output },
          }),
        )
        return (await pending).json()
      }
      expect(await send(1, value)).toMatchObject({
        result: { structuredContent: { result: { ok: true, value } } },
      })
      expect(
        await send(2, { ...value, source: { ...value.source, contentHash: "b".repeat(64) } }),
      ).toMatchObject({
        result: {
          structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
        },
      })
      expect(
        await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
          sessionId: tab.credential.sessionId,
          clientId: authenticated.clientId,
        }),
      ).toBe(false)
    },
  )
  it("rejects oversized browser results after serving the larger static schema catalog", async () => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const catalog = await mcp(authenticated.token, 1, "tools/list")
    expect(catalog.status).toBe(200)
    expect(new TextEncoder().encode(await catalog.text()).byteLength).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    )
    const work = nextMessage(tab.socket)
    const pending = mcp(authenticated.token, 2, "tools/call", { name: "model_info", arguments: {} })
    const operation = await work
    if (operation.type !== "work") throw new Error("Expected owned browser work.")
    tab.socket.send(
      JSON.stringify({
        type: "result",
        protocolVersion: 1,
        requestId: operation.requestId,
        tool: "model_info",
        result: {
          ok: false,
          diagnostic: {
            code: "oversized-fixture",
            message: "x".repeat(193 * 1024),
            retryable: false,
          },
        },
      }),
    )
    expect(await (await pending).json()).toMatchObject({ result: { isError: true } })
    expect(
      await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  })
  it.each(["throw", "missing"] as const)(
    "releases pending Quick work when browser dispatch is %s",
    async (mode) => {
      const tab = await pair()
      const authenticated = await authorizeTab(tab)
      const stub = bindings.TAB_SESSIONS.getByName(tab.credential.sessionId)
      const grant = { sessionId: tab.credential.sessionId, clientId: authenticated.clientId }
      let restore = () => {}
      try {
        await runInDurableObject(stub, (_instance, state) => {
          if (mode === "throw") {
            const socket = state.getWebSockets()[0]
            if (!socket) throw new Error("Expected the authenticated browser socket.")
            const send = vi.spyOn(socket, "send").mockImplementationOnce(() => {
              throw new Error("The socket closed during dispatch.")
            })
            restore = () => send.mockRestore()
          } else {
            // Authorization and post-save liveness pass; the socket disappears at dispatch.
            const sockets = state.getWebSockets.bind(state)
            const read = vi
              .spyOn(state, "getWebSockets")
              .mockImplementationOnce(sockets)
              .mockImplementationOnce(sockets)
              .mockImplementationOnce(sockets)
              .mockReturnValueOnce([])
            restore = () => read.mockRestore()
          }
        })
        const operation = quickLightweightingOperation(false)
        const response = await mcp(authenticated.token, 1, "tools/call", {
          name: operation.tool,
          arguments: operation.arguments,
        })
        expect(await response.json()).toMatchObject({
          result: {
            isError: true,
            structuredContent: { result: { diagnostic: { code: "outcome-unknown" } } },
          },
        })
        expect(await stub.isAuthorized(grant)).toBe(false)
        await runInDurableObject(stub, async (_instance, state) => {
          expect(await state.storage.get("session")).toMatchObject({
            revoked: true,
            active: null,
            activeKey: null,
          })
        })
        expect(
          await stub.invoke(grant, "f".repeat(64), { tool: "model_info", arguments: {} }),
        ).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
      } finally {
        restore()
      }
    },
  )

  it("rejects a successful draft result when the session expires during result persistence", async () => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const stub = bindings.TAB_SESSIONS.getByName(tab.credential.sessionId)
    const grant = { sessionId: tab.credential.sessionId, clientId: authenticated.clientId }
    const work = nextMessage(tab.socket)
    const response = mcp(authenticated.token, 1, "tools/call", {
      name: "create_draft",
      arguments: { baseRevision: 0 },
    })
    const operation = await work
    if (operation.type !== "work") throw new Error("Expected browser work")
    let restoreSave = () => {}
    try {
      await runInDurableObject(stub, (_instance, state) => {
        const put = state.storage.put
        const save = vi.spyOn(state.storage, "put").mockImplementationOnce(async (...args) => {
          expect(args[0]).toBe("session")
          expect(args[1]).toMatchObject({ revoked: false, active: null, activeKey: null })
          const expiresAt = Date.now() + 25
          // Keep the live metadata and persisted deadline identical while delaying save completion.
          Object.assign(args[1] ?? {}, { expiresAt })
          expect(Date.now()).toBeLessThan(expiresAt)
          await Reflect.apply(put, state.storage, args)
          await new Promise((resolve) => setTimeout(resolve, 50))
          expect(Date.now()).toBeGreaterThanOrEqual(expiresAt)
        })
        restoreSave = () => save.mockRestore()
      })
      const revoked = nextMessage(tab.socket)
      tab.socket.send(
        JSON.stringify({
          type: "result",
          protocolVersion: 1,
          requestId: operation.requestId,
          tool: "create_draft",
          result: {
            ok: true,
            value: {
              schemaVersion: 1,
              draftId: "0195b5ac-b280-7a2c-8c33-000000000002",
              documentId: "0195b5ac-b280-7a2c-8c33-000000000001",
              baseRevision: 0,
              revision: 0,
              commandCount: 0,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        }),
      )
      expect(await (await response).json()).toMatchObject({
        result: {
          structuredContent: { result: { ok: false, diagnostic: { code: "outcome-unknown" } } },
        },
      })
      expect((await revoked).type).toBe("revoked")
      expect(await stub.isAuthorized(grant)).toBe(false)
      await runInDurableObject(stub, async (_instance, state) => {
        expect(await state.storage.get("session")).toMatchObject({
          revoked: true,
          active: null,
          activeKey: null,
        })
      })
    } finally {
      restoreSave()
    }
  })

  it("relays a maximum binary chunk and revokes a mismatched export offset without widening message limits", async () => {
    const tab = await pair()
    const authenticated = await authorizeTab(tab)
    const exportId = "0195b5ac-b250-7a2c-8c33-000000000001"
    const value = {
      exportId,
      documentId: "0195b5ac-b250-7a2c-8c33-000000000002",
      revision: 4,
      offset: 0,
      totalBytes: BINARY_EXPORT_CHUNK_MAX_BYTES,
      byteLength: BINARY_EXPORT_CHUNK_MAX_BYTES,
      base64: "A".repeat((BINARY_EXPORT_CHUNK_MAX_BYTES / 3) * 4),
      nextOffset: null,
    }
    async function dispatch(requestId: number, requestedOffset: number) {
      const work = nextMessage(tab.socket)
      const response = mcp(authenticated.token, requestId, "tools/call", {
        name: "read_export_chunk",
        arguments: { exportId, offset: requestedOffset, limit: BINARY_EXPORT_CHUNK_MAX_BYTES },
      })
      const operation = await work
      if (operation.type !== "work") throw new Error("Expected binary export work.")
      const revoked = requestedOffset !== value.offset ? nextMessage(tab.socket) : null
      tab.socket.send(
        JSON.stringify({
          type: "result",
          protocolVersion: 1,
          requestId: operation.requestId,
          tool: "read_export_chunk",
          result: { ok: true, value },
        }),
      )
      return { response: await response, revoked }
    }
    const { response } = await dispatch(1, 0)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(512 * 1024)
    expect(JSON.parse(body)).toMatchObject({
      result: { structuredContent: { result: { ok: true, value } } },
    })
    const rejected = await dispatch(2, 1)
    expect(await rejected.response.json()).toMatchObject({
      result: { structuredContent: { result: { ok: false } } },
    })
    if (!rejected.revoked) throw new Error("Expected the mismatch revocation.")
    expect((await rejected.revoked).type).toBe("revoked")
    expect(
      await bindings.TAB_SESSIONS.getByName(tab.credential.sessionId).isAuthorized({
        sessionId: tab.credential.sessionId,
        clientId: authenticated.clientId,
      }),
    ).toBe(false)
  })

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
      const tools = (await client.listTools()).tools
      const projectList = tools.find((tool) => tool.name === "list_projects")
      const dependencies = tools.find((tool) => tool.name === "model_dependencies")
      expect(dependencies?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true })
      expect(dependencies?.inputSchema.required).toEqual(["revision", "entity"])
      expect(dependencies?.inputSchema.properties?.direction).toMatchObject({
        default: "dependents",
      })
      const variableUsage = tools.find((tool) => tool.name === "model_variable_usage")
      expect(variableUsage?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true })
      expect(variableUsage?.inputSchema.required).toEqual(["revision", "variableId"])
      expect(variableUsage?.inputSchema.properties?.transitive).toMatchObject({ default: false })
      expect(variableUsage?.inputSchema.properties?.cursor).toMatchObject({ default: null })
      expect(variableUsage?.inputSchema.properties?.limit).toMatchObject({
        default: 100,
        maximum: 100,
      })
      expect(projectList).toBeDefined()
      expect(projectList?.inputSchema.required ?? []).not.toContain("limit")
      expect(projectList?.inputSchema.properties?.limit).toMatchObject({ default: 50 })
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "model_info",
          "create_body_revolve",
          "update_body_revolve",
          "create_body_subtract",
          "update_body_subtract",
          "draft_body_measurements",
          "draft_body_topology",
          "create_face_extent_extrude",
          "update_face_extent_extrude",
          "create_reference_mirror",
          "update_reference_mirror",
          "create_reference_split",
          "update_reference_split",
          "create_reference_body_pattern",
          "update_reference_body_pattern",
          "update_box",
          "create_cylinder",
          "update_cylinder",
          "create_cone",
          "update_cone",
          "create_sphere",
          "update_sphere",
          "create_torus",
          "update_torus",
          "create_pyramid",
          "update_pyramid",
          "remove_feature",
          "remove_sketch",
          "set_feature_suppressed",
          "rename_project",
          "prepare_model_export",
          "prepare_project_backup",
          "read_export_chunk",
          "discard_export",
        ]),
      )
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
    expect(resources.result.resources).toHaveLength(agentSkillResources.length)
    expect(resources.result.resources).toContainEqual(
      expect.objectContaining({
        uri: "vibeshape://agent-skills/vibeshape-modeling/references/native-import.md",
      }),
    )
    expect(resources.result.resources).not.toContainEqual(
      expect.objectContaining({ uri: "vibeshape://model" }),
    )
    const indexUri = "vibeshape://agent-skills"
    expect(
      resources.result.resources.some((resource) => resource.uri.endsWith("/planar-import.md")),
    ).toBe(true)
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
    expect(new TextEncoder().encode(await listed.clone().text()).byteLength).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    )
    const catalog = (await listed.json()) as { result: { tools: { name: string }[] } }
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("create_hole")
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("change_metadata")
    expect(catalog.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "analyze_lightweighting",
        "request_lightweighting",
        "analyze_quick_lightweighting",
        "request_quick_lightweighting",
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
