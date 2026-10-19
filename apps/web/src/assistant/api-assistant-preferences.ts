import { z } from "zod"
import { assistantStorage } from "./assistant-preferences"

const endpoint = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    if ([...value].some((character) => character.charCodeAt(0) < 32)) return false
    try {
      const url = new URL(value)
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      return (
        (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  })
export const apiPreferencesSchema = z.strictObject({
  endpoint,
  model: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine(
      (value) =>
        !/\s/.test(value) && [...value].every((character) => character.charCodeAt(0) >= 32),
    ),
  stream: z.boolean(),
})
export const apiConfigurationSchema = apiPreferencesSchema.extend({
  apiKey: z
    .string()
    .max(4096)
    .refine((value) => !value.includes("\r") && !value.includes("\n") && !value.includes("\0")),
})
export type ApiPreferences = z.infer<typeof apiPreferencesSchema>
export type ApiConfiguration = z.infer<typeof apiConfigurationSchema>
const storageKey = "vibeshape.direct-api-preferences.v1"

export function readApiPreferences(storage = assistantStorage()): ApiPreferences | null {
  try {
    const raw = storage.getItem(storageKey)
    if (!raw || raw.length > 4096) return null
    const parsed = apiPreferencesSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveApiPreferences(configuration: ApiConfiguration, storage = assistantStorage()) {
  try {
    const { apiKey: _key, ...preferences } = apiConfigurationSchema.parse(configuration)
    storage.setItem(storageKey, JSON.stringify(apiPreferencesSchema.parse(preferences)))
    return true
  } catch {
    return false
  }
}
