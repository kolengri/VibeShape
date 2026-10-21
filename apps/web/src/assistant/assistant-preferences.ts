import { assistantAgentSchema } from "@vibeshape/automation-api/assistant"
import { z } from "zod"

const assistantPreferencesSchema = z.strictObject({
  version: z.literal(1),
  agent: assistantAgentSchema,
})
const key = "vibeshape.assistant-preferences.v1"
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function assistantStorage(): StoragePort {
  try {
    return window.localStorage
  } catch {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error("Chat storage is unavailable.")
      },
      removeItem: () => {
        throw new Error("Chat storage is unavailable.")
      },
    }
  }
}
export function readAssistantPreferences(storage = assistantStorage()) {
  try {
    const raw = storage.getItem(key)
    if (!raw || raw.length > 32_000) return null
    const preferences = assistantPreferencesSchema.safeParse(JSON.parse(raw))
    if (!preferences.success) return null
    // The previous native form persisted its image opt-in default as an explicit false.
    if ("kind" in preferences.data.agent) preferences.data.agent.settings.images = true
    return preferences.data
  } catch {
    return null
  }
}
export function saveAssistantPreferences(
  value: z.infer<typeof assistantPreferencesSchema>,
  storage = assistantStorage(),
) {
  try {
    storage.setItem(key, JSON.stringify(assistantPreferencesSchema.parse(value)))
    return true
  } catch {
    return false
  }
}
