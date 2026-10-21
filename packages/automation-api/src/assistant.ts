import { documentIdSchema, featureIdSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { assistantJevAgentSchema, assistantJevCredentialsSchema } from "./assistant-jev"
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
// Display hints only; these IDs never grant access or authorize a CAD operation.
export const assistantToolTargetsSchema = z.strictObject({
  projectId: documentIdSchema,
  featureIds: z.array(featureIdSchema).max(32),
  sketchIds: z.array(sketchIdSchema).max(32),
})
export type AssistantToolTargets = z.infer<typeof assistantToolTargetsSchema>
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

export const assistantQuestionInputSchema = z.strictObject({
  message: assistantQuestionSchema.shape.message,
  fields: z
    .array(
      z
        .strictObject({ ...questionField.shape, secret: z.literal(false).default(false) })
        .refine(
          (field) =>
            questionField.safeParse(field).success &&
            (!field.options ||
              (field.options.length > 0 &&
                new Set(field.options.map((option) => option.id)).size === field.options.length)),
        ),
    )
    .min(1)
    .max(8)
    .refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length),
})
export type AssistantQuestionInput = z.infer<typeof assistantQuestionInputSchema>
export type AssistantQuestionReply =
  | { action: "accept"; content: Record<string, string> }
  | { action: "cancel" | "decline" }
export const assistantQuestionTool = {
  name: "ask_user_question",
  description:
    "Ask the person a bounded structured question and wait for their answer before dependent work. Fields accept text or one advertised choice; include a separate optional text field for custom instructions. Secrets are not supported. Cancellation or expiration supplies no answer or authority; stop dependent work.",
  inputSchema: z.toJSONSchema(assistantQuestionInputSchema, { io: "input" }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
}

export function assistantQuestionAnswersMatch(
  question: Pick<z.infer<typeof assistantQuestionSchema>, "fields">,
  answers: Record<string, string>,
) {
  if (Object.keys(answers).some((id) => !question.fields.some((field) => field.id === id)))
    return false
  return question.fields.every((field) => {
    const value = answers[field.id]
    return value === undefined || (value === "" && field.required)
      ? !field.required
      : value.length >= (field.minLength ?? 0) &&
          value.length <= (field.maxLength ?? 16_384) &&
          (!field.options || field.options.some((option) => option.id === value))
  })
}

export const assistantExternalAgentSchema = z.strictObject({
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
export const assistantAgentSchema = z.union([assistantExternalAgentSchema, assistantJevAgentSchema])
export const assistantConnectSchema = z
  .strictObject({
    projectId: id,
    agent: assistantAgentSchema,
    jevCredentials: assistantJevCredentialsSchema.optional(),
    resumeSessionId: id.optional(),
  })
  .refine(
    (value) =>
      !value.jevCredentials ||
      ("kind" in value.agent &&
        (!value.jevCredentials.argumentsApiKey || Boolean(value.agent.settings.argumentsEndpoint))),
  )
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
  "jev-configuration-required",
  "agent-busy",
  "queue-full",
  "stale-session",
  "unsupported",
  "settings-unavailable",
  "settings-recovery-failed",
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
  questionStatus: z.enum(["pending", "paused"]).optional(),
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
    hasFailureDetails: z.boolean().optional(),
    targets: assistantToolTargetsSchema.optional(),
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
  z.strictObject({
    ...scope,
    type: z.literal("question-resolved"),
    requestId: id,
    reason: z.enum(["answered", "cancelled", "expired"]).optional(),
  }),
  z.strictObject({ ...scope, type: z.literal("completed"), stopReason: label }),
  z.strictObject({ ...scope, type: z.literal("error"), code: assistantErrorCodeSchema }),
])

export type AssistantAgent = z.infer<typeof assistantAgentSchema>
export type AssistantExternalAgent = z.infer<typeof assistantExternalAgentSchema>
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
