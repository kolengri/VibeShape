import { describe, expect, it } from "bun:test"
import { promptContent } from "./agent"
import { readConfiguration } from "./configuration"
import { validateToolInput } from "./tool-contract"

describe("Jev adapter boundaries", () => {
  it("pins the model, requires a key and validates optional helper configuration", () => {
    expect(readConfiguration({ TYPESAFE_API_KEY: "test" }).model).toBe("jev-1.14.0")
    for (const env of [
      {},
      { TYPESAFE_API_KEY: "bad\nkey" },
      { TYPESAFE_API_KEY: "test", JEV_ARGUMENTS_MODEL: "small" },
      { TYPESAFE_API_KEY: "test", JEV_MAX_STEPS: "5000" },
      { TYPESAFE_API_KEY: "test", JEV_MIN_CONFIDENCE: "NaN" },
    ])
      expect(() => readConfiguration(env)).toThrow("Invalid Jev environment")
  })
  it("accepts a local helper and rejects credential-bearing or insecure remote URLs", () => {
    const env = {
      TYPESAFE_API_KEY: "test",
      JEV_ARGUMENTS_MODEL: "local",
      JEV_ARGUMENTS_ENDPOINT: "http://localhost:11434/v1/chat/completions",
    }
    expect(readConfiguration(env).argumentsEndpoint).toBe(env.JEV_ARGUMENTS_ENDPOINT)
    for (const endpoint of [
      "http://example.com/chat",
      "https://user:password@example.com/chat",
      "https://example.com/chat?key=secret",
      "https://example.com/chat#secret",
    ])
      expect(() => readConfiguration({ ...env, JEV_ARGUMENTS_ENDPOINT: endpoint })).toThrow()
  })
  it("decodes CLI settings through the shared bounds without changing the supplied environment", () => {
    const env = {
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_MODEL: "jev-explicit",
      JEV_ENABLE_IMAGES: "1",
      JEV_MAX_STEPS: "48",
      JEV_MIN_CONFIDENCE: "1",
      JEV_TIMEOUT_MS: "120000",
      JEV_ARGUMENTS_ENDPOINT: "https://helper.example.test/completions",
      JEV_ARGUMENTS_MODEL: "helper",
      JEV_ARGUMENTS_API_KEY: "helper-key",
    }
    const before = { ...env }
    expect(readConfiguration(env)).toEqual({
      apiKey: "test-key",
      model: "jev-explicit",
      images: true,
      maxSteps: 48,
      minConfidence: 1,
      timeoutMs: 120000,
      argumentsEndpoint: env.JEV_ARGUMENTS_ENDPOINT,
      argumentsModel: "helper",
      argumentsApiKey: "helper-key",
    })
    expect(env).toEqual(before)
    expect(readConfiguration({ TYPESAFE_API_KEY: "test-key", JEV_ENABLE_IMAGES: "0" }).images).toBe(
      false,
    )
    for (const invalid of [
      { JEV_ENABLE_IMAGES: "true" },
      { JEV_MAX_STEPS: "1.5" },
      { JEV_MIN_CONFIDENCE: "Infinity" },
      { JEV_TIMEOUT_MS: "999" },
      { JEV_ARGUMENTS_API_KEY: "helper-key" },
    ])
      expect(() => readConfiguration({ TYPESAFE_API_KEY: "test-key", ...invalid })).toThrow(
        "Invalid Jev environment",
      )
  })
  it("handles explicit text attachments and resource links without fetching them", () => {
    const content = promptContent(
      [
        { type: "text", text: "Make a bracket" },
        { type: "resource", resource: { uri: "attachment://dimensions", text: "20 mm" } },
        { type: "resource_link", name: "drawing", uri: "https://example.test/drawing" },
      ],
      false,
    )
    expect(content.goal).toContain("20 mm")
    expect(content.goal).toContain('"expanded":false')
  })
  it("requires explicit image opt-in and bounds image and text input", () => {
    expect(() =>
      promptContent(
        [
          { type: "text", text: "Inspect" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ],
        false,
      ),
    ).toThrow("JEV_ENABLE_IMAGES")
    expect(() => promptContent([{ type: "text", text: "x".repeat(48_001) }], false)).toThrow(
      "budget",
    )
    expect(() =>
      promptContent(
        [
          { type: "text", text: "Inspect" },
          { type: "image", mimeType: "image/webp", data: "aGVsbG8=" },
        ],
        true,
      ),
    ).toThrow()
  })
  it("rejects unknown tools, project switching and malformed CAD arguments before transport", () => {
    expect(() => validateToolInput("model_info", {})).not.toThrow()
    expect(() => validateToolInput("create_draft", { baseRevision: 0 })).not.toThrow()
    for (const [name, args] of [
      ["create_project", {}],
      ["unknown_tool", {}],
      ["model_info", { projectId: "foreign" }],
      ["create_draft", { baseRevision: -1 }],
    ] as const)
      expect(() => validateToolInput(name, args)).toThrow("contract")
  })
})
