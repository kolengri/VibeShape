import { z } from "zod"

export const ASSISTANT_REQUEST_CHANNEL = "vibeshape:assistant:request"
export const ASSISTANT_EVENT_CHANNEL = "vibeshape:assistant:event"

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes("\0"))
const label = z.string().max(512)
const scope = { projectId: id, sessionToken: id }
const choice = z.strictObject({ id, name: label })

export const assistantAgentSchema = z.strictObject({
  command: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
  args: z
    .array(
      z
        .string()
        .max(4096)
        .refine((value) => !value.includes("\0")),
    )
    .max(64),
})
export const assistantConnectSchema = z.strictObject({
  projectId: id,
  agent: assistantAgentSchema,
  resumeSessionId: id.optional(),
})
export const assistantScopeSchema = z.strictObject(scope)
export const assistantPromptSchema = z.strictObject({
  ...scope,
  text: z
    .string()
    .min(1)
    .max(32_768)
    .refine((value) => value.trim().length > 0),
})
export const assistantPermissionSchema = z.strictObject({
  ...scope,
  requestId: id,
  allow: z.boolean(),
})
export const assistantModeSchema = z.strictObject({ ...scope, modeId: id })
export const assistantModelSchema = z.strictObject({ ...scope, modelId: id })
export const assistantAuthenticateSchema = z.strictObject({ ...scope, methodId: id })

export const assistantErrorCodeSchema = z.enum([
  "invalid-request",
  "forbidden",
  "launch-failed",
  "initialization-failed",
  "protocol-error",
  "agent-exited",
  "authentication-required",
  "agent-busy",
  "stale-session",
  "unsupported",
  "permission-expired",
  "request-failed",
  "timeout",
  "mcp-client-conflict",
])
export const assistantSnapshotSchema = z.strictObject({
  ...scope,
  status: z.enum([
    "connecting",
    "ready",
    "prompting",
    "cancelling",
    "authentication-required",
    "disconnected",
    "error",
  ]),
  sessionId: id.nullable(),
  canResume: z.boolean(),
  modes: z.array(choice).max(100),
  currentModeId: id.nullable(),
  models: z.array(choice).max(100),
  currentModelId: id.nullable(),
  authMethods: z.array(choice).max(32),
})
export const assistantResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: assistantSnapshotSchema }),
  z.strictObject({ ok: z.literal(false), code: assistantErrorCodeSchema }),
])
export const assistantRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("connect"), input: assistantConnectSchema }),
  z.strictObject({ operation: z.literal("prompt"), input: assistantPromptSchema }),
  z.strictObject({ operation: z.literal("cancel"), input: assistantScopeSchema }),
  z.strictObject({ operation: z.literal("disconnect"), input: assistantScopeSchema }),
  z.strictObject({ operation: z.literal("respondPermission"), input: assistantPermissionSchema }),
  z.strictObject({ operation: z.literal("setMode"), input: assistantModeSchema }),
  z.strictObject({ operation: z.literal("setModel"), input: assistantModelSchema }),
  z.strictObject({ operation: z.literal("authenticate"), input: assistantAuthenticateSchema }),
])
export const assistantEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...scope, type: z.literal("snapshot"), snapshot: assistantSnapshotSchema }),
  z.strictObject({ ...scope, type: z.literal("text"), text: z.string().max(32_768) }),
  z.strictObject({ ...scope, type: z.literal("thought"), text: z.string().max(32_768) }),
  z.strictObject({
    ...scope,
    type: z.literal("tool"),
    toolCallId: id,
    title: label.optional(),
    status: label.optional(),
    text: z.string().max(32_768).optional(),
  }),
  z.strictObject({
    ...scope,
    type: z.literal("permission"),
    requestId: id,
    title: label,
    canAllow: z.boolean(),
    expiresAt: z.number().int().positive(),
  }),
  z.strictObject({ ...scope, type: z.literal("permission-resolved"), requestId: id }),
  z.strictObject({ ...scope, type: z.literal("completed"), stopReason: label }),
  z.strictObject({ ...scope, type: z.literal("error"), code: assistantErrorCodeSchema }),
])

export type AssistantAgent = z.infer<typeof assistantAgentSchema>
export type AssistantSnapshot = z.infer<typeof assistantSnapshotSchema>
export type AssistantEvent = z.infer<typeof assistantEventSchema>
export type AssistantResult = z.infer<typeof assistantResultSchema>
export type AssistantRequest = z.infer<typeof assistantRequestSchema>
export type AssistantErrorCode = z.infer<typeof assistantErrorCodeSchema>
export type AssistantBridge = Readonly<{
  protocolVersion: 1
  connect(input: z.infer<typeof assistantConnectSchema>): Promise<AssistantResult>
  prompt(input: z.infer<typeof assistantPromptSchema>): Promise<AssistantResult>
  cancel(input: z.infer<typeof assistantScopeSchema>): Promise<AssistantResult>
  disconnect(input: z.infer<typeof assistantScopeSchema>): Promise<AssistantResult>
  respondPermission(input: z.infer<typeof assistantPermissionSchema>): Promise<AssistantResult>
  setMode(input: z.infer<typeof assistantModeSchema>): Promise<AssistantResult>
  setModel(input: z.infer<typeof assistantModelSchema>): Promise<AssistantResult>
  authenticate(input: z.infer<typeof assistantAuthenticateSchema>): Promise<AssistantResult>
  onEvent(callback: (event: AssistantEvent) => void): () => void
}>
