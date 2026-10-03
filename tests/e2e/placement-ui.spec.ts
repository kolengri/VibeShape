import type { Page } from "@playwright/test"
import { readPlacementFeatureParameters } from "../../packages/domain/src/part-design-placement"
import {
  createSolids,
  deleteFeatureAndUndo,
  openProject,
  saved,
  saveProject,
} from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

async function placementValues(page: Page, title: string, x: string) {
  const form = page.getByRole("form", { name: title, exact: true })
  await form.getByRole("combobox", { name: "Translate X", exact: true }).fill(x)
  await form.getByRole("combobox", { name: "Rotate Z", exact: true }).fill("90 deg")
  return form
}

test("places a stable part with editable expressions, Undo, reload, and a native archive", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const parts = page.locator("[data-part-id]")
  const ids = await parts.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-part-id")),
  )
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Place / align faces", exact: true }).click()
  let form = await placementValues(page, "Place part", "50 mm")
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Placement 1", exact: true })).toHaveCount(0)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Place / align faces", exact: true }).click()
  form = await placementValues(page, "Place part", "50 mm")
  await form.getByRole("button", { name: "Create placement", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Placement 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  expect(
    await parts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-part-id"))),
  ).toEqual(ids)
  const first = await saveProject(page)
  const placement = first.project.snapshot.features.find((feature) =>
    readPlacementFeatureParameters(feature),
  )
  if (!placement) throw new Error("Placement must be saved as an authored feature.")
  expect(readPlacementFeatureParameters(placement)).toMatchObject({
    translation: { x: { value: 50, source: { expression: "50 mm" } } },
    rotation: { z: { value: Math.PI / 2 } },
  })
  expect(first.project.snapshot.parts[0]?.bodyHistory.at(-1)?.featureId).toBe(placement.id)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
    "data-selected-feature",
    placement.id,
  )
  await page.getByRole("treeitem", { name: "Placement 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit placement", exact: true })
  await expect(form.getByRole("combobox", { name: "Translate X", exact: true })).toHaveValue(
    "50 mm",
  )
  await form.getByRole("combobox", { name: "Translate X", exact: true }).fill("60 mm")
  await form.getByRole("button", { name: "Update placement", exact: true }).click()
  await expect(form).not.toBeVisible()
  await saved(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  const undonePlacement = undone.project.snapshot.features.find(({ id }) => id === placement.id)
  if (!undonePlacement) throw new Error("Undo must retain the placement feature.")
  expect(readPlacementFeatureParameters(undonePlacement)?.translation.x.value).toBe(50)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.parts.map(({ id }) => id)).toEqual(ids)
  const updated = reloaded.project.snapshot.features.find(({ id }) => id === placement.id)
  if (!updated) throw new Error("The placement identity must survive reload.")
  expect(readPlacementFeatureParameters(updated)?.translation.x.value).toBe(60)
  await openProject(page, reloaded)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.id).not.toBe(reloaded.project.snapshot.id)
  expect(imported.project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
  expect(imported.project.snapshot.features).toEqual(reloaded.project.snapshot.features)
  const restored = await deleteFeatureAndUndo(page, "Placement 1")
  expect(restored.project.snapshot.features).toEqual(imported.project.snapshot.features)
  expect(restored.project.snapshot.parts).toEqual(imported.project.snapshot.parts)
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath("placement-two-parts.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Show model tree", exact: true }).click()
  await page.getByRole("treeitem", { name: "Placement 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit placement", exact: true })
  await expect(form.getByRole("button", { name: "Update placement", exact: true })).toBeInViewport()
  await form.getByRole("combobox", { name: "Rotate Z", exact: true }).scrollIntoViewIfNeeded()
  await expect(form.getByRole("combobox", { name: "Rotate Z", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("placement-compact.png") })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
})
