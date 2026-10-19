import { z } from "zod"
import { utf8StringBytes } from "./query-byte-budget"

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
const configOption = z.strictObject({
  id,
  name: label,
  category: id.optional(),
  description: label.optional(),
  currentValue: id,
  options: z.array(choice).max(100),
})
export const ASSISTANT_MAX_ATTACHMENTS = 5
export const ASSISTANT_MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024
function imageBytes(value: string) {
  return (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0)
}
const attachmentIdentity = { id, name: z.string().min(1).max(512) }
const imageData = z
  .string()
  .min(4)
  .max(Math.ceil(ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .refine(
    (value) => value.length % 4 === 0 && imageBytes(value) <= ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES,
  )
export const assistantAttachmentSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...attachmentIdentity,
    type: z.literal("text"),
    mimeType: z.string().min(1).max(128),
    text: z
      .string()
      .max(ASSISTANT_MAX_TEXT_ATTACHMENT_BYTES)
      .refine(
        (value) =>
          utf8StringBytes(value, ASSISTANT_MAX_TEXT_ATTACHMENT_BYTES) <=
          ASSISTANT_MAX_TEXT_ATTACHMENT_BYTES,
      ),
  }),
  z.strictObject({
    ...attachmentIdentity,
    type: z.literal("image"),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    data: imageData,
  }),
])
export const assistantAttachmentsSchema = z
  .array(assistantAttachmentSchema)
  .max(ASSISTANT_MAX_ATTACHMENTS)
  .refine(
    (attachments) =>
      attachments.reduce(
        (bytes, attachment) =>
          bytes +
          (attachment.type === "text"
            ? utf8StringBytes(attachment.text)
            : imageBytes(attachment.data)),
        0,
      ) <= ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES,
  )
const attachmentCapabilities = z.strictObject({ text: z.boolean(), images: z.boolean() })
const questionField = z
  .strictObject({
    id,
    label,
    description: label.optional(),
    required: z.boolean(),
    secret: z.boolean(),
    options: z
      .array(z.strictObject({ ...choice.shape, description: label.optional() }))
      .max(32)
      .optional(),
    minLength: z.number().int().min(0).max(16_384).optional(),
    maxLength: z.number().int().min(0).max(16_384).optional(),
  })
  .refine((field) => (field.minLength ?? 0) <= (field.maxLength ?? 16_384))
export const assistantQuestionSchema = z.strictObject({
  requestId: id,
  message: z.string().max(4096),
  expiresAt: z.number().int().positive(),
  fields: z.array(questionField).min(1).max(16),
})

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
export const assistantPromptSchema = z
  .strictObject({
    ...scope,
    text: z
      .string()
      .max(32_768)
      .refine((value) => !value.includes("\0")),
    attachments: assistantAttachmentsSchema.default([]),
  })
  .refine((value) => value.text.trim().length > 0 || value.attachments.length > 0)
export const assistantSteerSchema = assistantPromptSchema.safeExtend({ requestId: id })
export const assistantPermissionSchema = z.strictObject({
  ...scope,
  requestId: id,
  allow: z.boolean(),
})
export const assistantModeSchema = z.strictObject({ ...scope, modeId: id })
export const assistantModelSchema = z.strictObject({ ...scope, modelId: id })
export const assistantConfigOptionSchema = z.strictObject({ ...scope, configId: id, value: id })
export const assistantAuthenticateSchema = z.strictObject({ ...scope, methodId: id })
export const assistantQuestionResponseSchema = z.strictObject({
  ...scope,
  requestId: id,
  answers: z
    .record(id, z.string().max(16_384))
    .refine((value) => Object.keys(value).length <= 16)
    .nullable(),
})

