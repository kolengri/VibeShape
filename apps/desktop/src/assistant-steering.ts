import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { z } from "zod"

// This adapter version supplies the thread-status lifecycle required by startedNewTurn.
const capability = z.object({
  agentInfo: z.object({
    name: z.literal("@agentclientprotocol/codex-acp"),
    version: z.literal("2.2.2"),
  }),
  _meta: z.object({ steering: z.object({ supported: z.literal(true) }) }),
})
const threadStatus = z.object({
  codex: z.object({
    threadStatus: z.object({ type: z.enum(["active", "idle", "systemError", "notLoaded"]) }),
  }),
})
export const assistantSteerOutcomeSchema = z.object({
  outcome: z.enum(["injected", "startedNewTurn", "failed"]),
})

export function supportsAssistantSteering(initialization: unknown) {
  return capability.safeParse(initialization).success
}

export function assistantSteeringThreadStatus(update: SessionUpdate) {
  if (update.sessionUpdate !== "session_info_update") return null
  const parsed = threadStatus.safeParse(update._meta)
  return parsed.success ? parsed.data.codex.threadStatus.type : null
}
