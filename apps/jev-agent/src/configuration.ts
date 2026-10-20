import { z } from "zod"

const key = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]+$/)
const model = z.string().min(1).max(128).regex(/^\S+$/)
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
const settings = z
  .object({
    apiKey: key,
    model: model.default("jev-1.14.0"),
    images: z
      .enum(["0", "1"])
      .default("0")
      .transform((value) => value === "1"),
    maxSteps: z.coerce.number().int().min(1).max(48).default(24),
    minConfidence: z.coerce.number().min(0).max(1).default(0.5),
    timeoutMs: z.coerce.number().int().min(1000).max(120_000).default(60_000),
    argumentsEndpoint: endpoint.optional(),
    argumentsModel: model.optional(),
    argumentsApiKey: key.optional(),
  })
  .refine(
    (value) =>
      (!value.argumentsEndpoint && !value.argumentsModel && !value.argumentsApiKey) ||
      Boolean(value.argumentsEndpoint && value.argumentsModel),
  )
export type Configuration = z.infer<typeof settings>

export function readConfiguration(env: Record<string, string | undefined>): Configuration {
  const result = settings.safeParse({
    apiKey: env.TYPESAFE_API_KEY,
    model: env.TYPESAFE_MODEL,
    images: env.JEV_ENABLE_IMAGES,
    maxSteps: env.JEV_MAX_STEPS,
    minConfidence: env.JEV_MIN_CONFIDENCE,
    timeoutMs: env.JEV_TIMEOUT_MS,
    argumentsEndpoint: env.JEV_ARGUMENTS_ENDPOINT,
    argumentsModel: env.JEV_ARGUMENTS_MODEL,
    argumentsApiKey: env.JEV_ARGUMENTS_API_KEY,
  })
  if (!result.success)
    throw new Error("Invalid Jev environment. Set TYPESAFE_API_KEY and check docs/jev-agent.md.")
  return result.data
}
