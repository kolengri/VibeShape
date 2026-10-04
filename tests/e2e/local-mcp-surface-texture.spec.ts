import { createHash } from "node:crypto"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import type {
  BinaryExportChunk,
  BinaryExportDescriptor,
} from "../../packages/automation-api/src/binary-exports"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { featureIdSchema, surfaceTextureLayerIdSchema } from "../../packages/domain/src/identifiers"
import { createDefaultSurfaceTextureLayer } from "../../packages/domain/src/surface-textures"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { enableLocalAi, openAiConnections } from "./application-menu-support"
import { expect, test } from "./fixtures"

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>
const layerId = "0195b5ac-b290-7a2c-8c33-000000000001"
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
async function retrieve(call: Call, descriptor: BinaryExportDescriptor) {
  const chunks: Buffer[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const value: BinaryExportChunk = success(
      localToolOutputs.read_export_chunk.parse(
        await call("read_export_chunk", {
          exportId: descriptor.exportId,
          offset,
          limit: descriptor.chunkMaxBytes,
        }),
      ),
    )
    chunks.push(Buffer.from(value.base64, "base64"))
    offset = value.nextOffset
  }
  const bytes = Buffer.concat(chunks)
  expect(bytes.length).toBe(descriptor.byteLength)
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(descriptor.sha256)
  await call("discard_export", { exportId: descriptor.exportId })
  return bytes
}

