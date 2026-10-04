import { createHash } from "node:crypto"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import type {
  BinaryExportChunk,
  BinaryExportDescriptor,
} from "../../packages/automation-api/src/binary-exports"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { enableLocalAi, openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>
async function retrieve(call: Call, file: BinaryExportDescriptor) {
  const pieces: Buffer[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const chunk: BinaryExportChunk = success(
      localToolOutputs.read_export_chunk.parse(
        await call("read_export_chunk", { exportId: file.exportId, offset, limit: 1024 }),
      ),
    )
    expect(chunk.offset).toBe(offset)
    pieces.push(Buffer.from(chunk.base64, "base64"))
    offset = chunk.nextOffset
  }
  const bytes = Buffer.concat(pieces)
  expect(bytes.byteLength).toBe(file.byteLength)
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256)
  return bytes
}
async function validateFile(format: BinaryExportDescriptor["format"], bytes: Buffer) {
  if (format === "step") expect(bytes.toString("utf8")).toContain("ISO-10303-21;")
  if (format === "stl") expect(bytes.readUInt32LE(80) * 50 + 84).toBe(bytes.byteLength)
  if (format === "3mf") expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  if (format !== "vshape") return
  const decoded = await readAuthoredVShape(new Uint8Array(bytes))
  expect(decoded.ok).toBe(true)
  if (!decoded.ok) throw new Error("Expected a replay-valid editable backup.")
  expect(decoded.value.project.snapshot.features).toContainEqual(
    expect.objectContaining({ id: id(2), label: "Chunked export box" }),
  )
}
test("retrieves exact geometry and replay-valid editable backup through actor-owned MCP chunks", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(43380 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    const tools = (await local.client.listTools()).tools
    for (const name of [
      "prepare_model_export",
      "prepare_project_backup",
      "read_export_chunk",
      "discard_export",
    ])
      expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      })
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    const before = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: before.summary.revision }),
      ),
    )
    expect(
      await call("create_box", {
        draftId: draft.draftId,
        baseRevision: before.summary.revision,
        commandId: id(1),
        featureId: id(2),
        label: "Chunked export box",
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      }),
    ).toMatchObject({ ok: true })
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")
    const committing = call("commit_draft", { draftId: draft.draftId })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible()
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const committed = success(localToolOutputs.commit_draft.parse(await committing))
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    let backup: Buffer | undefined
    for (const format of ["step", "stl", "3mf", "vshape"] as const) {
      const file =
        format === "vshape"
          ? success(
              localToolOutputs.prepare_project_backup.parse(
                await call("prepare_project_backup", { revision: committed.revision }),
              ),
            )
          : success(
              localToolOutputs.prepare_model_export.parse(
                await call("prepare_model_export", { revision: committed.revision, format }),
              ),
            )
      expect(file).toMatchObject({
        documentId: before.summary.documentId,
        revision: committed.revision,
        format,
      })
      const bytes = await retrieve(call, file)
      await validateFile(format, bytes)
      if (format === "vshape") backup = bytes
      expect(await call("discard_export", { exportId: file.exportId })).toMatchObject({ ok: true })
      expect(await call("read_export_chunk", { exportId: file.exportId, offset: 0 })).toMatchObject(
        { ok: false, diagnostic: { code: "export-unavailable" } },
      )
    }
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(committed.revision)
    if (!backup) throw new Error("Expected the editable backup bytes.")
    const fresh = await browser.newContext()
    try {
      const imported = await fresh.newPage()
      await imported.goto(local.origin)
      await expect(imported.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await openApplicationMenuItem(imported, "Files and projects…")
      await imported
        .getByRole("dialog", { name: "Projects" })
        .getByLabel("Choose VibeShape project file")
        .setInputFiles({
          name: "model.vshape",
          mimeType: "application/octet-stream",
          buffer: backup,
        })
      await expect(
        imported.getByRole("treeitem", { name: "Chunked export box", exact: true }),
      ).toBeVisible()
      await imported.reload()
      await expect(
        imported.getByRole("treeitem", { name: "Chunked export box", exact: true }),
      ).toBeVisible()
    } finally {
      await fresh.close()
    }
  } finally {
    await local.close()
  }
})
