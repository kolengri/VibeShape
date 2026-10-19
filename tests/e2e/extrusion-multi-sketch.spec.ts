import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { extrusionFeatureParametersV8Schema } from "../../packages/domain/src/part-design"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { expandHistoryDetails } from "./model-command-support"
import {
  clickSavedProfileInViewport,
  confirmSketchPlane,
  drawRectangle,
  fitIsometricView,
} from "./sketch-helpers"

async function saved(page: Page) {
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({ timeout: 30_000 })
}

test("adds and removes profiles from different sketch planes, previews once, and preserves Apply/Undo/reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await saved(page)
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  for (const plane of ["xy", "yz"] as const) {
    await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
    await confirmSketchPlane(page, plane)
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await saved(page)
  }
  await fitIsometricView(page)
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  const removals = form.getByRole("button", { name: /^Remove Sketch \d+ · Profile \d+$/ })
  while (await removals.count()) await removals.first().click()
  const picker = page.getByRole("combobox", { name: "Select saved profile", exact: true })
  await picker.selectOption({ label: "Sketch 1 · Profile 1" })
  await expect(
    form.getByRole("button", { name: "Remove Sketch 1 · Profile 1", exact: true }),
  ).toBeVisible()
  await form.getByRole("button", { name: "Select profiles", exact: true }).click()
  await expect(picker).toBeFocused()
  await picker.selectOption({ label: "Sketch 2 · Profile 1" })
  await expect(removals).toHaveCount(2)
  await picker.selectOption({ label: "Sketch 1 · Profile 1" })
  await expect(removals).toHaveCount(1)
  await expect(
    form.getByRole("button", { name: "Remove Sketch 2 · Profile 1", exact: true }),
  ).toBeVisible()
  await clickSavedProfileInViewport(page, "Sketch 1 · Profile 1", true)
  await expect(removals).toHaveCount(2)
  await form.getByRole("button", { name: "Remove Sketch 1 · Profile 1", exact: true }).click()
  await expect(removals).toHaveCount(1)
  await clickSavedProfileInViewport(page, "Sketch 1 · Profile 1")
  await expect(removals).toHaveCount(2)
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await saved(page)
  await page.reload()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await expandHistoryDetails(page)
  await page.getByRole("treeitem", { name: "Extrusion 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit extrusion", exact: true })
  await expect(edit.getByRole("button", { name: /^Remove Sketch \d+ · Profile 1$/ })).toHaveCount(2)
  await edit.getByRole("button", { name: "Cancel", exact: true }).click()
  await openApplicationMenuItem(page, "Files and projects…")
  const projects = page.getByRole("dialog", { name: "Projects", exact: true })
  const downloading = page.waitForEvent("download")
  await projects.getByRole("button", { name: "Save project (.vshape)", exact: true }).click()
  const download = await downloading
  const file = testInfo.outputPath("multi-sketch.vshape")
  await download.saveAs(file)
  const archive = await readAuthoredVShape(new Uint8Array(await readFile(file)))
  if (!archive.ok) throw new Error("The authored native archive must decode and replay.")
  const feature = archive.value.project.snapshot.features[0]
  if (!feature) throw new Error("Expected an archived Extrude.")
  expect(feature.type.schemaVersion).toBe(8)
  const parameters = extrusionFeatureParametersV8Schema.parse(feature.parameters)
  expect(parameters.profiles.profiles).toHaveLength(2)
  expect(new Set(parameters.profiles.profiles.map(({ sketchId }) => sketchId)).size).toBe(2)
})
