import type { Locator, Page } from "@playwright/test"
import { readLoftFeatureParameters } from "../../packages/domain/src/part-design-loft"
import { readSweepFeatureParameters } from "../../packages/domain/src/part-design-sweep"
import { openApplicationMenuItem } from "./application-menu-support"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, selectSketchTool } from "./sketch-helpers"
import { visibleCadPickPositions } from "./visible-cad-picking-support"

type ScreenMatrix = { a: number; b: number; c: number; d: number; e: number; f: number }
async function clickSketchPoint(
  page: Page,
  drawing: Locator,
  x: number,
  y: number,
  snapOrigin = false,
) {
  const position = await drawing.locator("[data-sketch-plane-projection]").evaluate(
    (element, point) => {
      const geometry = element as unknown as { getScreenCTM?: () => ScreenMatrix | null }
      const matrix = geometry.getScreenCTM?.()
      if (!matrix) throw new Error("The sketch must expose its real drawing projection.")
      return {
        x: matrix.a * point.x - matrix.c * point.y + matrix.e,
        y: matrix.b * point.x - matrix.d * point.y + matrix.f,
      }
    },
    { x, y },
  )
  if (snapOrigin) {
    await page.mouse.move(position.x, position.y)
    await expect(drawing.locator('[data-sketch-inference="coincident"]')).toBeVisible()
  }
  await page.mouse.click(position.x, position.y)
}
async function drawCenteredProfile(page: Page, alternate = false) {
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  await clickSketchPoint(page, drawing, -3, -3)
  await clickSketchPoint(page, drawing, 3, 3)
  if (alternate) {
    await page.keyboard.press("Escape")
    await selectSketchTool(page, "Rectangle tools", "Rectangle G")
    await clickSketchPoint(page, drawing, 6, -1)
    await clickSketchPoint(page, drawing, 8, 1)
  }
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(alternate ? 8 : 4)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
}
async function addSection(page: Page, label: string) {
  const form = page.getByRole("form", { name: /^(Loft profiles|Edit loft)$/ })
  await form.getByRole("combobox", { name: "Section profile", exact: true }).selectOption({ label })
  await form.getByRole("button", { name: "Add section", exact: true }).click()
}
async function exportPart(page: Page, name: string) {
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await dialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
  await page.getByRole("option", { name, exact: true }).click()
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("combobox", { name: "File format" }).selectOption("step")
  await dialog.getByRole("button", { name: "Save STEP file", exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.step$/)
  await expect(dialog).not.toBeVisible()
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}
async function selectDatumPlaneFace(page: Page) {
  const selection = page
    .getByRole("status")
    .filter({ hasText: /^Selection: Datum plane 1 · Face \d+$/ })
  const positions = await visibleCadPickPositions(page, "datum-face")
  expect(
    positions.length,
    "The datum face must expose a rendered graphical target.",
  ).toBeGreaterThan(0)
  for (const { x, y } of positions) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(resolve))")
    if (await selection.isVisible()) return
  }
  await expect(selection).toBeVisible()
}

