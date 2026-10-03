import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, selectSketchTool } from "./sketch-helpers"

function extrudeCommand(page: Page) {
  return page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Extrude", exact: true })
}

async function createRectangleAndCircleExtrusion(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page, "xy")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  await page.mouse.click(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.62)
  await page.mouse.click(bounds.x + bounds.width * 0.82, bounds.y + bounds.height * 0.38)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Center-point circle", exact: true }).click()
  await page.mouse.click(bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.5)
  await page.mouse.click(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.5)
  await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)
  await extrudeCommand(page).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await expect(form.getByRole("button", { name: /^Remove Sketch 1 · Profile [12]$/ })).toHaveCount(
    2,
  )
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-preview-status",
    "ready",
    { timeout: 30_000 },
  )
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
}

test("reuses a hidden consumed sketch profile for an independent extrusion", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await createRectangleAndCircleExtrusion(page)
  await page.getByRole("button", { name: "Show Sketch 1", exact: true }).click()
  await page.getByRole("button", { name: "Hide Sketch 1", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await extrudeCommand(page).click()
  await page.screenshot({ path: testInfo.outputPath("profile-picker.png") })
  const picker = page.getByRole("combobox", { name: "Select saved profile", exact: true })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole("option", { name: /^Sketch 1 · Profile [12]$/ })).toHaveCount(2)
  await picker.selectOption({ label: "Sketch 1 · Profile 2" })
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await expect(form.getByRole("button", { name: "Remove Sketch 1 · Profile 2" })).toBeVisible()
  await form.getByRole("combobox", { name: "Distance", exact: true }).fill("17 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("treeitem", { name: "Extrusion 2", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Show Sketch 1", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await page.getByRole("treeitem", { name: "Extrusion 1", exact: true }).click()
  await expect(
    page.getByRole("form", { name: "Edit extrusion" }).getByRole("combobox", { name: "Distance" }),
  ).toHaveValue("10 mm")
  await page
    .getByRole("form", { name: "Edit extrusion" })
    .getByRole("button", { name: "Cancel" })
    .click()
  await page.getByRole("treeitem", { name: "Extrusion 2", exact: true }).click()
  await expect(
    page.getByRole("form", { name: "Edit extrusion" }).getByRole("combobox", { name: "Distance" }),
  ).toHaveValue("17 mm")
})

test("explains a selected model face and creates a sketch on its planar support", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await createRectangleAndCircleExtrusion(page)
  await page.getByRole("button", { name: "Show Sketch 1", exact: true }).click()
  await page.getByRole("button", { name: "Hide Sketch 1", exact: true }).click()
  await extrudeCommand(page).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
  const status = page.locator("footer[role='status']")
  for (let row = 2; row < 10; row += 1) {
    for (let column = 1; column < 6; column += 1) {
      await page.mouse.click(
        bounds.x + (bounds.width * column) / 12,
        bounds.y + (bounds.height * row) / 12,
      )
      if ((await status.textContent())?.includes("Selection: Extrusion 1 · Face")) break
    }
    if ((await status.textContent())?.includes("Selection: Extrusion 1 · Face")) break
  }
  await expect(status).toContainText(/Selection: Extrusion 1 · Face \d+/)
  await page.screenshot({ path: testInfo.outputPath("selected-face.png") })
  const task = page.getByRole("complementary", { name: "Task panel", exact: true })
  await expect(
    task.getByText(
      "A planar model face is selected. Choose a saved sketch profile, or create a sketch on this face.",
    ),
  ).toBeVisible()
  await task.getByRole("button", { name: "Create sketch on selected face", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Support plane", exact: true })).toHaveValue(
    "feature-face",
  )
  await expect(viewport).toHaveAttribute("data-sketch-context-mode", "orbit")
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
})
