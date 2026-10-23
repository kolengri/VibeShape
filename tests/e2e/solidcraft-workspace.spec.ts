import { mkdir } from "node:fs/promises"
import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand, openModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test.setTimeout(60_000)

test("groups a History range with Shift gestures without selection checkboxes", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const history = page.getByRole("region", { name: "Feature history", exact: true })
  const first = history.getByRole("treeitem", { name: "Box 1", exact: true })
  const last = history.getByRole("treeitem", { name: "Cylinder 1", exact: true })
  await expect(history.getByRole("checkbox")).toHaveCount(0)
  await first.click({ modifiers: ["Shift"] })
  await last.click({ modifiers: ["Shift"] })
  await expect(history.locator('[data-folder-selected="true"]')).toHaveCount(2)
  await expect(page.getByRole("form", { name: "Edit box", exact: true })).toHaveCount(0)
  await history.getByRole("button", { name: "Clear selection", exact: true }).click()
  await first.press("Shift+Space")
  await last.press("Shift+Space")
  await expect(history.locator('[data-folder-selected="true"]')).toHaveCount(2)
  await history.getByRole("button", { name: "Add selection to folder", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New folder", exact: true })
  await dialog.getByRole("textbox", { name: "Folder name", exact: true }).fill("Fabrication")
  await dialog.getByRole("button", { name: "New folder", exact: true }).click()
  await expect(
    history.getByRole("treeitem", { name: "Folder Fabrication", exact: true }),
  ).toBeVisible()
  await saved(page)
})

test("separates objects and feature order while preserving the mounted task and viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  const browser = page.getByRole("complementary", { name: "Model tree", exact: true })
  const history = page.getByRole("region", { name: "Feature history", exact: true })
  await expect(browser.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
  await expect(browser.getByRole("treeitem", { name: "Box 1", exact: true })).toHaveCount(0)
  await expect(history.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await expect(browser.locator("[data-history-id]")).toHaveCount(0)

  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  const [objectBounds, sceneBounds, historyBounds, centerBounds] = await Promise.all([
    browser.boundingBox(),
    viewport.boundingBox(),
    history.boundingBox(),
    page.locator("#workspace-center").boundingBox(),
  ])
  if (!objectBounds || !sceneBounds || !historyBounds || !centerBounds)
    throw new Error("Workspace regions must be visible")
  expect(objectBounds.x + objectBounds.width).toBeLessThanOrEqual(centerBounds.x)
  expect(historyBounds.y).toBeGreaterThanOrEqual(sceneBounds.y + sceneBounds.height)
  const canvas = viewport.locator("canvas")
  const originalCanvas = await canvas.elementHandle()
  await history.getByRole("treeitem", { name: "Box 1", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit box", exact: true })
  await form.getByRole("combobox", { name: "Width", exact: true }).fill("27 mm")
  const disclosure = history.getByRole("button", { name: "Details", exact: true })
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "true")
  await expect(form.getByRole("combobox", { name: "Width", exact: true })).toHaveValue("27 mm")
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  await expect(form.getByRole("combobox", { name: "Width", exact: true })).toHaveValue("27 mm")
  expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
    true,
  )
  await form.getByRole("button", { name: "Cancel", exact: true }).click()

  await browser.getByRole("treeitem", { name: "Parts", exact: true }).click()
  await history.getByRole("button", { name: "Actions for Box 1", exact: true }).click()
  await page.getByRole("menuitem", { name: "Find in browser", exact: true }).click()
  const part = browser.getByRole("treeitem", { name: "Part Box 1", exact: true })
  await expect(part).toBeFocused()
  await expect(part).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("form", { name: "Edit box", exact: true })).toHaveCount(0)
})

for (const theme of ["dark", "light"] as const) {
  test(`keeps sketch objects and compact history usable in ${theme} at desktop and zoom-equivalent widths`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 720 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await page
      .locator("html")
      .evaluate((element, value) => element.classList.toggle("dark", value === "dark"), theme)
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    const browser = page.getByRole("complementary", { name: "Model tree", exact: true })
    const history = page.getByRole("region", { name: "Feature history", exact: true })
    await expect(browser.getByRole("treeitem", { name: "Sketch 1", exact: true })).toBeVisible()
    const sketch = history.getByRole("treeitem", { name: "Edit Sketch 1", exact: true })
    await expect(sketch).toBeVisible()
    await history.getByRole("treeitem", { name: "Box 1", exact: true }).press("ArrowRight")
    await expect(sketch).toBeFocused()
    await mkdir("artifacts/solidcraft-interface", { recursive: true })
    await page.screenshot({ path: `artifacts/solidcraft-interface/workspace-${theme}.png` })

    // A 512 CSS px viewport exercises the effective width of 1024 px at 200% zoom.
    await page.setViewportSize({ width: 512, height: 360 })
    await expect(history.getByRole("button", { name: "Details", exact: true })).toBeVisible()
    await expect(history.getByRole("button", { name: "Details", exact: true })).toBeInViewport()
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await expect(await openModelCommand(page, "Primitives", "Cylinder")).toBeVisible()
    await page.keyboard.press("Escape")
    await page.screenshot({ path: `artifacts/solidcraft-interface/workspace-${theme}-compact.png` })
  })
}
