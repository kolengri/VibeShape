import { REMOTE_SCOPE, remoteClientSchema } from "@vibeshape/automation-api/remote-session"
import { createConsentPage } from "./consent-page"
import type { RemoteConfig, RemoteEnv } from "./environment"
import { digest, escaped, failure, readBoundedBody } from "./request-security"

export function authorize(request: Request, env: RemoteEnv, config: RemoteConfig, ipHash: string) {
  if (request.method === "GET") return createConsent(request, env, ipHash)
  if (request.method === "POST") return approveConsent(request, env, config)
  return failure(405, "unsupported_method")
}

async function createConsent(request: Request, env: RemoteEnv, ipHash: string) {
  const api = env.OAUTH_PROVIDER
  const auth = await api.parseAuthRequest(request)
  if (
    auth.codeChallengeMethod !== "S256" ||
    !auth.codeChallenge ||
    auth.state.length < 1 ||
    auth.state.length > 512 ||
    auth.scope.some((scope) => scope !== REMOTE_SCOPE)
  )
    return failure(400, "invalid_authorization_request")
  if (!(await env.ADMISSION.getByName("global").admit("consent", ipHash)))
    return failure(429, "admission_limit")
  const description = await api.describeConsent(auth)
  const consent = await api.beginConsent(auth)
  const page = createConsentPage(description, consent.handle)
  const headers = new Headers(consent.headers)
  headers.set("Content-Type", "text/html; charset=utf-8")
  headers.set("Cache-Control", "no-store")
  headers.set("Referrer-Policy", "same-origin")
  headers.set("Content-Security-Policy", page.policy)
  return new Response(page.html, { headers })
}

async function approveConsent(request: Request, env: RemoteEnv, config: RemoteConfig) {
  const api = env.OAUTH_PROVIDER
  const form = await consentForm(request, config)
  if (form instanceof Response) return form
  // The official SDK consumes the one-use handle and checks its host-only browser cookie.
  const approved = await api.approveConsent(request, form.handle, { scope: [REMOTE_SCOPE] })
  const session = await env.ADMISSION.getByName("global").lookup({
    codeHash: await digest(form.code),
  })
  if (!session) return failure(404, "pairing_not_available")
  const info = await api.lookupClient(approved.request.clientId)
  if (!info) return failure(400, "unknown_client")
  const client = remoteClientSchema.parse({
    clientId: info.clientId,
    name: info.clientName ?? "MCP client",
    redirectUri: approved.request.redirectUri,
  })
  const tab = env.TAB_SESSIONS.getByName(session.id)
  if (!(await tab.authorize(client))) return failure(403, "tab_consent_denied")
  try {
    const completed = await api.completeAuthorization({
      request: approved.request,
      userId: session.id,
      metadata: {},
      scope: [REMOTE_SCOPE],
      props: { sessionId: session.id, clientId: client.clientId },
      revokeExistingGrants: false,
    })
    const headers = new Headers(approved.headers)
    // A fresh navigation avoids Chromium's form-redirect CSP check, including IPv6 callbacks.
    headers.set("Refresh", `0;url=${completed.redirectTo}`)
    headers.set("Content-Type", "text/html; charset=utf-8")
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    )
    headers.set("Cache-Control", "no-store")
    headers.set("Referrer-Policy", "no-referrer")
    return new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Return to your MCP client</title><body><h1>MCP authorization complete</h1><p><a href="${escaped(completed.redirectTo)}">Return to your MCP client</a></p></body></html>`,
      { headers },
    )
  } catch (error) {
    await tab.cancel()
    throw error
  }
}

async function consentForm(request: Request, config: RemoteConfig) {
  if (request.headers.get("Origin") !== config.publicOrigin)
    return failure(403, "invalid_consent_origin")
  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/x-www-form-urlencoded"))
    return failure(415, "form_required")
  const body = new URLSearchParams(await readBoundedBody(request, 4096))
  const handle = body.get("handle") ?? ""
  const code = (body.get("pairingCode") ?? "").toUpperCase()
  if (handle.length > 2048 || !/^[A-F0-9]{16}$/.test(code))
    return failure(400, "invalid_pairing_code")
  return { handle, code }
}
