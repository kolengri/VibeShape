import { commandActorSchema } from "@vibeshape/domain/commands"
import { documentIdSchema, generateUuidV7, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { localOperationSchema, localToolNameSchema, localToolOutputs } from "./local-tools"

export const LOCAL_AUTOMATION_PATH = "/__vibeshape/automation"
export const LOCAL_AUTOMATION_PORT = 43114
const protocolVersion = z.literal(1)
export const localDocumentSchema = z
  .object({ id: documentIdSchema, name: z.string().min(1).max(120), revision: revisionSchema })
  .strict()
const clientSchema = z
  .object({ name: z.string().min(1).max(120), version: z.string().max(64) })
  .strict()
export const localStatusSchema = z
  .object({ protocolVersion, client: clientSchema.nullable(), paired: z.boolean() })
  .strict()
export const localConnectRequestSchema = z
  .object({ protocolVersion, document: localDocumentSchema })
  .strict()
export const localConnectResponseSchema = z
  .object({
    protocolVersion,
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    actor: commandActorSchema.refine((actor) => actor.type === "mcp"),
    expiresAt: z.number().int().positive(),
    client: clientSchema,
  })
  .strict()
const requestId = z.string().uuid()
export const localProgressSchema = z
  .object({ requestId, stage: z.enum(["executing", "review", "applying"]) })
  .strict()
export const localPollRequestSchema = z
  .object({
    protocolVersion,
    sequence: z.number().int().positive().safe(),
    document: localDocumentSchema,
    progress: localProgressSchema.nullable(),
  })
  .strict()
export const localWorkSchema = z.object({ requestId, operation: localOperationSchema }).strict()
export const localPollResponseSchema = z
  .object({
    protocolVersion,
    work: localWorkSchema.nullable(),
    cancelledRequestIds: z.array(requestId).max(1),
  })
  .strict()
// The route validates the result again using the pending operation's exact output schema.
export const localResultRequestSchema = z
  .object({ protocolVersion, requestId, tool: localToolNameSchema, result: z.unknown() })
  .strict()
  .superRefine((value, context) => {
    if (!localToolOutputs[value.tool].safeParse(value.result).success)
      context.addIssue({ code: "custom", path: ["result"], message: "Invalid operation result." })
  })
export type LocalDocument = z.infer<typeof localDocumentSchema>
export type LocalConnection = z.infer<typeof localConnectResponseSchema>
export type LocalWork = z.infer<typeof localWorkSchema>
export type LocalProgress = z.infer<typeof localProgressSchema>
export function createLocalAutomationActor(timestampMs: number, randomBytes: Uint8Array) {
  return commandActorSchema.parse({
    type: "mcp",
    clientId: "org.vibeshape.mcp.local-client",
    sessionId: generateUuidV7({ timestampMs, randomBytes }),
  })
}
