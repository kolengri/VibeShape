import { AuthorizationError, OAuthError, OAuthProvider } from "@cloudflare/workers-oauth-provider"
import { REMOTE_SCOPE, remoteGrantSchema } from "@vibeshape/automation-api/remote-session"
import { z } from "zod"
import { browserCors, browserRoute } from "./browser-routes"
import { authorize } from "./consent"
import { type RemoteConfig, type RemoteEnv, remoteConfig } from "./environment"
import { mcpRequest } from "./mcp"
import { digest, failure, RequestBudgetError, readBoundedBody } from "./request-security"

export { Admission } from "./admission"
export { TabSession } from "./tab-session"

const redirectUri = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    )
  })
const clientMetadata = z
  .object({
    redirect_uris: z.array(redirectUri).min(1).max(4),
    client_name: z.string().min(1).max(120).optional(),
    client_uri: z.string().url().max(2048).optional(),
    logo_uri: z.string().url().max(2048).optional(),
    grant_types: z
      .array(z.enum(["authorization_code", "refresh_token"]))
      .min(1)
      .max(2)
      .optional(),
    response_types: z.array(z.literal("code")).min(1).max(1).optional(),
    token_endpoint_auth_method: z
      .enum(["none", "client_secret_basic", "client_secret_post"])
      .optional(),
    scope: z.literal(REMOTE_SCOPE).optional(),
  })
  .strict()

function provider(env: RemoteEnv) {
  const config = remoteConfig(env)
  return new OAuthProvider<RemoteEnv>({
    apiRoute: "/mcp",
    apiHandler: { fetch: mcpRequest },
    defaultHandler: {
      async fetch(request, environment) {
        const pathname = new URL(request.url).pathname
        const ipHash = await digest(
          `${Math.floor(Date.now() / 86_400_000)}:${request.headers.get("CF-Connecting-IP") ?? "unavailable"}`,
        )
        if (pathname === "/authorize") return authorize(request, environment, config, ipHash)
        return failure(404, "unknown_route")
      },
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    accessTokenTTL: 900,
    refreshTokenTTL: 0,
    clientRegistrationTTL: 86_400,
    allowTokenExchangeGrant: false,
    allowPrivateUseRedirectUris: false,
    clientIdMetadataDocumentEnabled: false,
    scopesSupported: [REMOTE_SCOPE],
    requiredScopes: [REMOTE_SCOPE],
    resourceMetadata: {
      resource: `${config.publicOrigin}/mcp`,
      authorization_servers: [config.publicOrigin],
    },
    clientRegistrationCallback({ clientMetadata: input }) {
      if (!clientMetadata.safeParse(input).success)
        return {
          code: "invalid_client_metadata",
          description:
            "Only bounded authorization-code client metadata and HTTPS or loopback redirects are supported.",
        }
    },
    async tokenExchangeCallback(input) {
      const grant = remoteGrantSchema.safeParse(input.props)
      if (
        !grant.success ||
        input.clientId !== grant.data.clientId ||
        !(await input.env.TAB_SESSIONS.getByName(grant.data.sessionId).isAuthorized(grant.data))
      )
        throw new OAuthError("invalid_grant", {
          description: "The browser pairing was revoked or expired.",
        })
    },
    // SDK errors must not echo credentials, request bodies, or internal storage details.
    onError(error) {
      return failure(error.status, error.code)
    },
  })
}

async function oauthRequest(
  original: Request,
  env: RemoteEnv,
  ctx: ExecutionContext,
  ipHash: string,
) {
  const pathname = new URL(original.url).pathname
  if (!env.OAUTH_KV) return failure(503, "oauth_not_configured")
  let request = original
  if (original.body) {
    const limit = pathname === "/mcp" ? 192 * 1024 : 8192
    const body = await readBoundedBody(original, limit)
    request = new Request(original, { body })
  }
  const rejected = await admitOAuth(request, env, pathname, ipHash)
  if (rejected) return rejected
  const response = await provider(env).fetch(request, env, ctx)
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  headers.set("Referrer-Policy", "no-referrer")
  return new Response(response.body, { status: response.status, headers })
}

async function admitOAuth(request: Request, env: RemoteEnv, pathname: string, ipHash: string) {
  if (pathname.startsWith("/oauth/register/")) return failure(404, "unknown_route")
  const kind = pathname === "/oauth/register" ? "client" : "token"
  if (pathname !== "/oauth/register" && pathname !== "/oauth/token") return null
  if (request.method !== "POST") return failure(405, "unsupported_method")
  if (kind === "client" && !clientMetadata.safeParse(await request.clone().json()).success)
    return failure(400, "invalid_client_metadata")
  if (!(await env.ADMISSION.getByName("global").admit(kind, ipHash)))
    return failure(429, "admission_limit")
  return null
}

function requestOrigin(request: Request, config: RemoteConfig) {
  const url = new URL(request.url)
  if (url.origin !== config.publicOrigin || request.url.length > 8192)
    return failure(400, "invalid_request_origin")
  const origin = request.headers.get("Origin")
  if (origin && origin !== config.editorOrigin && origin !== config.publicOrigin)
    return failure(403, "untrusted_origin")
  return null
}

function rejectedRequest(error: unknown) {
  if (error instanceof RequestBudgetError) return failure(413, "request_rejected")
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    error instanceof AuthorizationError
  )
    return failure(400, "request_rejected")
  return failure(503, "request_rejected")
}

async function admitRequest(request: Request, env: RemoteEnv) {
  if (!env.IP_LIMIT) return false
  const result = await env.IP_LIMIT.limit({
    key: request.headers.get("CF-Connecting-IP") ?? "unavailable",
  })
  return result.success
}

export default {
  async fetch(original: Request, env: RemoteEnv, ctx: ExecutionContext) {
    let config: ReturnType<typeof remoteConfig>
    try {
      config = remoteConfig(env)
    } catch {
      return failure(503, "remote_not_configured")
    }
    const invalidOrigin = requestOrigin(original, config)
    if (invalidOrigin) return invalidOrigin
    if (!(await admitRequest(original, env))) return failure(429, "request_limit")
    const ipHash = await digest(
      `${Math.floor(Date.now() / 86_400_000)}:${original.headers.get("CF-Connecting-IP") ?? "unavailable"}`,
    )
    const isBrowserRoute = new URL(original.url).pathname.startsWith("/browser/")
    try {
      if (isBrowserRoute)
        return browserCors(await browserRoute(original, env, config, ipHash), config)
      return await oauthRequest(original, env, ctx, ipHash)
    } catch (error) {
      const response = rejectedRequest(error)
      return isBrowserRoute ? browserCors(response, config) : response
    }
  },
} satisfies ExportedHandler<RemoteEnv>
