import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("keeps the Extrude preview visible above the compact parameter panel", async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await page.getByRole("button", { name: "Open task panel", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()

  const viewport = page.getByRole("region", { name: "3D viewport" })
  const form = page.getByRole("form", { name: "Extrude profile" })
  const canvas = viewport.locator("canvas")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  for (const height of [900, 600]) {
    await page.setViewportSize({ width: 800, height })
    await expect(async () => {
      const drawing = await canvas.boundingBox()
      const panel = await form.boundingBox()
      expect(drawing).not.toBeNull()
      expect(panel).not.toBeNull()
      if (!drawing || !panel) return
      expect(drawing.height).toBeGreaterThan(150)
      expect(drawing.y + drawing.height).toBeLessThanOrEqual(panel.y)
    }).toPass()
  }

  await form.getByRole("combobox", { name: "Distance", exact: true }).fill("25 mm")
  await expect(viewport).toHaveAttribute("data-axial-gizmo-distance", "25")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  await page.getByRole("button", { name: "Collapse task panel", exact: true }).click()
  await expect(form).not.toBeVisible()
  await page.getByRole("button", { name: "Open task panel", exact: true }).click()
  await expect(form.getByRole("combobox", { name: "Distance", exact: true })).toHaveValue("25 mm")
  const panelBounds = await page.getByRole("complementary", { name: "Task panel" }).boundingBox()
  const acceptBounds = await form
    .getByRole("button", { name: "Create extrusion", exact: true })
    .boundingBox()
  if (!panelBounds || !acceptBounds) throw new Error("The Extrude actions must remain measurable.")
  expect(acceptBounds.y).toBeGreaterThanOrEqual(panelBounds.y)
  expect(acceptBounds.y + acceptBounds.height).toBeLessThanOrEqual(
    panelBounds.y + panelBounds.height,
  )
  await page.screenshot({ path: test.info().outputPath("compact-extrude-preview.png") })
  await page.locator("html").evaluate((element) => element.classList.remove("dark"))
  await page.screenshot({ path: test.info().outputPath("compact-extrude-preview-light.png") })
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await page.reload()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", { timeout: 30_000 })
})
