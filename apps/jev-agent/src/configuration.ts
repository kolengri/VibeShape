import {
  assistantJevCredentialsSchema,
  assistantJevSettingsSchema,
} from "@vibeshape/automation-api/assistant-jev"
import type { z } from "zod"

const configurationSchema = assistantJevSettingsSchema
  .safeExtend({
    apiKey: assistantJevCredentialsSchema.shape.apiKey.unwrap(),
    argumentsApiKey: assistantJevCredentialsSchema.shape.argumentsApiKey,
  })
  .refine((value) => !value.argumentsApiKey || Boolean(value.argumentsEndpoint))
export type Configuration = z.infer<typeof configurationSchema>

function imageSetting(value: string | undefined) {
  if (value === "1") return true
  if (value === "0") return false
  return value
}

function numberSetting(value: string | undefined) {
  return value === undefined ? undefined : Number(value)
}

export function readConfiguration(env: Record<string, string | undefined>): Configuration {
  const result = configurationSchema.safeParse({
    apiKey: env.TYPESAFE_API_KEY,
    model: env.TYPESAFE_MODEL,
    images: imageSetting(env.JEV_ENABLE_IMAGES),
    maxSteps: numberSetting(env.JEV_MAX_STEPS),
    minConfidence: numberSetting(env.JEV_MIN_CONFIDENCE),
    timeoutMs: numberSetting(env.JEV_TIMEOUT_MS),
    argumentsEndpoint: env.JEV_ARGUMENTS_ENDPOINT,
    argumentsModel: env.JEV_ARGUMENTS_MODEL,
    argumentsApiKey: env.JEV_ARGUMENTS_API_KEY,
  })
  if (!result.success)
    throw new Error("Invalid Jev environment. Set TYPESAFE_API_KEY and check docs/jev-agent.md.")
  return result.data
}
