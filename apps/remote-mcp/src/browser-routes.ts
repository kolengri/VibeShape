import {
  createRemoteAutomationActor,
  remotePairRequestSchema,
  remotePairResponseSchema,
} from "@vibeshape/automation-api/remote-session"
import { z } from "zod"
import type { RemoteConfig, RemoteEnv } from "./environment"
import { digest, failure, pairingCode, randomToken, readBoundedBody } from "./request-security"
import type { TabSession } from "./tab-session"

const verifiedChallengeSchema = z
  .object({
    success: z.boolean(),
    hostname: z.string().optional(),
    action: z.string().optional(),
  })
  .passthrough()
const uuid = z.string().uuid()

async function createPair(request: Request, env: RemoteEnv, config: RemoteConfig, ipHash: string) {
  const admission = env.ADMISSION.getByName("global")
  if (!env.TURNSTILE_SECRET_KEY) return failure(503, "admission_not_configured")
  if (request.headers.get("Content-Type") !== "application/json")
    return failure(415, "json_required")
  const input = remotePairRequestSchema.parse(JSON.parse(await readBoundedBody(request, 4096)))
  if (!(await admission.admit("session", ipHash))) return failure(429, "admission_limit")
  const rejected = await verifyChallenge(request, env, config, input.turnstileToken)
  if (rejected) return rejected
  const actor = createRemoteAutomationActor(Date.now(), crypto.getRandomValues(new Uint8Array(10)))
  const id = actor.sessionId
  const code = pairingCode()
  const expiresAt = await admission.allocate(id, await digest(code))
  if (!expiresAt) return failure(429, "active_session_limit")
  const token = randomToken()
  try {
    await env.TAB_SESSIONS.getByName(id).initialize({
      id,
      tokenHash: await digest(token),
      actor,
      expiresAt,
    })
  } catch (error) {
    await admission.release(id)
    throw error
  }
  return Response.json(
    remotePairResponseSchema.parse({
      protocolVersion: 1,
      sessionId: id,
      browserToken: token,
      pairingCode: code,
      expiresAt,
    }),
    { headers: { "Cache-Control": "no-store" } },
  )
}

async function verifyChallenge(
  request: Request,
  env: RemoteEnv,
  config: RemoteConfig,
  token: string,
) {
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!verification.ok) return failure(503, "admission_unavailable")
  const challenge = verifiedChallengeSchema.parse(await verification.json())
  if (
    !challenge.success ||
    challenge.hostname !== new URL(config.editorOrigin).hostname ||
    challenge.action !== "vibeshape-pair"
  )
    return failure(403, "invalid_challenge")
  return null
}

export async function browserRoute(
  request: Request,
  env: RemoteEnv,
  config: RemoteConfig,
  ipHash: string,
) {
  if (request.headers.get("Origin") !== config.editorOrigin)
    return failure(403, "untrusted_editor_origin")
  const pathname = new URL(request.url).pathname
  if (request.method === "OPTIONS") return new Response(null, { status: 204 })
  if (pathname === "/browser/config" && request.method === "GET")
    return Response.json({ siteKey: config.siteKey }, { headers: { "Cache-Control": "no-store" } })
  if (pathname === "/browser/pair" && request.method === "POST") {
    return createPair(request, env, config, ipHash)
  }
  return pairedRoute(request, env, pathname)
}

async function pairedRoute(request: Request, env: RemoteEnv, pathname: string) {
  const admission = env.ADMISSION.getByName("global")
  const match = /^\/browser\/(socket|revoke)\/([^/]+)$/.exec(pathname)
  if (!match) return failure(404, "unknown_route")
  const id = uuid.safeParse(match[2])
  if (!id.success) return failure(404, "unknown_route")
  if (!(await admission.lookup({ id: id.data }))) return failure(410, "session_expired")
  const tab = env.TAB_SESSIONS.getByName(id.data)
  if (match[1] === "socket")
    return request.method === "GET" ? tab.fetch(request) : failure(405, "unsupported_method")
  if (request.method === "POST") return revokeBrowser(request, tab)
  return failure(405, "unsupported_method")
}

async function revokeBrowser(request: Request, tab: DurableObjectStub<TabSession>) {
  const header = request.headers.get("Authorization") ?? ""
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return failure(401, "invalid_browser_token")
  if (!(await tab.revokeBrowser(header.slice(7)))) return failure(401, "invalid_browser_token")
  return new Response(null, { status: 204 })
}

export function browserCors(response: Response, config: RemoteConfig) {
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  headers.set("Access-Control-Allow-Origin", config.editorOrigin)
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  headers.set("Vary", "Origin")
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, { status: response.status, headers })
}
