import { describe, expect, it } from "bun:test"
import {
  assistantAttachmentsSupported,
  assistantPromptSchema,
  assistantSnapshotSchema,
} from "./assistant"
import { JEV_IMAGE_CONSTRAINTS } from "./assistant-jev"

const snapshot = {
  projectId: "project",
  sessionToken: "session",
  sessionId: "agent-session",
  status: "ready",
  canResume: false,
  modes: [],
  currentModeId: null,
  models: [],
  currentModelId: null,
  authMethods: [],
}

describe("assistant image capability transport", () => {
  it("preserves the built-in Jev policy through the native snapshot schema", () => {
    const parsed = assistantSnapshotSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...snapshot,
          attachmentCapabilities: {
            text: true,
            images: true,
            imageConstraints: JEV_IMAGE_CONSTRAINTS,
          },
        }),
      ),
    )
    expect(parsed.attachmentCapabilities).toEqual({
      text: true,
      images: true,
      imageConstraints: {
        mimeTypes: ["image/png", "image/jpeg"],
        maxCount: 4,
        maxTotalBase64Bytes: 524288,
      },
    })
    expect(
      assistantSnapshotSchema.parse({
        ...snapshot,
        attachmentCapabilities: { text: true, images: true },
      }).attachmentCapabilities,
    ).toEqual({ text: true, images: true })
  })

  it("counts only image content against the Jev image count and encoded byte budgets", () => {
    const capabilities = assistantSnapshotSchema.parse({
      ...snapshot,
      attachmentCapabilities: {
        text: true,
        images: true,
        imageConstraints: JEV_IMAGE_CONSTRAINTS,
      },
    }).attachmentCapabilities
    if (!capabilities) throw new Error("Missing attachment capabilities")
    const { attachments } = assistantPromptSchema.parse({
      projectId: "project",
      sessionToken: "session",
      text: "Inspect the views and dimensions",
      attachments: [
        ...["front", "back", "left", "right"].map((id) => ({
          id,
          name: `${id}.jpg`,
          type: "image",
          mimeType: "image/jpeg",
          data: "A".repeat(131072),
        })),
        {
          id: "notes",
          name: "dimensions.txt",
          type: "text",
          mimeType: "text/plain",
          text: "width=42\n".repeat(128),
        },
      ],
    })
    expect(attachments).toHaveLength(5)
    expect(assistantAttachmentsSupported(attachments ?? [], capabilities)).toBe(true)
    expect(assistantAttachmentsSupported(attachments ?? [], { ...capabilities, text: false })).toBe(
      false,
    )
    expect(
      assistantAttachmentsSupported(attachments ?? [], { ...capabilities, images: false }),
    ).toBe(false)
  })
})
