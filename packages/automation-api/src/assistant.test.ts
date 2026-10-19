import { describe, expect, it } from "bun:test"
import {
  assistantPromptSchema,
  assistantQuestionResponseSchema,
  assistantRequestSchema,
} from "./assistant"

const scope = { projectId: "project", sessionToken: "session" }

describe("assistant input boundary", () => {
  it("accepts attachment-only prompts while refusing empty, malformed, path-bearing and oversized payloads", () => {
    const file = {
      id: "file",
      name: "notes.txt",
      type: "text",
      mimeType: "text/plain",
      text: "Exact file contents",
    }
    expect(
      assistantPromptSchema.safeParse({ ...scope, text: "", attachments: [file] }).success,
    ).toBe(true)
    expect(assistantPromptSchema.safeParse({ ...scope, text: " " }).success).toBe(false)
    for (const attachments of [
      [{ ...file, path: "/private/file.txt" }],
      [{ ...file, text: "é".repeat(1024 * 1024 + 1) }],
      Array.from({ length: 6 }, (_, index) => ({ ...file, id: `file-${index}` })),
      [
        {
          id: "image",
          name: "image.png",
          type: "image",
          mimeType: "image/png",
          data: "not base64",
        },
      ],
      [
        {
          id: "pdf",
          name: "drawing.pdf",
          type: "image",
          mimeType: "application/pdf",
          data: "aGVsbG8=",
        },
      ],
    ])
      expect(
        assistantPromptSchema.safeParse({ ...scope, text: "Inspect", attachments }).success,
      ).toBe(false)
  })

  it("limits the aggregate attachment budget as well as each file", () => {
    const maximumImage = {
      id: "maximum-image",
      name: "view.png",
      type: "image",
      mimeType: "image/png",
      data: Buffer.alloc(5 * 1024 * 1024).toString("base64"),
    }
    expect(
      assistantPromptSchema.safeParse({
        ...scope,
        text: "Inspect",
        attachments: [
          maximumImage,
          { ...maximumImage, id: "second-image" },
          {
            id: "maximum-text",
            name: "notes.txt",
            type: "text",
            mimeType: "text/plain",
            text: "a".repeat(2 * 1024 * 1024),
          },
        ],
      }).success,
    ).toBe(true)
    const image = {
      id: "image",
      name: "view.png",
      type: "image",
      mimeType: "image/png",
      data: "a".repeat(4 * 1024 * 1024),
    }
    expect(
      assistantPromptSchema.safeParse({ ...scope, text: "Inspect", attachments: [image] }).success,
    ).toBe(true)
    expect(
      assistantPromptSchema.safeParse({
        ...scope,
        text: "Inspect",
        attachments: Array.from({ length: 5 }, (_, index) => ({ ...image, id: `image-${index}` })),
      }).success,
    ).toBe(false)
  })

  it("validates scoped configuration and question operations without admitting extra authority", () => {
    expect(
      assistantRequestSchema.safeParse({
        operation: "setConfigOption",
        input: { ...scope, configId: "agent-reasoning", value: "advertised-value" },
      }).success,
    ).toBe(true)
    expect(
      assistantRequestSchema.safeParse({
        operation: "setConfigOption",
        input: { ...scope, configId: "agent-reasoning", value: true },
      }).success,
    ).toBe(false)
    expect(
      assistantQuestionResponseSchema.safeParse({
        ...scope,
        requestId: "question",
        answers: { choice: "Other", note: "A custom answer" },
      }).success,
    ).toBe(true)
    expect(
      assistantQuestionResponseSchema.safeParse({
        ...scope,
        requestId: "question",
        answers: { choice: { action: "execute" } },
      }).success,
    ).toBe(false)
  })
})
