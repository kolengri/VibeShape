import { createHash } from "node:crypto"
import type { Page } from "@playwright/test"
import {
  meshImportOutputRole,
  readMeshImportFeatureParameters,
} from "../../packages/domain/src/part-design-mesh-import"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import {
  chooseImportSource,
  exportGeometry,
  openExport,
  requireSourceSnapshot,
} from "./source-import-ui-support"

async function renameMeshPart(page: Page, part: { id: string; name: string }) {
  const row = page.locator(`[data-part-id="${part.id}"]`)
  await row.getByRole("button", { name: `Rename part ${part.name}`, exact: true }).click()
  const rename = page.getByRole("dialog", { name: "Rename item", exact: true })
  await rename.getByRole("textbox", { name: "Name", exact: true }).fill("Captured mesh")
  await rename.getByRole("button", { name: "Rename", exact: true }).click()
  await saved(page)
  await row.getByRole("treeitem").click()
  await expect(row.getByText(/Triangle mesh: print preparation/)).toBeVisible()
  for (const action of ["Place part", "Mirror part", "Shell", "Split part", "Pattern", "Thread"])
    await expect(
      row.getByRole("button", { name: `${action} Captured mesh`, exact: true }),
    ).toBeDisabled()
  return row
}
async function printMeshCopy(page: Page) {
  const dialog = await openExport(page)
  await dialog.getByRole("button", { name: "Prepare print / breakaway fins…", exact: true }).click()
  await dialog.getByLabel("Generate experimental breakaway fins", { exact: true }).uncheck()
  await dialog.getByRole("button", { name: "Generate print preview", exact: true }).click()
  await expect(
    dialog.getByLabel("Prepared print model and breakaway fins", { exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText(/bodies · 0 fins/)).toBeVisible()
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download prepared 3MF", exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.3mf$/)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
}

for (const format of ["stl", "3mf"] as const) {
  test(`imports authentic ${format.toUpperCase()} as owned meshes, cancels, undoes, reopens, prints and exports without exact-solid claims`, async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await page.goto("/")
    await saved(page)
    await createSolids(page)
    const source = await exportGeometry(page, format === "stl" ? "STL" : "3MF")
    const before = await saveProject(page)
    const choose = () =>
      chooseImportSource(
        page,
        source,
        `mesh-source.${format}`,
        format === "stl" ? "Millimeter (mm)" : undefined,
      )
    let dialog = await choose()
    if (format === "3mf") {
      await expect(
        dialog.getByRole("combobox", { name: "Source unit metadata", exact: true }),
      ).toHaveCount(0)
      await expect(
        dialog.getByText("Source units: declared by the 3MF file", { exact: true }),
      ).toBeVisible()
    }
    await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await expect(dialog.getByText(/triangle mesh(?:es)? (?:is|are) ready for import/)).toBeVisible()
    await expect(dialog.getByText(/They have no exact solid volume or topology/)).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    const canceled = await saveProject(page)
    expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
    expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)
    expect(canceled.project.snapshot.schemaVersion).toBe(before.project.snapshot.schemaVersion)
    dialog = await choose()
    await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await dialog.getByRole("button", { name: "Apply import", exact: true }).dblclick()
    await expect(dialog).not.toBeVisible({ timeout: 30_000 })
    await saved(page)
    const imported = await saveProject(page),
      snapshot = requireSourceSnapshot(imported.project.snapshot)
    expect(snapshot.assets).toHaveLength(1)
    expect(snapshot.assets[0]).toMatchObject({
      format,
      representation: "triangle-mesh",
      digest: createHash("sha256").update(source).digest("hex"),
      byteLength: source.byteLength,
      normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1 },
    })
    const features = snapshot.features.filter((feature) => readMeshImportFeatureParameters(feature))
    expect(features).toHaveLength(1)
    const feature = features[0]
    if (!feature) throw new Error("A captured mesh feature must be published.")
    const parameters = readMeshImportFeatureParameters(feature)
    if (!parameters) throw new Error("The mesh capture must be valid.")
    expect(parameters.outputs).toHaveLength(format === "stl" ? 1 : 2)
    expect(parameters.outputs.every((output) => !("signature" in output))).toBe(true)
    const parts = snapshot.parts.filter(
      ({ bodyHistory }) => bodyHistory[0]?.featureId === feature.id,
    )
    expect(parts.map(({ bodyHistory }) => bodyHistory[0]?.outputRole).sort()).toEqual(
      parameters.outputs.map(({ outputId }) => meshImportOutputRole(outputId)).sort(),
    )
    for (const part of parts)
      await expect(page.locator(`[data-part-id="${part.id}"]`)).toHaveAttribute(
        "data-part-status",
        "available",
      )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await saved(page)
    const undone = await saveProject(page)
    expect(undone.project.snapshot.features).toEqual(before.project.snapshot.features)
    expect(undone.project.snapshot.parts).toEqual(before.project.snapshot.parts)
    expect(requireSourceSnapshot(undone.project.snapshot).assets).toEqual([])
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await saved(page)
    await page.reload()
    await saved(page)
    const reloaded = await saveProject(page)
    expect(reloaded.project.snapshot.features).toEqual(snapshot.features)
    expect(reloaded.project.snapshot.parts).toEqual(snapshot.parts)
    await openProject(page, reloaded)
    const part = parts[0]
    if (!part) throw new Error("One captured mesh Part must be selectable.")
    await renameMeshPart(page, part)
    const named = await saveProject(page)
    const step = await openExport(page, "Captured mesh")
    await step.getByRole("button", { name: "Export STEP", exact: true }).click()
    await expect(step.getByRole("alert")).toContainText(/exact solid/i)
    await step.getByRole("button", { name: "Close", exact: true }).click()
    expect((await exportGeometry(page, "STL", "Captured mesh")).byteLength).toBeGreaterThan(84)
    expect((await exportGeometry(page, "3MF", "Captured mesh")).byteLength).toBeGreaterThan(0)
    await printMeshCopy(page)
    const afterExport = await saveProject(page)
    expect(afterExport.project.snapshot.features).toEqual(named.project.snapshot.features)
    expect(afterExport.project.snapshot.parts).toEqual(named.project.snapshot.parts)
    expect(requireSourceSnapshot(afterExport.project.snapshot).assets).toEqual(
      requireSourceSnapshot(named.project.snapshot).assets,
    )
  })
}
