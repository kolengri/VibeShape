import { describe, expect, it } from "bun:test"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  renderedPreviewImageSchema,
  renderPreviewMcpResult,
  renderPreviewMetadataSchema,
  renderPreviewResultContextMatches,
} from "./render-preview"

const id = "0195b5ac-b250-7a2c-8c33-000000000001"
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
const operation = { tool: "render_preview", arguments: { source: "model", revision: 7 } }
const result = {
  ok: true as const,
  value: {
    source: "model" as const,
    documentId: id,
    revision: 7,
    generation: 1,
    geometryStatus: "valid" as const,
    bodyCount: 2,
    image: {
      mimeType: "image/png" as const,
      base64: png,
      width: 1,
      height: 1,
      views: ["isometric", "front", "right", "top"] as const,
    },
  },
}

describe("revision-bound render previews", () => {
  it("requires explicit model/draft authority, bounded unique views and exact body targets", () => {
    expect(localOperationSchema.safeParse(operation).success).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "render_preview",
        arguments: {
          source: "draft",
          draftId: id,
          revision: 8,
          target: { featureId: id, outputRole: "result" },
          views: ["back"],
        },
      }).success,
    ).toBe(true)
    for (const args of [
      { source: "model" },
      { source: "draft", revision: 7 },
      { source: "model", revision: 7, draftId: id },
      { source: "model", revision: 7, views: [] },
      { source: "model", revision: 7, views: ["front", "front"] },
      { source: "model", revision: 7, views: ["front", "back", "left", "right", "top"] },
      { source: "model", revision: 7, target: { featureId: id } },
      { source: "model", revision: 7, url: "https://example.com/model" },
    ])
      expect(
        localOperationSchema.safeParse({ tool: "render_preview", arguments: args }).success,
      ).toBe(false)
  })

  it("rejects foreign or stale result context, omitted targets and reordered views", () => {
    expect(renderPreviewResultContextMatches(operation, result, id)).toBe(true)
    for (const changed of [
      { revision: 8 },
      { documentId: "0195b5ac-b250-7a2c-8c33-000000000002" },
      { source: "draft", draftId: id, baseRevision: 6 },
      { target: { featureId: id, outputRole: "result" } },
      { image: { ...result.value.image, views: ["front", "isometric", "right", "top"] } },
    ])
      expect(
        renderPreviewResultContextMatches(
          operation,
          { ok: true, value: { ...result.value, ...changed } },
          id,
        ),
      ).toBe(false)
    expect(
      renderPreviewResultContextMatches({ tool: "model_info", arguments: {} }, result),
    ).toBeNull()
    expect(
      renderPreviewResultContextMatches(
        {
          ...operation,
          arguments: { ...operation.arguments, target: { featureId: id, outputRole: "result" } },
        },
        result,
      ),
    ).toBe(false)
  })

  it("supports a world-space detail camera and binds its pose and zoom to the result", () => {
    const camera = { position: [30, -30, 20], target: [0, 0, 5], viewHeightMm: 12 }
    const custom = { tool: "render_preview", arguments: { source: "model", revision: 7, camera } }
    expect(localOperationSchema.safeParse(custom).success).toBe(true)
    const customResult = {
      ok: true,
      value: { ...result.value, camera, image: { ...result.value.image, views: ["custom"] } },
    }
    expect(renderPreviewResultContextMatches(custom, customResult, id)).toBe(true)
    expect(
      renderPreviewResultContextMatches(
        custom,
        {
          ...customResult,
          value: { ...customResult.value, camera: { ...camera, viewHeightMm: 24 } },
        },
        id,
      ),
    ).toBe(false)
    for (const changed of [
      { position: [0, 0, 5] },
      { up: [0, 0, 0] },
      { viewHeightMm: 0 },
      { position: [1_000_001, 0, 0] },
      { position: [0, 0, 20], up: [0, 0, 1] },
    ])
      expect(
        localOperationSchema.safeParse({
          ...custom,
          arguments: { ...custom.arguments, camera: { ...camera, ...changed } },
        }).success,
      ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        ...custom,
        arguments: { ...custom.arguments, views: ["top"] },
      }).success,
    ).toBe(false)
  })

  it("rejects mislabeled, oversized and malformed image payloads", () => {
    expect(localToolOutputs.render_preview.safeParse(result).success).toBe(true)
    for (const changed of [
      { width: 2 },
      { height: 2 },
      { width: 1025 },
      { height: 769 },
      { mimeType: "image/svg+xml" },
      { base64: "<svg/>" },
      { base64: `${png.slice(0, 40)}${"AAAA".repeat(32 * 1024)}` },
    ])
      expect(
        renderedPreviewImageSchema.safeParse({ ...result.value.image, ...changed }).success,
      ).toBe(false)
  })

  it("delivers PNG bytes once as native MCP image content with validated structured metadata", () => {
    const parsed = localToolOutputs.render_preview.parse(result)
    if (!parsed.ok) throw new Error("Expected a preview.")
    const output = renderPreviewMcpResult(parsed.value)
    expect(output.content[1]).toEqual({ type: "image", data: png, mimeType: "image/png" })
    expect(JSON.stringify(output.structuredContent)).not.toContain(png)
    expect(output.content[0]).toMatchObject({ type: "text" })
    expect(
      renderPreviewMetadataSchema.safeParse(output.structuredContent.result.value).success,
    ).toBe(true)
  })
})