export const assistantErrorCodeSchema = z.enum([
  "invalid-request",
  "forbidden",
  "launch-failed",
  "initialization-failed",
  "protocol-error",
  "agent-exited",
  "authentication-required",
  "agent-busy",
  "queue-full",
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
  canSteer: z.boolean().optional(),
  modes: z.array(choice).max(100),
  currentModeId: id.nullable(),
  models: z.array(choice).max(100),
  currentModelId: id.nullable(),
  configOptions: z.array(configOption).max(32).default([]),
  attachmentCapabilities: attachmentCapabilities.default({ text: false, images: false }),
  authMethods: z.array(choice).max(32),
})
export const assistantResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    value: assistantSnapshotSchema,
    steerOutcome: z.enum(["injected", "startedNewTurn"]).optional(),
  }),
  z.strictObject({ ok: z.literal(false), code: assistantErrorCodeSchema }),
])
export const assistantRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("connect"), input: assistantConnectSchema }),
  z.strictObject({ operation: z.literal("prompt"), input: assistantPromptSchema }),
  z.strictObject({ operation: z.literal("steer"), input: assistantSteerSchema }),
  z.strictObject({ operation: z.literal("cancel"), input: assistantScopeSchema }),
  z.strictObject({ operation: z.literal("disconnect"), input: assistantScopeSchema }),
  z.strictObject({ operation: z.literal("respondPermission"), input: assistantPermissionSchema }),
  z.strictObject({ operation: z.literal("setMode"), input: assistantModeSchema }),
  z.strictObject({ operation: z.literal("setModel"), input: assistantModelSchema }),
  z.strictObject({ operation: z.literal("setConfigOption"), input: assistantConfigOptionSchema }),
  z.strictObject({
    operation: z.literal("respondQuestion"),
    input: assistantQuestionResponseSchema,
  }),
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
  z.strictObject({ ...scope, type: z.literal("question"), question: assistantQuestionSchema }),
  z.strictObject({ ...scope, type: z.literal("question-resolved"), requestId: id }),
  z.strictObject({ ...scope, type: z.literal("completed"), stopReason: label }),
  z.strictObject({ ...scope, type: z.literal("error"), code: assistantErrorCodeSchema }),
])

export type AssistantAgent = z.infer<typeof assistantAgentSchema>
export type AssistantSnapshot = z.infer<typeof assistantSnapshotSchema>
export type AssistantEvent = z.infer<typeof assistantEventSchema>
export type AssistantResult = z.infer<typeof assistantResultSchema>
export type AssistantRequest = z.infer<typeof assistantRequestSchema>
export type AssistantErrorCode = z.infer<typeof assistantErrorCodeSchema>
export type AssistantAttachment = z.infer<typeof assistantAttachmentSchema>
export type AssistantQuestion = z.infer<typeof assistantQuestionSchema>
export type AssistantBridge = Readonly<{
  protocolVersion: 1
  connect(input: z.infer<typeof assistantConnectSchema>): Promise<AssistantResult>
  prompt(input: z.input<typeof assistantPromptSchema>): Promise<AssistantResult>
  steer?(input: z.input<typeof assistantSteerSchema>): Promise<AssistantResult>
  cancel(input: z.infer<typeof assistantScopeSchema>): Promise<AssistantResult>
  disconnect(input: z.infer<typeof assistantScopeSchema>): Promise<AssistantResult>
  respondPermission(input: z.infer<typeof assistantPermissionSchema>): Promise<AssistantResult>
  setMode(input: z.infer<typeof assistantModeSchema>): Promise<AssistantResult>
  setModel(input: z.infer<typeof assistantModelSchema>): Promise<AssistantResult>
  setConfigOption(input: z.infer<typeof assistantConfigOptionSchema>): Promise<AssistantResult>
  respondQuestion(input: z.infer<typeof assistantQuestionResponseSchema>): Promise<AssistantResult>
  authenticate(input: z.infer<typeof assistantAuthenticateSchema>): Promise<AssistantResult>
  onEvent(callback: (event: AssistantEvent) => void): () => void
}>
