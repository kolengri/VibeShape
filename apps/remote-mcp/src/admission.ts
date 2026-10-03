import { DurableObject } from "cloudflare:workers"
import { REMOTE_SESSION_TTL_MS } from "@vibeshape/automation-api/remote-session"
import { z } from "zod"
import { type RemoteEnv, remoteConfig } from "./environment"

const kindSchema = z.enum(["session", "client", "consent", "token"])
type Kind = z.infer<typeof kindSchema>
const sessionSchema = z
  .object({ id: z.string().uuid(), codeHash: z.string().length(64), expiresAt: z.number() })
  .strict()
const stateSchema = z
  .object({
    day: z.number().int(),
    counts: z.record(kindSchema, z.number().int().nonnegative()),
    ips: z
      .record(z.string().length(64), z.record(kindSchema, z.number().int().nonnegative()))
      .refine((ips) => Object.keys(ips).length <= 128),
    sessions: z.array(sessionSchema).max(128),
  })
  .strict()
const emptyCounts = () => ({ session: 0, client: 0, consent: 0, token: 0 })

// The public service can address only this one fixed object before admission.
export class Admission extends DurableObject<RemoteEnv> {
  private async state(storage: DurableObjectTransaction) {
    const saved = await storage.get<unknown>("admission")
    const now = Date.now()
    const day = Math.floor(now / 86_400_000)
    const parsed = saved === undefined ? null : stateSchema.parse(saved)
    return {
      day,
      counts: parsed?.day === day ? parsed.counts : emptyCounts(),
      ips: parsed?.day === day ? parsed.ips : {},
      sessions: parsed?.sessions.filter((session) => session.expiresAt > now) ?? [],
    }
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async admit(inputKind: Kind, ipHash: string) {
    const kind = kindSchema.parse(inputKind)
    z.string().length(64).parse(ipHash)
    const config = remoteConfig(this.env)
    const ceilings: Record<Kind, number> = {
      session: config.sessions,
      client: config.clients,
      consent: config.consents,
      token: config.tokens,
    }
    const ipCeilings: Record<Kind, number> = { session: 6, client: 6, consent: 6, token: 12 }
    return this.ctx.storage.transaction(async (storage) => {
      const state = await this.state(storage)
      const ip = state.ips[ipHash] ?? emptyCounts()
      if (state.counts[kind] >= ceilings[kind] || ip[kind] >= ipCeilings[kind]) return false
      if (!state.ips[ipHash] && Object.keys(state.ips).length >= 128) return false
      ip[kind] += 1
      state.counts[kind] += 1
      state.ips[ipHash] = ip
      await storage.put("admission", stateSchema.parse(state))
      return true
    })
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async allocate(id: string, codeHash: string) {
    const allocated = sessionSchema.parse({
      id,
      codeHash,
      expiresAt: Date.now() + REMOTE_SESSION_TTL_MS,
    })
    return this.ctx.storage.transaction(async (storage) => {
      const state = await this.state(storage)
      if (state.sessions.length >= remoteConfig(this.env).active) return null
      if (state.sessions.some((session) => session.id === id || session.codeHash === codeHash))
        return null
      state.sessions.push(allocated)
      await storage.put("admission", stateSchema.parse(state))
      return allocated.expiresAt
    })
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async lookup(input: { id: string } | { codeHash: string }) {
    return this.ctx.storage.transaction(async (storage) => {
      const state = await this.state(storage)
      const session = state.sessions.find((session) =>
        "id" in input ? session.id === input.id : session.codeHash === input.codeHash,
      )
      return session ? { id: session.id, expiresAt: session.expiresAt } : null
    })
  }

  // fallow-ignore-next-line unused-class-member -- Called through Cloudflare Durable Object RPC.
  async release(id: string) {
    await this.ctx.storage.transaction(async (storage) => {
      const state = await this.state(storage)
      state.sessions = state.sessions.filter((session) => session.id !== id)
      await storage.put("admission", stateSchema.parse(state))
    })
  }
}
