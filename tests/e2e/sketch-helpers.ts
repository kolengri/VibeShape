import type { Locator, Page } from "@playwright/test"
import { expect } from "./fixtures"

export async function drawRectangle(page: Page) {
  await page.getByRole("button", { name: "Rectangle", exact: true }).click()
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  await page.mouse.click(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.62)
  await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.38)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  return drawing
}

export async function selectSketchEntities(
  page: Page,
  drawing: Locator,
  type: "point" | "line" | "circle" | "arc",
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
  type: "Distance" | "Horizontal distance" | "Vertical distance" | "Angle" | "Radius" | "Diameter",
  expression: string,
) {
  await page.getByRole("combobox", { name: "Dimension type" }).selectOption({ label: type })
  const input = page.getByRole("textbox", { name: "Driving expression" })
  await input.fill(expression)
  await page.getByRole("button", { name: "Add constraint" }).click()
}
