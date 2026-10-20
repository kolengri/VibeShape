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
