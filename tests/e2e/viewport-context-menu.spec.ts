import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function createBox(page: Page) {
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("combobox", { name: "Width", exact: true }).fill("20 mm")
  await form.getByRole("combobox", { name: "Depth", exact: true }).fill("20 mm")
  await form.getByRole("combobox", { name: "Height", exact: true }).fill("20 mm")
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(form).not.toBeVisible()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
    { timeout: 30_000 },
  )
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
  )
}

async function openContext(page: Page) {
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
    { timeout: 30_000 },
  )
  const canvas = page.getByRole("region", { name: "3D viewport", exact: true }).locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The model canvas is unavailable.")
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: "right",
  })
  const menu = page.getByRole("menu", { name: "Selection actions", exact: true })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "Properties", exact: true })).toBeEnabled()
  return menu
}

test("right click targets a body, saves its material and color, and restores them after reload and undo", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await createBox(page)
  let menu = await openContext(page)
  for (const name of [
    "Create Sketch",
    "Extrude",
    "Offset Plane",
    "Shell",
    "Edit Feature",
    "Edit Profile Sketch",
    "Save As Mesh…",
    "Delete",
    "Hide",
    "Find in Browser",
    "Find in Timeline",
    "Press Pull",
    "Measure",
    "Clear Selection",
  ]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible()
  }
  await menu.getByRole("menuitem", { name: "Appearance", exact: true }).hover()
  await page.getByRole("menuitem", { name: "Brass", exact: true }).click()
  await expect(menu).not.toBeVisible()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Appearance", exact: true }).hover()
  await page.getByRole("menuitem", { name: "Material and Color…", exact: true }).click()
  const appearance = page.getByRole("dialog", { name: "Appearance", exact: true })
  await expect(appearance.getByRole("combobox", { name: "Material preset" })).toHaveValue("brass")
  await appearance.getByLabel("Color", { exact: true }).fill("#e24987")
  await appearance.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(appearance).not.toBeVisible()
  await page.reload()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Appearance", exact: true }).hover()
  await page.getByRole("menuitem", { name: "Material and Color…", exact: true }).click()
  await expect(appearance.getByRole("combobox", { name: "Material preset" })).toHaveValue("brass")
  await expect(appearance.getByLabel("Color", { exact: true })).toHaveValue("#e24987")
  await page.screenshot({ path: "artifacts/context-menu/appearance-dark.png" })
  await appearance.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.keyboard.press("ControlOrMeta+z")
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Appearance", exact: true }).hover()
  await page.getByRole("menuitem", { name: "Material and Color…", exact: true }).click()
  await expect(appearance.getByLabel("Color", { exact: true })).toHaveValue("#c6a24a")
  await expect(appearance.getByRole("combobox", { name: "Material preset" })).toHaveValue("brass")
  await page.setViewportSize({ width: 512, height: 450 })
  await expect(appearance.getByRole("button", { name: "Apply", exact: true })).toBeInViewport()
})

test("context actions open properties and target mesh export, reveal history, and apply planar Press Pull", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1024, height: 900 })
  await createBox(page)
  let menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Properties", exact: true }).click()
  const properties = page.getByRole("dialog", { name: "Properties", exact: true })
  await expect(
    properties
      .locator("dt", { hasText: /^Volume$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("8,000 mm³")
  await properties.getByRole("button", { name: "Close", exact: true }).click()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Save As Mesh…", exact: true }).click()
  const exporting = page.getByRole("dialog", { name: "Export model", exact: true })
  await expect(exporting).toBeVisible()
  await expect(exporting.getByRole("combobox", { name: "Export scope", exact: true })).toHaveText(
    "Box 1",
  )
  await expect(
    exporting
      .getByRole("combobox", { name: "File format", exact: true })
      .locator("option[value=step]"),
  ).toHaveCount(0)
  await exporting.getByRole("button", { name: "Close", exact: true }).click()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Find in Timeline", exact: true }).click()
  await expect(
    page.locator("[data-feature-timeline]").getByRole("treeitem", { name: "Box 1", exact: true }),
  ).toBeFocused()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Press Pull", exact: true }).click()
  const pull = page.getByRole("form", { name: "Press Pull", exact: true })
  await pull.getByRole("combobox", { name: "Distance", exact: true }).fill("5 mm")
  await pull.getByRole("button", { name: "Apply Press Pull", exact: true }).click()
  await expect(pull).not.toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Press Pull 1", exact: true })).toBeVisible()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Properties", exact: true }).click()
  await expect(
    properties
      .locator("dt", { hasText: /^Volume$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("10,000 mm³")
  await page.locator("html").evaluate((element) => element.classList.remove("dark"))
  await page.screenshot({ path: "artifacts/context-menu/properties-light.png" })
})

test("Select Other chooses overlapping bodies, and selection actions retain dependency-aware deletion and clearing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await createBox(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(form).not.toBeVisible()
  let menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Select Other…", exact: true }).hover()
  const other = page.getByRole("menuitem", { name: /^Box 1 · Face / }).first()
  await expect(other).toBeVisible()
  await other.click()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await viewport.getByRole("button", { name: "Properties", exact: true }).click()
  const properties = page.getByRole("dialog", { name: "Properties", exact: true })
  await expect(
    properties
      .locator("dt", { hasText: /^Name$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("Box 1")
  await properties.getByRole("button", { name: "Close", exact: true }).click()
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click()
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole("button", { name: "Keep selection", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  menu = await openContext(page)
  await menu.getByRole("menuitem", { name: "Clear Selection", exact: true }).click()
  await expect(viewport.getByRole("button", { name: "Properties", exact: true })).toBeDisabled()
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("Expected the model canvas for camera navigation.")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40, {
    steps: 6,
  })
  await page.mouse.up({ button: "right" })
  await expect(page.getByRole("menu", { name: "Selection actions", exact: true })).not.toBeVisible()
})
