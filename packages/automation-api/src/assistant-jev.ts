import { z } from "zod"
import { assistantExternalAgentSchema } from "./assistant-agents"

export const JEV_IMAGE_CONSTRAINTS = {
  mimeTypes: ["image/png", "image/jpeg"],
  maxCount: 4,
  maxTotalBase64Bytes: 512 * 1024,
} as const

// Describe only the host URL API used here without importing DOM or Node globals.
declare const URL: {
  new (
    value: string,
  ): {
    protocol: string
    hostname: string
    username: string
    password: string
    search: string
    hash: string
  }
}

const model = z.string().trim().min(1).max(128).regex(/^\S+$/)
const secret = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]+$/)
const endpoint = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  })

// Persistable settings exclude credentials; helper executables use the native agent contract.
export const assistantJevSettingsSchema = z
  .strictObject({
    model: model.default("jev-1.14.0"),
    images: z.boolean().default(true),
    // Legacy persisted settings and launch environments; no longer caps a turn.
    maxSteps: z.number().int().min(1).max(48).default(24),
    minConfidence: z.number().min(0).max(1).default(0.5),
    timeoutMs: z.number().int().min(1000).max(120_000).default(60_000),
    argumentsAgent: assistantExternalAgentSchema.optional(),
    argumentsEndpoint: endpoint.optional(),
    argumentsModel: model.optional(),
  })
  .refine((value) => Boolean(value.argumentsEndpoint) === Boolean(value.argumentsModel))
  .refine((value) => !value.argumentsAgent || !value.argumentsEndpoint)

export const assistantJevAgentSchema = z.strictObject({
  kind: z.literal("jev"),
  settings: assistantJevSettingsSchema,
})

// Connection-only input: never include this object in preferences or snapshots.
export const assistantJevCredentialsSchema = z.strictObject({
  apiKey: secret.optional(),
  argumentsApiKey: secret.optional(),
})

export type AssistantJevAgent = z.infer<typeof assistantJevAgentSchema>
export type AssistantJevSettings = z.infer<typeof assistantJevSettingsSchema>
export type AssistantJevCredentials = z.infer<typeof assistantJevCredentialsSchema>
