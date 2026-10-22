import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

for (const theme of ["dark", "light"] as const) {
  for (const width of [1024, 512]) {
    test(`compact parameter rows retain keyboard help in ${theme} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.goto("/")
      if (theme === "light") {
        await page.getByRole("button", { name: "Application menu", exact: true }).click()
        await page.getByRole("menuitem", { name: "Settings…", exact: true }).click()
        await page.getByRole("combobox", { name: "Theme", exact: true }).click()
        await page.getByRole("option", { name: "Light", exact: true }).click()
        await page.getByRole("button", { name: "Done", exact: true }).click()
      }
      await invokeModelCommand(page, "Primitives", "Box")
      const form = page.getByRole("form", { name: "Create box", exact: true })
      await expect(form).toBeVisible()
      const bounds = await form.boundingBox()
      if (!bounds) throw new Error("The parameter form has no measurable bounds.")
      const body = form.locator('[data-slot="task-panel-content"]')
      const bodyBounds = await body.boundingBox()
      if (!bodyBounds) throw new Error("The parameter body has no measurable bounds.")
      expect(bodyBounds.height).toBeLessThan(bounds.height)
      for (const name of ["Width", "Depth", "Origin X"]) {
        const input = form.getByRole("combobox", { name, exact: true })
        const field = input.locator("xpath=ancestor::*[@data-slot='field']")
        const label = await field.locator("label").boundingBox()
        const control = await input.boundingBox()
        if (!label || !control)
          throw new Error("The field label or control has no measurable bounds.")
        const row = await field.boundingBox()
        if (!row) throw new Error("The field row has no measurable bounds.")
        expect(row.height).toBeLessThanOrEqual(40)
        expect(label.x + label.width).toBeLessThan(control.x)
        expect(Math.abs(label.y + label.height / 2 - control.y - control.height / 2)).toBeLessThan(
          16,
        )
        expect(control.width).toBeGreaterThan(100)
        expect(control.x + control.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
      }
      expect(await form.locator("[data-slot=field-error]").count()).toBe(0)
      const help = form.getByRole("button", { name: "Help for Width", exact: true })
      await help.focus()
      await help.press("Enter")
      await expect(page.getByRole("dialog", { name: "Width", exact: true })).toContainText("#width")
      await page.getByRole("dialog", { name: "Width", exact: true }).press("Escape")
      await expect(help).toBeFocused()
      await expect(form).toBeVisible()
      const input = form.getByRole("combobox", { name: "Width", exact: true })
      await expect(input).toHaveValue("20 mm")
    })
  }
}

test("FDM target and selected-line rows keep usable widths", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto("/")
  await page.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page)
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  await invokeModelCommand(page, "Modify", "FDM tools")
  const form = page.getByRole("form", { name: "FDM tools", exact: true })
  const target = form.getByRole("combobox", { name: "Target body", exact: true })
  const bounds = await target.boundingBox()
  if (!bounds) throw new Error("The FDM target selector has no measurable bounds.")
  expect(bounds.width).toBeGreaterThan(100)
  await form.getByRole("combobox", { name: "Saved sketch", exact: true }).click()
  await page.getByRole("option", { name: "Sketch 1", exact: true }).click()
  const first = await form.getByRole("checkbox", { name: "Line 1", exact: true }).boundingBox()
  const second = await form.getByRole("checkbox", { name: "Line 2", exact: true }).boundingBox()
  if (!first || !second) throw new Error("The selected-line controls have no measurable bounds.")
  expect(first.x).toBeCloseTo(second.x, 0)
  expect(second.y).toBeGreaterThan(first.y)
})

test("assembly pose controls remain readable in a narrow task panel", async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto("/")
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  const panel = page.getByRole("region", { name: "Assembly task", exact: true })
  await panel.getByRole("button", { name: "Create definition", exact: true }).click()
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("Compact bracket")
  await panel.getByRole("button", { name: "Apply", exact: true }).click()
  await saved(page)
  await panel.getByRole("button", { name: "Add instance", exact: true }).click()
  for (const axis of ["X", "Y", "Z"]) {
    const control = panel.getByRole("spinbutton", { name: `${axis} (mm)`, exact: true })
    await expect(control).toBeVisible()
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error("The assembly pose input has no measurable bounds.")
    expect(bounds.width).toBeGreaterThan(100)
  }
})

test("disabled parameter fieldsets keep help available without unlocking inputs", async ({
  page,
}) => {
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  const width = form.getByRole("combobox", { name: "Width", exact: true })
  await expect(form.getByRole("button", { name: "Create box", exact: true })).toBeEnabled()
  // Isolate the native fieldset contract without racing a transient pending operation.
  await width.evaluate((input) => {
    const fieldset = input.closest("fieldset")
    if (!fieldset) throw new Error("The parameter must belong to a fieldset.")
    fieldset.disabled = true
  })
  await expect(width).toBeDisabled()
  const help = form.getByRole("button", { name: "Help for Width", exact: true })
  const nextHelp = form.getByRole("button", { name: "Help for Depth", exact: true })
  await help.focus()
  await page.keyboard.press("Tab")
  await expect(nextHelp).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(help).toBeFocused()
  for (const key of ["Enter", "Space"]) {
    await help.press(key)
    const guidance = page.getByRole("dialog", { name: "Width", exact: true })
    await expect(guidance).toContainText("#width")
    await guidance.press("Escape")
    await expect(help).toBeFocused()
  }
  await help.click()
  await expect(page.getByRole("dialog", { name: "Width", exact: true })).toBeVisible()
  await expect(width).toBeDisabled()
  await expect(width).toHaveValue("20 mm")
  await expect(form).toBeVisible()
})
