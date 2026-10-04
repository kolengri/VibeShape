import { writeFile } from "node:fs/promises"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { renderPreviewMetadataSchema } from "../../packages/automation-api/src/render-preview"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

test("renders owned draft and saved CAD images through real stdio MCP without changing the viewport", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45800 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    let revision = draft.revision
    let command = 100
    async function stage(name: string, args: Record<string, unknown>) {
      revision = success(
        localToolOutputs.create_box.parse(
          await call(name, {
            ...args,
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: id(command++),
          }),
        ),
      ).revision
    }
    await stage("create_box", { featureId: id(1), widthMm: 50, depthMm: 30, heightMm: 10 })
    await stage("update_box", {
      featureId: id(1),
      label: "Plate",
      suppressed: false,
      parameters: {
        width: createLengthQuantity(50),
        depth: createLengthQuantity(30),
        height: createLengthQuantity(10),
        centered: true,
      },
    })
    await stage("create_cylinder", {
      featureId: id(2),
      label: "Through hole cutter",
      suppressed: false,
      parameters: {
        radius: createLengthQuantity(6),
        height: createLengthQuantity(30),
        centered: true,
      },
    })
    await stage("create_boolean", {
      featureId: id(3),
      label: "Plate with through hole",
      dependencies: [id(1), id(2)],
      references: [],
      suppressed: false,
      parameters: { operation: "subtract", keepTools: false },
    })
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")

    async function render(args: Record<string, unknown>, artifact: string) {
      const response = await local.callTool({ name: "render_preview", arguments: args })
      expect(response.isError, JSON.stringify(response.structuredContent)).toBe(false)
      const structured = response.structuredContent?.result as { ok: boolean; value: unknown }
      expect(structured.ok).toBe(true)
      const metadata = renderPreviewMetadataSchema.parse(structured.value)
      const image = response.content.find((content) => content.type === "image")
      if (image?.type !== "image") throw new Error("Expected native MCP image content.")
      expect(image.mimeType).toBe("image/png")
      const bytes = Buffer.from(image.data, "base64")
      expect(bytes.byteLength).toBeLessThanOrEqual(90 * 1024)
      await writeFile(info.outputPath(artifact), bytes)
      await info.attach(artifact, { body: bytes, contentType: "image/png" })
      const decoded = await page.evaluate(async (data) => {
        const browser = globalThis as unknown as {
          Image: new () => { src: string; width: number; height: number; decode(): Promise<void> }
          document: {
            createElement(tag: "canvas"): {
              width: number
              height: number
              getContext(kind: "2d"): {
                drawImage(image: unknown, x: number, y: number): void
                getImageData(
                  x: number,
                  y: number,
                  width: number,
                  height: number,
                ): { data: Uint8ClampedArray }
              } | null
            }
          }
        }
        const image = new browser.Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = browser.document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Missing decoding canvas.")
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        function backgroundDifference(index: number) {
          return (
            Math.abs((pixels[index] ?? 0) - 243) +
            Math.abs((pixels[index + 1] ?? 0) - 245) +
            Math.abs((pixels[index + 2] ?? 0) - 248)
          )
        }
        let modelPixels = 0
        for (let y = 60; y < canvas.height - 12; y++) {
          for (let x = 12; x < canvas.width - 12; x++) {
            const index = (y * canvas.width + x) * 4
            if (backgroundDifference(index) > 72) modelPixels++
          }
        }
        const centerY = Math.floor(64 + (canvas.height - 76) / 2)
        const centerX = Math.floor(canvas.width / 2)
        function backgroundAt(x: number) {
          const index = (centerY * canvas.width + x) * 4
          return backgroundDifference(index) < 12
        }
        let left = centerX
        let right = centerX
        while (left > 12 && backgroundAt(left)) left--
        while (right < canvas.width - 12 && backgroundAt(right)) right++
        return {
          width: image.width,
          height: image.height,
          modelPixels,
          centerGapPixels: right - left,
        }
      }, image.data)
      expect(decoded.width).toBe(metadata.image.width)
      expect(decoded.height).toBe(metadata.image.height)
      expect(decoded.modelPixels).toBeGreaterThan(1000)
      return { ...metadata, centerGapPixels: decoded.centerGapPixels }
    }
    const renderedDraft = await render(
      { source: "draft", draftId: draft.draftId, revision },
      "draft-collage.png",
    )
    expect(renderedDraft).toMatchObject({
      source: "draft",
      draftId: draft.draftId,
      revision,
      baseRevision: base,
      bodyCount: 1,
      geometryStatus: "valid",
      image: { views: ["isometric", "front", "right", "top"] },
    })
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(base)
    const committing = local.callTool({
      name: "commit_draft",
      arguments: { draftId: draft.draftId },
    })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const saved = success(
      localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
    )
    await expect(review).not.toBeVisible()
    const canvas = page.locator("canvas").first()
    const before = await canvas.screenshot()
    const savedImage = await render(
      {
        source: "model",
        revision: saved.revision,
        views: ["top"],
        target: { featureId: id(3), outputRole: "result" },
      },
      "saved-top.png",
    )
    expect(savedImage).toMatchObject({
      source: "model",
      revision: saved.revision,
      bodyCount: 1,
      geometryStatus: "valid",
    })
    const camera = { position: [0, 0, 50], target: [0, 0, 5], viewHeightMm: 16 }
    const detail = await render(
      {
        source: "model",
        revision: saved.revision,
        camera,
        target: { featureId: id(3), outputRole: "result" },
      },
      "hole-detail.png",
    )
    expect(detail).toMatchObject({ camera, image: { views: ["custom"] } })
    expect(detail.centerGapPixels).toBeGreaterThan(savedImage.centerGapPixels * 2)
    expect(await canvas.screenshot()).toEqual(before)
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(saved.revision)
    const missing = await local.callTool({
      name: "render_preview",
      arguments: {
        source: "model",
        revision: saved.revision,
        target: { featureId: id(3), outputRole: "missing" },
      },
    })
    expect(missing.isError).toBe(true)
    expect(missing.content.some((content) => content.type === "image")).toBe(false)
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    await expect(page.getByRole("button", { name: "Enable AI session", exact: true })).toBeVisible()
  } finally {
    await local.close()
  }
})
