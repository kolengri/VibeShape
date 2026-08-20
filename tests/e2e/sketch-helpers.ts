import type { Locator, Page } from "@playwright/test"
import { expect } from "./fixtures"

export async function drawRectangle(page: Page) {
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  await page.mouse.click(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.62)
  await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.38)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  return drawing
}

export async function selectSketchTool(page: Page, family: string, tool: string | RegExp) {
  await page.getByRole("button", { name: family, exact: true }).click()
  await page.getByRole("menuitemradio", { name: tool, exact: typeof tool === "string" }).click()
}

export async function confirmSketchPlane(page: Page, plane: "xy" | "xz" | "yz" = "xy") {
  await page.getByRole("combobox", { name: "Support plane" }).selectOption(plane)
  await page.getByRole("button", { name: "Start sketch" }).click()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
}

export async function selectOriginPlaneInViewport(page: Page, plane: "xy" | "xz" | "yz") {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-origin-plane-selection", /xy|xz|yz/)
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The 3D viewport canvas is not visible.")

  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      const x = bounds.x + (bounds.width * column) / 12
      const y = bounds.y + (bounds.height * row) / 12
      await page.mouse.move(x, y)
      await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
      if ((await viewport.getAttribute("data-origin-plane-preselection")) === plane) {
        await page.mouse.click(x, y)
        await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
        return
      }
    }
  }
  throw new Error(`The ${plane.toUpperCase()} origin plane was not pickable in the 3D viewport.`)
}

export async function selectSketchEntities(
  page: Page,
  drawing: Locator,
  type: "point" | "line" | "circle" | "arc" | "ellipse" | "elliptical-arc",
  indices: readonly number[],
) {
  await page.getByRole("button", { name: "Select", exact: true }).click()
  const entities = drawing.locator(`[data-sketch-entity-type="${type}"]`)
  for (const [selectionIndex, entityIndex] of indices.entries()) {
    const entity = entities.nth(entityIndex)
    await entity.dispatchEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0,
      ctrlKey: selectionIndex > 0,
      pointerId: selectionIndex + 1,
    })
    await entity.dispatchEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      pointerId: selectionIndex + 1,
    })
  }
}

export async function addDimension(
  page: Page,
  type:
    | "Distance"
    | "Horizontal distance"
    | "Vertical distance"
    | "Angle"
    | "Radius"
    | "Diameter"
    | "Primary axis diameter"
    | "Secondary axis diameter",
  expression: string,
) {
  await page.getByRole("combobox", { name: "Dimension type" }).selectOption({ label: type })
  const input = page.getByRole("combobox", { name: "Driving expression" })
  await input.fill(expression)
  await page.getByRole("button", { name: "Add constraint" }).click()
}
