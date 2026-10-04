import { generateUuidV7, sessionIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { localResultRequestSchema, localWorkSchema } from "./local-session"
import { localOperationSchema } from "./local-tools"

export const REMOTE_MESSAGE_MAX_BYTES = 192 * 1024
export const REMOTE_SESSION_TTL_MS = 60 * 60 * 1000
export const REMOTE_REQUEST_TIMEOUT_MS = 6 * 60 * 1000
export const REMOTE_SESSION_MAX_OPERATIONS = 128
export const REMOTE_SCOPE = "editor:session"

const sessionId = z.string().uuid()
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const remoteActorSchema = z
  .object({
    type: z.literal("mcp"),
    clientId: z.literal("org.vibeshape.mcp.remote-client"),
    sessionId: sessionIdSchema,
  })
  .strict()
export const remotePairRequestSchema = z
  .object({ protocolVersion: z.literal(1), turnstileToken: z.string().min(1).max(2048) })
  .strict()
export const remotePairResponseSchema = z
  .object({
    protocolVersion: z.literal(1),
    sessionId,
    browserToken: token,
    pairingCode: z.string().regex(/^[A-F0-9]{16}$/),
    expiresAt: z.number().int().positive().safe(),
  })
  .strict()
export const remoteClientSchema = z
  .object({
    clientId: z.string().min(1).max(256),
    name: z.string().min(1).max(120),
    redirectUri: z.string().url().max(2048),
  })
  .strict()
export const remoteGrantSchema = z
  .object({ sessionId, clientId: remoteClientSchema.shape.clientId })
  .strict()
// The legacy monolithic file export stays local; bounded prepared-file chunks use shared tools.
export const remoteOperationSchema = localOperationSchema.refine(
  (operation) => operation.tool !== "export_model",
  "Use prepared-file chunk tools for remote export.",
)
export const remoteBrowserMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticate"), token }).strict(),
  z.object({ type: z.literal("consent"), requestId: sessionId, approved: z.boolean() }).strict(),
  localResultRequestSchema.extend({ type: z.literal("result") }).strict(),
])
export const remoteServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paired"), sessionId, expiresAt: z.number().int() }).strict(),
  z
    .object({ type: z.literal("ready"), actor: remoteActorSchema, expiresAt: z.number().int() })
    .strict(),
  z
    .object({ type: z.literal("consent"), requestId: sessionId, client: remoteClientSchema })
    .strict(),
  localWorkSchema.extend({ type: z.literal("work") }).strict(),
  z.object({ type: z.literal("revoked") }).strict(),
])
export type RemotePair = z.infer<typeof remotePairResponseSchema>
export type RemoteClient = z.infer<typeof remoteClientSchema>
export type RemoteGrant = z.infer<typeof remoteGrantSchema>
export type RemoteServerMessage = z.infer<typeof remoteServerMessageSchema>

export function createRemoteAutomationActor(timestampMs: number, randomBytes: Uint8Array) {
  return remoteActorSchema.parse({
    type: "mcp",
    clientId: "org.vibeshape.mcp.remote-client",
    sessionId: generateUuidV7({ timestampMs, randomBytes }),
  })
}
