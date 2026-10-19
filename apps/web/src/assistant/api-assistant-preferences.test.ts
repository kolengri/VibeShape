import { describe, expect, it } from "bun:test"
import {
  apiConfigurationSchema,
  apiPreferencesSchema,
  readApiPreferences,
  saveApiPreferences,
} from "./api-assistant-preferences"

const preferences = {
  endpoint: "https://api.example.test/v1/chat/completions",
  model: "user-model",
  stream: true,
}

describe("direct API configuration", () => {
  it("accepts explicit HTTPS and loopback endpoints while rejecting credential-bearing or insecure URLs", () => {
    for (const endpoint of [
      preferences.endpoint,
      "http://127.0.0.1:1234/v1/chat/completions",
      "http://localhost:1234/v1/chat/completions",
      "http://[::1]:1234/v1/chat/completions",
    ])
      expect(apiPreferencesSchema.safeParse({ ...preferences, endpoint }).success).toBe(true)
    for (const endpoint of [
      "http://api.example.test/completions",
      "https://secret@api.example.test/completions",
      "https://api.example.test/completions?key=secret",
      "https://api.example.test/completions#secret",
      "https://api.example.test/\ncompletions",
      "file:///tmp/endpoint",
      "http://127.0.0.1.example.test/completions",
    ])
      expect(apiPreferencesSchema.safeParse({ ...preferences, endpoint }).success).toBe(false)
    expect(
      apiConfigurationSchema.safeParse({ ...preferences, apiKey: "key\r\nInjected: header" })
        .success,
    ).toBe(false)
  })

  it("persists only validated nonsecret preferences and rejects previously stored secret fields", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem() {},
    }
    expect(saveApiPreferences({ ...preferences, apiKey: "runtime-secret" }, storage)).toBe(true)
    expect([...values.values()].join()).not.toContain("runtime-secret")
    expect([...values.values()].join()).not.toContain("apiKey")
    expect(readApiPreferences(storage)).toEqual(preferences)
    for (const key of values.keys())
      values.set(key, JSON.stringify({ ...preferences, apiKey: "old-secret" }))
    expect(readApiPreferences(storage)).toBeNull()
  })
})
