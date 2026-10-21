import { describe, expect, it } from "bun:test"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  RENDER_PREVIEW_MAX_BYTES,
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
    quality: "overview" as const,
    image: {
      mimeType: "image/png" as const,
      base64: png,
      width: 1,
      height: 1,
      views: ["isometric"] as const,
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
      { source: "model", revision: 7, quality: "high" },
      { source: "model", revision: 7, quality: null },
      { source: "model", revision: 7, url: "https://example.com/model" },
    ])
      expect(
        localOperationSchema.safeParse({ tool: "render_preview", arguments: args }).success,
      ).toBe(false)
  })

  it("defaults automation to one overview view and restores legacy views only for detail", () => {
    const detailOperation = {
      ...operation,
      arguments: { ...operation.arguments, quality: "detail" },
    }
    const detailResult = {
      ok: true,
      value: {
        ...result.value,
        quality: "detail",
        image: { ...result.value.image, views: ["isometric", "front", "right", "top"] },
      },
    }
    expect(renderPreviewResultContextMatches(operation, result, id)).toBe(true)
    expect(renderPreviewResultContextMatches(detailOperation, detailResult, id)).toBe(true)
    expect(renderPreviewResultContextMatches(operation, detailResult, id)).toBe(false)
    expect(renderPreviewResultContextMatches(detailOperation, result, id)).toBe(false)
    for (const quality of [undefined, "detail", "invalid"])
      expect(
        renderPreviewResultContextMatches(
          operation,
          { ok: true, value: { ...result.value, quality } },
          id,
        ),
      ).toBe(false)
    expect(
      renderPreviewResultContextMatches(operation, {
        ok: true,
        value: { ...result.value, image: detailResult.value.image },
      }),
    ).toBe(false)
    expect(
      renderPreviewResultContextMatches(detailOperation, {
        ok: true,
        value: { ...detailResult.value, image: result.value.image },
      }),
    ).toBe(false)
  })

  it.each(["overview", "detail"])(
    "honors explicit views and exact targets at %s quality",
    (quality) => {
      const target = { featureId: id, outputRole: "result" }
      const views = ["top", "back"]
      const explicit = {
        ...operation,
        arguments: { ...operation.arguments, quality, views, target },
      }
      const matched = {
        ok: true,
        value: {
          ...result.value,
          quality,
          target,
          bodyCount: 1,
          image: { ...result.value.image, views },
        },
      }
      expect(localOperationSchema.safeParse(explicit).success).toBe(true)
      expect(renderPreviewResultContextMatches(explicit, matched, id)).toBe(true)
      expect(
        renderPreviewResultContextMatches(explicit, {
          ...matched,
          value: { ...matched.value, image: { ...matched.value.image, views: ["back", "top"] } },
        }),
      ).toBe(false)
    },
  )

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

  it.each(["overview", "detail"])(
    "binds a world-space camera and zoom at %s quality",
    (quality) => {
      const camera = { position: [30, -30, 20], target: [0, 0, 5], viewHeightMm: 12 }
      const custom = {
        tool: "render_preview",
        arguments: { source: "model", revision: 7, quality, camera },
      }
      expect(localOperationSchema.safeParse(custom).success).toBe(true)
      const customResult = {
        ok: true,
        value: {
          ...result.value,
          quality,
          camera,
          image: { ...result.value.image, views: ["custom"] },
        },
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
    },
  )

  it("enforces overview raster bounds and unchanged byte budgets while permitting smaller detail", () => {
    function imageAt(width: number, height: number, byteLength?: number) {
      const original = Buffer.from(png, "base64")
      const bytes = byteLength ? Buffer.alloc(byteLength) : original
      if (byteLength) original.copy(bytes)
      bytes.writeUInt32BE(width, 16)
      bytes.writeUInt32BE(height, 20)
      return { ...result.value.image, width, height, base64: bytes.toString("base64") }
    }
    for (const [width, height, overviewAllowed] of [
      [768, 576, true],
      [769, 576, false],
      [768, 577, false],
      [1024, 768, false],
      [384, 288, true],
    ] as const) {
      const value = { ...result.value, image: imageAt(width, height) }
      expect(localToolOutputs.render_preview.safeParse({ ok: true, value }).success).toBe(
        overviewAllowed,
      )
      expect(
        localToolOutputs.render_preview.safeParse({
          ok: true,
          value: { ...value, quality: "detail" },
        }).success,
      ).toBe(true)
      const { base64: _base64, ...image } = value.image
      expect(renderPreviewMetadataSchema.safeParse({ ...value, image }).success).toBe(
        overviewAllowed,
      )
    }
    expect(
      renderedPreviewImageSchema.safeParse(imageAt(1, 1, RENDER_PREVIEW_MAX_BYTES)).success,
    ).toBe(true)
    expect(
      renderedPreviewImageSchema.safeParse(imageAt(1, 1, RENDER_PREVIEW_MAX_BYTES + 1)).success,
    ).toBe(false)
    const oversized = { ...result, padding: "x".repeat(128 * 1024) }
    expect(renderPreviewResultContextMatches(operation, oversized)).toBe(false)
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
    expect(output.content.filter(({ type }) => type === "image")).toHaveLength(1)
    expect(output.content[0]?.text).not.toContain(png)
    expect(output.structuredContent.result.value.quality).toBe("overview")
    expect(output.content[0]).toMatchObject({ type: "text" })
    expect(
      renderPreviewMetadataSchema.safeParse(output.structuredContent.result.value).success,
    ).toBe(true)
  })
})