test("authors Loft sections on an explicit datum plane, cancels, reorders, edits, undoes, reopens and exports", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawCenteredProfile(page)
  await invokeModelCommand(page, "Create", "Datum plane")
  const datum = page.getByRole("form", { name: "Create datum plane", exact: true })
  await datum.getByRole("combobox", { name: "Support", exact: true }).selectOption("xy")
  await datum.getByRole("combobox", { name: "Offset", exact: true }).fill("20 mm")
  await expect(datum.getByRole("button", { name: "Create datum plane", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await datum.getByRole("button", { name: "Create datum plane", exact: true }).click()
  await saved(page)
  await selectDatumPlaneFace(page)
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Support plane", exact: true })).toHaveValue(
    "feature-face",
  )
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await drawCenteredProfile(page)
  const before = await saveProject(page)
  await invokeModelCommand(page, "Create", "Loft")
  let form = page.getByRole("form", { name: "Loft profiles", exact: true })
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await addSection(page, "Sketch 1 · Profile 1")
  await addSection(page, "Sketch 2 · Profile 1")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    before.project.snapshot.features,
  )
  await invokeModelCommand(page, "Create", "Loft")
  form = page.getByRole("form", { name: "Loft profiles", exact: true })
  await addSection(page, "Sketch 1 · Profile 1")
  await addSection(page, "Sketch 2 · Profile 1")
  await form.getByRole("button", { name: "Move section 2 earlier", exact: true }).click()
  await form.getByRole("checkbox", { name: "Ruled loft", exact: true }).check()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  const applied = await saveProject(page)
  const loft = required(
    applied.project.snapshot.features.find((feature) => readLoftFeatureParameters(feature)),
    "A saved Loft must exist.",
  )
  const params = readLoftFeatureParameters(loft)
  expect(params?.sections.map(({ sketchId }) => sketchId)).toEqual(
    [...before.project.snapshot.sketches].reverse().map(({ id }) => id),
  )
  expect(params?.ruled).toBe(true)
  expect(loft.dependencies).toEqual(before.project.snapshot.features.map(({ id }) => id))
  await expect(page.getByRole("treeitem", { name: "Part Loft 1", exact: true })).toBeVisible()
  await page.getByRole("treeitem", { name: "Loft 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit loft", exact: true })
  await expect(form.getByRole("checkbox", { name: "Ruled loft", exact: true })).toBeChecked()
  await form.getByRole("checkbox", { name: "Ruled loft", exact: true }).uncheck()
  await expect(form.getByRole("button", { name: "Update feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await saved(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    applied.project.snapshot.features,
  )
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(
    readLoftFeatureParameters(
      required(
        reloaded.project.snapshot.features.find(({ id }) => id === loft.id),
        "Loft identity must survive reload.",
      ),
    )?.ruled,
  ).toBe(false)
  await openProject(page, reloaded)
  expect((await saveProject(page)).project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
  await exportPart(page, "Loft 1")
})

test("authors a straight Sweep from an XY profile and an explicit XZ path, guards reversed start, edits, undoes and reopens", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawCenteredProfile(page, true)
  await page.getByRole("button", { name: "Hide Sketch 1", exact: true }).click()
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xz")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await page.getByRole("button", { name: "Line", exact: true }).click()
  await clickSketchPoint(page, drawing, 0, 0, true)
  await clickSketchPoint(page, drawing, 0, 20)
  await page.keyboard.press("Escape")
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  const before = await saveProject(page)
  await invokeModelCommand(page, "Create", "Sweep")
  let form = page.getByRole("form", { name: "Sweep profile", exact: true })
  await form
    .getByRole("combobox", { name: "Profile", exact: true })
    .selectOption({ label: "Sketch 1 · Profile 1" })
  await form
    .getByRole("combobox", { name: "Path sketch", exact: true })
    .selectOption({ label: "Sketch 2" })
  await form.getByRole("checkbox", { name: /^Line \d+$/ }).check()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  const direction = form.getByRole("combobox", { name: "Path start point", exact: true })
  const options = await direction.locator("option").evaluateAll((entries) =>
    entries
      .map((option) => ({
        value: option.getAttribute("value") ?? "",
        label: option.textContent ?? "",
      }))
      .filter(({ value }) => value),
  )
  const origin = required(
    options.find(({ label }) => label.includes("(0, 0, 0)")),
    "The authored path must begin exactly at the profile frame origin.",
  )
  const end = required(
    options.find(({ value }) => value !== origin.value),
    "An open path must expose its other endpoint.",
  )
  await direction.selectOption(end.value)
  await expect(form.getByRole("alert")).toContainText("The exact feature could not be built", {
    timeout: 30_000,
  })
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await direction.selectOption(origin.value)
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    before.project.snapshot.features,
  )
  await invokeModelCommand(page, "Create", "Sweep")
  form = page.getByRole("form", { name: "Sweep profile", exact: true })
  await form
    .getByRole("combobox", { name: "Profile", exact: true })
    .selectOption({ label: "Sketch 1 · Profile 1" })
  await form
    .getByRole("combobox", { name: "Path sketch", exact: true })
    .selectOption({ label: "Sketch 2" })
  await form.getByRole("checkbox", { name: /^Line \d+$/ }).check()
  await form
    .getByRole("combobox", { name: "Path start point", exact: true })
    .selectOption(origin.value)
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  const applied = await saveProject(page)
  const sweep = required(
    applied.project.snapshot.features.find((feature) => readSweepFeatureParameters(feature)),
    "A saved Sweep must exist.",
  )
  expect(readSweepFeatureParameters(sweep)?.path.startPointId).toBe(origin.value)
  await expect(page.getByRole("treeitem", { name: "Part Sweep 1", exact: true })).toBeVisible()
  await page.getByRole("treeitem", { name: "Sweep 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit sweep", exact: true })
  await expect(form.getByRole("combobox", { name: "Path start point", exact: true })).toHaveValue(
    origin.value,
  )
  await form
    .getByRole("combobox", { name: "Profile", exact: true })
    .selectOption({ label: "Sketch 1 · Profile 2" })
  await expect(form.getByRole("button", { name: "Update feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await saved(page)
  const updated = await saveProject(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    applied.project.snapshot.features,
  )
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(
    readSweepFeatureParameters(
      required(
        reloaded.project.snapshot.features.find(({ id }) => id === sweep.id),
        "Sweep identity must survive reload.",
      ),
    ),
  ).toEqual(
    readSweepFeatureParameters(
      required(
        updated.project.snapshot.features.find(({ id }) => id === sweep.id),
        "Edited Sweep must persist its changed profile.",
      ),
    ),
  )
  await openProject(page, reloaded)
  expect((await saveProject(page)).project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
  await exportPart(page, "Sweep 1")
})
