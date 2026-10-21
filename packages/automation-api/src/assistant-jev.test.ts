import { describe, expect, it } from "bun:test"
import { assistantAgentSchema, assistantConnectSchema } from "./assistant"
import { assistantJevAgentSchema, assistantJevSettingsSchema } from "./assistant-jev"

describe("built-in Jev connection boundary", () => {
  it("keeps legacy executables and adds settings without accepting secrets in saved agents", () => {
    expect(assistantAgentSchema.parse({ command: "codex-acp", args: [] })).toEqual({
      command: "codex-acp",
      args: [],
    })
    const agent = assistantJevAgentSchema.parse({ kind: "jev", settings: {} })
    expect(agent.settings).toMatchObject({ model: "jev-1.14.0", maxSteps: 24, images: false })
    expect(assistantAgentSchema.safeParse({ ...agent, apiKey: "private" }).success).toBe(false)
    expect(
      assistantAgentSchema.safeParse({
        ...agent,
        settings: { ...agent.settings, apiKey: "private" },
      }).success,
    ).toBe(false)
    expect(
      assistantConnectSchema.safeParse({
        projectId: "project",
        agent,
        jevCredentials: { apiKey: "private" },
      }).success,
    ).toBe(true)
    expect(
      assistantConnectSchema.safeParse({
        projectId: "project",
        agent: { command: "custom", args: [] },
        jevCredentials: { apiKey: "private" },
      }).success,
    ).toBe(false)
  })

  it.each([
    { model: "" },
    { model: "model with spaces" },
    { maxSteps: 49 },
    { maxSteps: 0 },
    { minConfidence: Number.NaN },
    { minConfidence: 1.01 },
    { timeoutMs: 0 },
    { argumentsEndpoint: "https://helper.test/v1/chat/completions" },
    { argumentsModel: "helper" },
    ...[
      "http://remote.test/api",
      "https://user:secret@helper.test/api",
      "https://helper.test/api?key=secret",
      "https://helper.test/api#key",
    ].map((argumentsEndpoint) => ({ argumentsEndpoint, argumentsModel: "helper" })),
  ])("rejects unsupported or incomplete settings %j", (settings) => {
    expect(assistantJevSettingsSchema.safeParse(settings).success).toBe(false)
  })

  it("accepts a bounded local argument model and rejects its key without an endpoint", () => {
    expect(
      assistantJevSettingsSchema.safeParse({
        argumentsEndpoint: "http://localhost:11434/v1/chat/completions",
        argumentsModel: "local",
      }).success,
    ).toBe(true)
    const agent = assistantJevAgentSchema.parse({ kind: "jev", settings: {} })
    expect(
      assistantConnectSchema.safeParse({
        projectId: "project",
        agent,
        jevCredentials: { argumentsApiKey: "private" },
      }).success,
    ).toBe(false)
    expect(
      assistantConnectSchema.safeParse({
        projectId: "project",
        agent,
        jevCredentials: { apiKey: "private\nkey" },
      }).success,
    ).toBe(false)
  })
})
