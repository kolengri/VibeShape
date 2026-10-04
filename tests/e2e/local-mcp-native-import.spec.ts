import { createHash } from "node:crypto"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  type ImportUploadDescriptor,
  type ImportUploadInspection,
} from "../../packages/automation-api/src/imports"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi } from "./application-menu-support"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { exportGeometry, requireSourceSnapshot } from "./source-import-ui-support"

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>
async function uploadSource(call: Call, bytes: Buffer, filename: string, revision: number) {
  const upload: ImportUploadDescriptor = success(
    localToolOutputs.begin_import_upload.parse(
      await call("begin_import_upload", {
        revision,
        filename,
        byteLength: bytes.length,
        sourceUnit: filename.endsWith("3mf") ? null : "millimeter",
        label: `Paired ${filename}`,
      }),
    ),
  )
  for (let offset = 0; offset < bytes.length; offset += IMPORT_UPLOAD_CHUNK_MAX_BYTES) {
    const appended = success(
      localToolOutputs.append_import_chunk.parse(
        await call("append_import_chunk", {
          uploadId: upload.uploadId,
          offset,
          base64: bytes.subarray(offset, offset + IMPORT_UPLOAD_CHUNK_MAX_BYTES).toString("base64"),
        }),
      ),
    )
    expect(appended.receivedBytes).toBe(
      Math.min(bytes.length, offset + IMPORT_UPLOAD_CHUNK_MAX_BYTES),
    )
  }
  return upload
}
test("imports authentic native files through paired chunks, manual preview, atomic persistence and portable Undo/Redo", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(45700 + testInfo.parallelIndex)
  const call: Call = async (name, args) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await saved(page)
    await createSolids(page)
    const sources = {
      step: await exportGeometry(page, "STEP"),
      stl: await exportGeometry(page, "STL"),
      "3mf": await exportGeometry(page, "3MF"),
    }
    await enableLocalAi(page)
    const tools = (await local.client.listTools()).tools
    expect(tools.find((tool) => tool.name === "commit_import_upload")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    })
    const initial = await saveProject(page)
    let revision = initial.project.snapshot.revision
    const malformed = await uploadSource(
      call,
      Buffer.from("Not a STEP file"),
      "broken.step",
      revision,
    )
    expect(await call("inspect_import_upload", { uploadId: malformed.uploadId })).toMatchObject({
      ok: false,
      diagnostic: { code: "import-failed" },
    })
    expect(await call("discard_import_upload", { uploadId: malformed.uploadId })).toMatchObject({
      ok: true,
    })
    for (const format of ["step", "stl", "3mf"] as const) {
      const before = await saveProject(page)
      const bytes = sources[format]
      const upload = await uploadSource(call, bytes, `source.${format}`, revision)
      const inspection: ImportUploadInspection = success(
        localToolOutputs.inspect_import_upload.parse(
          await call("inspect_import_upload", { uploadId: upload.uploadId }),
        ),
      )
      expect(inspection.upload.sha256).toBe(createHash("sha256").update(bytes).digest("hex"))
      expect(inspection.representation).toBe(format === "step" ? "exact-solid" : "triangle-mesh")
      expect(inspection.outputs.length).toBeGreaterThan(0)
      for (const output of inspection.outputs)
        expect(output.volumeMm3 === null).toBe(format !== "step")
      expect((await saveProject(page)).project.snapshot.features).toEqual(
        before.project.snapshot.features,
      )
      const request = () =>
        call("commit_import_upload", {
          uploadId: upload.uploadId,
          uploadVersion: inspection.upload.uploadVersion,
        })
      const cancelled = request()
      const review = page.getByRole("region", { name: "Review AI import", exact: true })
      await expect(review).toBeVisible({ timeout: 30_000 })
      await expect(review.getByLabel("Imported source preview", { exact: true })).toBeVisible()
      await review.getByRole("button", { name: "Discard", exact: true }).click()
      expect(await cancelled).toMatchObject({
        ok: false,
        diagnostic: { code: "import-review-cancelled" },
      })
      expect((await saveProject(page)).project.snapshot.features).toEqual(
        before.project.snapshot.features,
      )
      const applying = request()
      await expect(review).toBeVisible({ timeout: 30_000 })
      await expect(review.getByRole("button", { name: "Apply", exact: true })).toBeEnabled({
        timeout: 30_000,
      })
      await review.getByRole("button", { name: "Apply", exact: true }).dblclick()
      const committed = success(localToolOutputs.commit_import_upload.parse(await applying))
      revision = committed.revision
      await saved(page)
      const savedImport = await saveProject(page)
      const snapshot = requireSourceSnapshot(savedImport.project.snapshot)
      expect(snapshot.assets).toContainEqual(
        expect.objectContaining({
          digest: inspection.upload.sha256,
          byteLength: bytes.length,
          filename: `source.${format}`,
        }),
      )
      const feature = snapshot.features.find((feature) => feature.id === inspection.featureId)
      expect(feature).toMatchObject({
        label: `Paired source.${format}`,
        dependencies: [],
        references: [],
      })
      const parts = snapshot.parts.filter(
        (part) => part.bodyHistory[0]?.featureId === inspection.featureId,
      )
      expect(parts.map((part) => part.bodyHistory[0]?.outputRole).sort()).toEqual(
        [...committed.outputRoles].sort(),
      )
      expect(savedImport.project.versionedEvents.some((event) => event.actor.type === "mcp")).toBe(
        true,
      )
      if (!("assetBlobs" in savedImport.project))
        throw new Error("The portable source closure is required.")
      expect(savedImport.project.assetBlobs).toContainEqual({
        digest: inspection.upload.sha256,
        bytes: new Uint8Array(bytes),
      })
      await page.getByRole("button", { name: "Undo", exact: true }).click()
      await saved(page)
      expect((await saveProject(page)).project.snapshot.features).toEqual(
        before.project.snapshot.features,
      )
      await page.getByRole("button", { name: "Redo", exact: true }).click()
      await saved(page)
      await page.reload()
      await saved(page)
      const restored = await saveProject(page)
      expect(restored.project.snapshot.features).toEqual(snapshot.features)
      expect(restored.project.snapshot.parts).toEqual(snapshot.parts)
      await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
      revision = restored.project.snapshot.revision
    }
    const portable = await saveProject(page)
    await openProject(page, portable)
    await page.reload()
    await saved(page)
    expect((await saveProject(page)).project.snapshot.features).toEqual(
      portable.project.snapshot.features,
    )
  } finally {
    await local.close()
  }
})
