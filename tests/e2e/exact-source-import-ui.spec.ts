import { createHash } from "node:crypto"
import type { Page } from "@playwright/test"
import {
  importedBodyOutputRole,
  readImportedFeatureParameters,
} from "../../packages/domain/src/part-design-import"
import { readPlacementFeatureParameters } from "../../packages/domain/src/part-design-placement"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import {
  chooseImportSource,
  exportGeometry,
  requireSourceSnapshot,
} from "./source-import-ui-support"

async function inspectImport(page: Page, bytes: Buffer) {
  const dialog = await chooseImportSource(page, bytes, "exact-source.step", "Millimeter (mm)")
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await expect(dialog.getByLabel("Read-only import preview", { exact: true })).toBeVisible()
  await expect(
    dialog.getByText("2 exact solids are ready for import.", { exact: true }),
  ).toBeVisible()
  return dialog
}

test("inspects local exact solids without mutation, publishes captured assets atomically, undoes, reopens and independently places/exports one body", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const source = await exportGeometry(page, "STEP")
  const before = await saveProject(page)
  let dialog = await chooseImportSource(
    page,
    Buffer.from("This is not a STEP file."),
    "exact-source.step",
    "Millimeter (mm)",
  )
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeDisabled()
  await dialog
    .getByLabel("Source file", { exact: true })
    .setInputFiles({ name: "exact-source.step", mimeType: "application/step", buffer: source })
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await expect(
    dialog.getByText(
      "Source units are explicit metadata supplied by you; they were not detected from the file.",
      { exact: true },
    ),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  const canceled = await saveProject(page)
  expect(canceled.project.snapshot.schemaVersion).toBe(before.project.snapshot.schemaVersion)
  expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)

  dialog = await inspectImport(page, source)
  await dialog.getByRole("button", { name: "Apply import", exact: true }).dblclick()
  await expect(dialog).not.toBeVisible({ timeout: 30_000 })
  await saved(page)
  const imported = await saveProject(page)
  const snapshot = requireSourceSnapshot(imported.project.snapshot)
  expect(snapshot.assets).toHaveLength(1)
  expect(snapshot.assets[0]).toMatchObject({
    digest: createHash("sha256").update(source).digest("hex"),
    byteLength: source.byteLength,
    filename: "exact-source.step",
    format: "step",
    representation: "exact-solid",
    normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1 },
  })
  const features = snapshot.features.filter((feature) => readImportedFeatureParameters(feature))
  expect(features).toHaveLength(1)
  const feature = features[0]
  if (!feature) throw new Error("An ordinary captured source feature must exist.")
  const parameters = readImportedFeatureParameters(feature)
  if (!parameters) throw new Error("The source manifest must be valid.")
  expect(parameters.sourceAssetId).toBe(snapshot.assets[0]?.id)
  expect(parameters.outputs).toHaveLength(2)
  expect(feature.dependencies).toEqual([])
  expect(feature.references).toEqual([])
  const parts = snapshot.parts.filter(({ bodyHistory }) => bodyHistory[0]?.featureId === feature.id)
  expect(parts).toHaveLength(2)
  expect(snapshot.parts.filter(({ id }) => !parts.some((part) => part.id === id))).toEqual(
    before.project.snapshot.parts,
  )
  expect(new Set(parts.map(({ id }) => id)).size).toBe(2)
  expect(parts.map(({ bodyHistory }) => bodyHistory[0]?.outputRole).sort()).toEqual(
    parameters.outputs.map(({ outputId }) => importedBodyOutputRole(outputId)).sort(),
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
  for (const part of parts)
    await expect(page.locator(`[data-part-id="${part.id}"]`)).toHaveAttribute(
      "data-part-status",
      "available",
    )

  const chosen = parts[0]
  if (!chosen) throw new Error("A captured exact part must be independently selectable.")
  const row = page.locator(`[data-part-id="${chosen.id}"]`)
  await row.getByRole("button", { name: `Rename part ${chosen.name}`, exact: true }).click()
  const rename = page.getByRole("dialog", { name: "Rename item", exact: true })
  await rename.getByRole("textbox", { name: "Name", exact: true }).fill("Captured body")
  await rename.getByRole("button", { name: "Rename", exact: true }).click()
  await saved(page)
  await row.getByRole("treeitem").click()
  await page.getByRole("button", { name: "Place part Captured body", exact: true }).click()
  const placement = page.getByRole("form", { name: "Place part", exact: true })
  await placement.getByRole("combobox", { name: "Translate Z", exact: true }).fill("30 mm")
  await expect(
    placement.getByRole("button", { name: "Create placement", exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
  await placement.getByRole("button", { name: "Create placement", exact: true }).click()
  await saved(page)
  const placed = await saveProject(page)
  const placedFeature = placed.project.snapshot.features.find((item) =>
    readPlacementFeatureParameters(item),
  )
  if (!placedFeature) throw new Error("The captured body must use ordinary Placement.")
  expect(readPlacementFeatureParameters(placedFeature)?.targetBody).toEqual(chosen.bodyHistory[0])
  expect(placed.project.snapshot.parts.filter(({ id }) => id !== chosen.id)).toEqual(
    snapshot.parts.filter(({ id }) => id !== chosen.id),
  )
  await exportGeometry(page, "STEP", "Captured body")
  const afterExport = await saveProject(page)
  expect(afterExport.project.snapshot.features).toEqual(placed.project.snapshot.features)
  expect(afterExport.project.snapshot.parts).toEqual(placed.project.snapshot.parts)
})
