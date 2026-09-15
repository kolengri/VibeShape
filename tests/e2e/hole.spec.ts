import { readFile } from "node:fs/promises"
import type { Browser, Page } from "@playwright/test"
import { readVersionedVShape } from "../../packages/formats/src/vshape"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

async function clickFirstHoleCenter(page: Page) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("Expected the Hole viewport canvas.")
  const hover = viewport.getByText("Select Point 1 as a hole center.", { exact: true })
  // The fixed drawing fixture puts this corner left of the model center in the isometric view.
  for (const row of [0.535, 0.52, 0.55, 0.505, 0.565]) {
    for (const column of [0.23, 0.215, 0.245, 0.2, 0.26]) {
      const x = bounds.x + bounds.width * column
      const y = bounds.y + bounds.height * row
      await page.mouse.move(x, y)
      await page.evaluate("new Promise((resolve) => requestAnimationFrame(resolve))")
      if (!(await hover.isVisible())) continue
      await page.mouse.click(x, y)
      return
    }
  }
  throw new Error("The selected sketch point was not graphically pickable.")
}

async function inspectCompactHoleTask(page: Page, theme: string) {
  await page
    .locator("html")
    .evaluate((element, dark) => element.classList.toggle("dark", dark), theme === "dark")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 512, height: 450 })
  const expand = page.getByRole("button", { name: "Open task panel", exact: true })
  if (await expand.isVisible()) await expand.click()
  const form = page.getByRole("form", { name: "Edit hole", exact: true })
  await form.getByRole("combobox", { name: "Diameter", exact: true }).scrollIntoViewIfNeeded()
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const apply = form.getByRole("button", { name: "Update hole", exact: true })
  await expect(apply).toBeInViewport()
  await expect(apply).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath(`hole-compact-${theme}.png`) })
  await page.setViewportSize({ width: 1024, height: 900 })
}

async function reopenHoleBackup(browser: Browser, file: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  try {
    await page.goto("http://127.0.0.1:4173/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Project…" }).click()
    await page.getByLabel("Choose VibeShape project file").setInputFiles(file)
    const hole = page.getByRole("treeitem", { name: "Hole 1", exact: true })
    await expect(hole).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await hole.click()
    const form = page.getByRole("form", { name: "Edit hole", exact: true })
    await expect(form.getByRole("combobox", { name: "Diameter", exact: true })).toHaveValue("6 mm")
    await expect(form.getByRole("checkbox", { name: "Point 1", exact: true })).toBeChecked()
    await expect(form.getByRole("button", { name: "Update hole", exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`authors and edits sketch-point holes with keyboard selection, undo and native backup in ${theme}`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), theme === "dark")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    const hole = toolbar.getByRole("button", { name: "Hole", exact: true })
    await expect(hole).toBeDisabled()
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const box = page.getByRole("form", { name: "Create box" })
    for (const name of ["Width", "Depth"])
      await box.getByRole("combobox", { name, exact: true }).fill("200 mm")
    await box.getByRole("combobox", { name: "Height", exact: true }).fill("20 mm")
    await box.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(box).toHaveCount(0)
    await expect(viewport).toHaveAttribute("data-preview-status", "idle")
    await expect(hole).toBeDisabled()
    await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
    await confirmSketchPlane(page)
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await expect(hole).toBeEnabled()
    await hole.click()
    const form = page.getByRole("form", { name: "Hole", exact: true })
    const apply = form.getByRole("button", { name: "Create hole", exact: true })
    await expect(apply).toBeDisabled()
    const keyboard = viewport.getByRole("combobox", { name: "Hole center selection", exact: true })
    await keyboard.focus()
    await keyboard.selectOption({ index: 1 })
    await expect(form.getByRole("checkbox", { name: "Point 1", exact: true })).toBeChecked()
    await keyboard.selectOption({ index: 1 })
    await expect(form.getByRole("checkbox", { name: "Point 1", exact: true })).not.toBeChecked()
    await form.getByRole("checkbox", { name: "Point 1", exact: true }).check()
    await form.getByRole("combobox", { name: "Diameter", exact: true }).fill("4 mm")
    await form
      .getByRole("combobox", { name: "End condition", exact: true })
      .selectOption("through-all")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await form.getByRole("combobox", { name: "Direction", exact: true }).selectOption("reverse")
    await expect(viewport).toHaveAttribute("data-preview-status", "error")
    await expect(apply).toBeDisabled()
    await form.getByRole("combobox", { name: "Direction", exact: true }).selectOption("forward")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await clickFirstHoleCenter(page)
    await expect(form.getByRole("checkbox", { name: "Point 1", exact: true })).not.toBeChecked()
    await keyboard.focus()
    await keyboard.selectOption({ index: 1 })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await page.screenshot({ path: test.info().outputPath(`hole-${theme}.png`) })
    await apply.click()
    await expect(form).toHaveCount(0)
    const saved = page.getByRole("treeitem", { name: "Hole 1", exact: true })
    await expect(saved).toBeVisible()
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(saved).toHaveCount(0)
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(saved).toBeVisible()
    await saved.click()
    const edit = page.getByRole("form", { name: "Edit hole", exact: true })
    await expect(edit.getByRole("checkbox", { name: "Point 1", exact: true })).toBeChecked()
    await edit.getByRole("combobox", { name: "Diameter", exact: true }).fill("6 mm")
    await edit.getByRole("button", { name: "Update hole", exact: true }).click()
    await expect(edit).toHaveCount(0)
    await page.reload()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await saved.click()
    await expect(edit.getByRole("combobox", { name: "Diameter", exact: true })).toHaveValue("6 mm")
    await expect(edit.getByRole("checkbox", { name: "Point 1", exact: true })).toBeChecked()
    await inspectCompactHoleTask(page, theme)
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Project…" }).click()
    const downloading = page.waitForEvent("download")
    await page
      .getByRole("dialog", { name: "Projects" })
      .getByRole("button", { name: "Download .vshape" })
      .click()
    const file = await (await downloading).path()
    if (!file) throw new Error("Expected a native backup.")
    const archive = await readVersionedVShape(new Uint8Array(await readFile(file)))
    if (!archive.ok || archive.value.version !== 2)
      throw new Error("Expected replay-proven Hole history.")
    const feature = archive.value.project.snapshot.features.find(({ label }) => label === "Hole 1")
    expect(feature?.type.typeId).toBe("org.vibeshape.feature.part-design.hole")
    expect(feature?.type.schemaVersion).toBe(2)
    expect(feature?.parameters).toMatchObject({
      diameter: { value: 6 },
      targetBody: { schemaVersion: 0, featureId: feature?.dependencies[0], outputRole: "result" },
      pointIds: [expect.any(String)],
      extent: "through-all",
    })
    expect(JSON.stringify(feature?.parameters)).not.toContain("solvedPoints")
    await reopenHoleBackup(browser, file)
  })
}