test("authors full packed relief maps and exact faces through manual MCP review, append, removal, Undo and reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(44187 + testInfo.parallelIndex)
  const call: Call = async (name, args) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const readInfo = async () =>
    success(localToolOutputs.model_info.parse(await call("model_info", {})))
  const apply = async (name: string, args: Record<string, unknown>, destructive = false) => {
    const pending = call(name, args)
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await Promise.race([
      expect(review).toBeVisible({ timeout: 60_000 }),
      pending.then((result) => {
        throw new Error(
          `The ${name} operation completed before manual review: ${JSON.stringify(result)}`,
        )
      }),
    ])
    const button = review.getByRole("button", { name: "Apply", exact: true })
    await expect(button).toBeEnabled({ timeout: 60_000 })
    if (!destructive)
      await expect(review.getByText("Relief preview ready.", { exact: true })).toBeVisible()
    await button.click()
    if (destructive)
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Apply changes", exact: true })
        .click()
    const result = await pending
    await expect(review).toHaveCount(0)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    return result
  }
  try {
    const names = (await local.client.listTools()).tools.map(({ name }) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        "model_surface_textures",
        "create_surface_texture",
        "update_surface_texture",
        "remove_surface_texture",
      ]),
    )
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const form = page.getByRole("form", { name: "Create box" })
    for (const field of ["Width", "Depth", "Height"])
      await form.getByRole("combobox", { name: field, exact: true }).fill("10 mm")
    await form.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await enableLocalAi(page)
    await openAiConnections(page)
    await page.getByRole("button", { name: "Set up auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Close AI connections", exact: true }).click()
    await expect(page.getByText("Auto-apply on", { exact: true })).toBeVisible()
    const initial = await readInfo()
    const parts = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision: initial.summary.revision }),
      ),
    )
    const part = parts.parts.find(({ consumedBy }) => consumedBy === null)
    if (!part) throw new Error("The current authored part is unavailable")
    const topology = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", {
          revision: initial.summary.revision,
          featureId: part.body.featureId,
          outputRole: part.body.outputRole,
          topologyKind: "face",
          cursor: null,
          limit: 100,
        }),
      ),
    )
    const face = topology.data.topology.find(
      ({ reference, resolution }) =>
        resolution === "resolved" && reference.signature.centroid[2] === 10,
    )
    if (!face) throw new Error("The exact top face is unavailable")
    const {
      id: _id,
      featureId: _feature,
      ...recipe
    } = createDefaultSurfaceTextureLayer(
      featureIdSchema.parse(part.body.featureId),
      part.body.outputRole,
      surfaceTextureLayerIdSchema.parse(layerId),
    )
    const packed = Buffer.alloc(256 ** 2, 255)
    const created = success(
      localToolOutputs.create_surface_texture.parse(
        await apply("create_surface_texture", {
          baseRevision: initial.summary.revision,
          layerId,
          featureId: part.body.featureId,
          recipe: {
            ...recipe,
            target: { kind: "faces", outputRole: part.body.outputRole, refs: [face.reference] },
            boundaryFadeMm: 0.5,
            map: {
              kind: "custom",
              width: 256,
              height: 256,
              grayscaleBase64: packed.toString("base64"),
            },
          },
        }),
      ),
    )
    expect(created.revision).toBe(initial.summary.revision + 1)
    expect(created.preview.bodyCount).toBe(1)
    expect(created.preview.triangleCount).toBeGreaterThan(created.preview.sourceTriangleCount)
    const updated = success(
      localToolOutputs.update_surface_texture.parse(
        await apply("update_surface_texture", {
          baseRevision: created.revision,
          layerId,
          patch: { heightMm: 0.45 },
          appendMaskStrokes: [
            { center: [5, 5, 10], normal: [0, 0, 1], radiusMm: 1, hardness: 0.7, mode: "erase" },
          ],
        }),
      ),
    )
    expect(updated.revision).toBe(created.revision + 1)
    const view = success(
      localToolOutputs.model_surface_textures.parse(
        await call("model_surface_textures", {
          revision: updated.revision,
          featureId: part.body.featureId,
        }),
      ),
    )
    expect(view.layers[0]).toMatchObject({
      id: layerId,
      heightMm: 0.45,
      map: { kind: "custom", width: 256, height: 256, pixelCount: 65536 },
      mask: { strokeCount: 1 },
      target: { kind: "faces", faceReferenceCount: 1 },
    })
    expect(JSON.stringify(view)).not.toContain('"pixels"')
    const descriptor = success(
      localToolOutputs.prepare_project_backup.parse(
        await call("prepare_project_backup", { revision: updated.revision }),
      ),
    )
    const decoded = await readAuthoredVShape(new Uint8Array(await retrieve(call, descriptor)))
    if (!decoded.ok || (decoded.value.version !== 4 && decoded.value.version !== 5))
      throw new Error("The saved texture project is not replay-valid")
    const saved = decoded.value.project.snapshot.surfaceTextures[0]
    expect(saved?.map).toEqual({ kind: "custom", width: 256, height: 256, pixels: [...packed] })
    expect(saved?.target).toEqual({
      kind: "faces",
      outputRole: part.body.outputRole,
      refs: [face.reference],
    })
    expect(saved?.mask.strokes).toHaveLength(1)
    const meshFile = success(
      localToolOutputs.prepare_model_export.parse(
        await call("prepare_model_export", { revision: updated.revision, format: "stl" }),
      ),
    )
    const stl = await retrieve(call, meshFile)
    expect(stl.readUInt32LE(80)).toBeGreaterThan(12)
    const exact = await readInfo()
    expect(exact.measurements?.data.features).toEqual(initial.measurements?.data.features)
    const removed = success(
      localToolOutputs.remove_surface_texture.parse(
        await apply("remove_surface_texture", { baseRevision: updated.revision, layerId }, true),
      ),
    )
    expect(removed.revision).toBe(updated.revision + 1)
    expect(
      success(
        localToolOutputs.model_surface_textures.parse(
          await call("model_surface_textures", {
            revision: removed.revision,
            featureId: part.body.featureId,
          }),
        ),
      ).layers,
    ).toEqual([])
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Undo", exact: true })
      .click()
    await expect(
      page.getByRole("treeitem", { name: "Surface textures", exact: true }),
    ).toBeVisible()
    const undone = await readInfo()
    expect(undone.summary.revision).toBe(removed.revision + 1)
    await page.reload()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const reloaded = await readInfo()
    expect(reloaded.summary.revision).toBe(undone.summary.revision)
    expect(
      success(
        localToolOutputs.model_surface_textures.parse(
          await call("model_surface_textures", {
            revision: reloaded.summary.revision,
            featureId: part.body.featureId,
          }),
        ),
      ).layers[0],
    ).toMatchObject({ heightMm: 0.45, mask: { strokeCount: 1 }, map: { pixelCount: 65536 } })
    expect(
      await call("remove_surface_texture", { baseRevision: initial.summary.revision, layerId }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
  } finally {
    await local.close()
  }
})
