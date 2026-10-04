import { createHash } from "node:crypto"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { readImportedFeatureParameters } from "../../packages/domain/src/part-design-import"
import { enableLocalAi } from "./application-menu-support"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import {
  chooseImportSource,
  exportGeometry,
  requireSourceSnapshot,
} from "./source-import-ui-support"

function success<T>(
  value: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!value.ok) throw new Error(value.diagnostic.message)
  return value.value
}

test("previews and reapplies historical exact source bytes through MCP Redo after Undo clears current asset authority", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const local = await createMcpTestClient(44201 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const info = async () => success(localToolOutputs.model_info.parse(await call("model_info", {})))
  try {
    await page.goto(local.origin)
    await saved(page)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const box = page.getByRole("form", { name: "Create box", exact: true })
    await box.getByRole("combobox", { name: "Width", exact: true }).fill("12 mm")
    await box.getByRole("combobox", { name: "Depth", exact: true }).fill("8 mm")
    await box.getByRole("combobox", { name: "Height", exact: true }).fill("6 mm")
    await box.getByRole("button", { name: "Create box", exact: true }).click()
    await saved(page)
    const bytes = await exportGeometry(page, "STEP")
    const digest = createHash("sha256").update(bytes).digest("hex")
    const dialog = await chooseImportSource(page, bytes, "history-source.step", "Millimeter (mm)")
    await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await dialog.getByRole("button", { name: "Apply import", exact: true }).click()
    await expect(dialog).not.toBeVisible({ timeout: 30_000 })
    await saved(page)
    const imported = await saveProject(page)
    const target = requireSourceSnapshot(imported.project.snapshot)
    expect(target.assets).toHaveLength(1)
    expect(target.assets[0]).toMatchObject({ digest, byteLength: bytes.byteLength })
    const feature = target.features.find((entry) => readImportedFeatureParameters(entry))
    if (!feature) throw new Error("The native checkpoint must contain an imported source feature.")
    expect(readImportedFeatureParameters(feature)?.outputs).toHaveLength(1)
    await enableLocalAi(page)
    const readExactMeasurement = async (revision: number) => {
      const measured = success(
        localToolOutputs.model_measurements.parse(await call("model_measurements", { revision })),
      )
      const exact = measured.data.features.find((entry) => entry.featureId === feature.id)
      expect(exact, JSON.stringify(exact)).toMatchObject({
        status: "succeeded",
        shape: { valid: true, solidCount: 1 },
      })
      if (exact?.status !== "succeeded") throw new Error("The exact source must be valid.")
      expect(exact.shape.volume).toBeCloseTo(576, 7)
    }
    await readExactMeasurement(target.revision)

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await saved(page)
    const undone = await saveProject(page)
    const current = requireSourceSnapshot(undone.project.snapshot)
    expect(current.assets).toEqual([])
    expect(current.features.some((entry) => entry.id === feature.id)).toBe(false)
    if (!("assetBlobs" in undone.project))
      throw new Error("The native history must own source blobs.")
    expect(undone.project.assetBlobs.find((blob) => blob.digest === digest)?.bytes).toEqual(
      Uint8Array.from(bytes),
    )

    const summary = (await info()).summary
    expect(summary.revision).toBe(current.revision)
    const pending = call("redo_model", {
      documentId: summary.documentId,
      baseRevision: summary.revision,
      commandId: "0195b5ac-b270-7a2c-8c33-000000000001",
    })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review.getByText("Redo saved change", { exact: true })).toBeVisible({
      timeout: 60_000,
    })
    await expect(review.getByRole("button", { name: "Apply", exact: true })).toBeEnabled()
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const redone = success(localToolOutputs.redo_model.parse(await pending))
    expect(redone).toMatchObject({
      baseRevision: current.revision,
      revision: current.revision + 1,
      targetRevision: target.revision,
    })
    await expect(review).toHaveCount(0)
    await readExactMeasurement(redone.revision)
    const restored = await saveProject(page)
    expect(requireSourceSnapshot(restored.project.snapshot).assets).toEqual(target.assets)
    if (!("assetBlobs" in restored.project)) throw new Error("Saved Redo must retain source bytes.")
    expect(restored.project.assetBlobs.find((blob) => blob.digest === digest)?.bytes).toEqual(
      Uint8Array.from(bytes),
    )
    await page.reload()
    await saved(page)
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "2",
      { timeout: 30_000 },
    )
    const reopened = await saveProject(page)
    expect(requireSourceSnapshot(reopened.project.snapshot).assets).toEqual(target.assets)
    if (!("assetBlobs" in reopened.project))
      throw new Error("Reopen must retain native source bytes.")
    expect(reopened.project.assetBlobs.find((blob) => blob.digest === digest)?.bytes).toEqual(
      Uint8Array.from(bytes),
    )
  } finally {
    await local.close()
  }
})
