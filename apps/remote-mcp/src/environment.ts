import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider"
import { z } from "zod"
import type { Admission } from "./admission"
import type { TabSession } from "./tab-session"

export interface RemoteEnv {
  ADMISSION: DurableObjectNamespace<Admission>
  TAB_SESSIONS: DurableObjectNamespace<TabSession>
  OAUTH_KV: KVNamespace
  OAUTH_PROVIDER: OAuthHelpers
  IP_LIMIT: RateLimit
  PUBLIC_ORIGIN: string
  EDITOR_ORIGIN: string
  TURNSTILE_SITE_KEY: string
  TURNSTILE_SECRET_KEY: string
  MAX_ACTIVE_SESSIONS?: string
  MAX_SESSIONS_PER_DAY?: string
  MAX_CLIENTS_PER_DAY?: string
  MAX_CONSENTS_PER_DAY?: string
  MAX_TOKEN_REQUESTS_PER_DAY?: string
}
const httpsOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password
  })
const quota = (fallback: number) => z.coerce.number().int().min(1).max(128).default(fallback)
const configSchema = z
  .object({
    publicOrigin: httpsOrigin,
    editorOrigin: httpsOrigin,
    siteKey: z.string().min(1).max(256),
    active: quota(3),
    sessions: quota(12),
    clients: quota(24),
    consents: quota(24),
    tokens: quota(48),
  })
  // Conservatively reserve KV writes for consent, grant, issuance and registration, below Free's 1,000/day.
  .refine((config) => config.clients * 2 + config.consents * 4 + config.tokens * 4 <= 800)
export function remoteConfig(env: RemoteEnv) {
  return configSchema.parse({
    publicOrigin: env.PUBLIC_ORIGIN,
    editorOrigin: env.EDITOR_ORIGIN,
    siteKey: env.TURNSTILE_SITE_KEY,
    active: env.MAX_ACTIVE_SESSIONS,
    sessions: env.MAX_SESSIONS_PER_DAY,
    clients: env.MAX_CLIENTS_PER_DAY,
    consents: env.MAX_CONSENTS_PER_DAY,
    tokens: env.MAX_TOKEN_REQUESTS_PER_DAY,
  })
}
export type RemoteConfig = ReturnType<typeof remoteConfig>
