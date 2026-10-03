import { expect, test } from "./fixtures"
import { confirmSketchPlane } from "./sketch-helpers"

test("snaps a circle to the origin and keeps its constrained center selectable", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page)
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The sketch drawing must be visible.")
  const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.getByRole("button", { name: "Center-point circle", exact: true }).click()
  await page.mouse.move(origin.x + 2, origin.y + 2)
  await expect(drawing.locator('[data-sketch-inference="coincident"]')).toBeVisible()
  await page.mouse.click(origin.x + 2, origin.y + 2)
  await page.mouse.click(origin.x + 70, origin.y)
  const center = drawing.locator('[data-sketch-entity-type="point"]')
  await expect(center).toHaveCount(1)
  await expect(center).toHaveAttribute("cx", "0")
  await expect(center).toHaveAttribute("cy", "0")
  await expect(
    page.getByRole("button", { name: "Select constraint Fixed", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Select", exact: true }).click()
  // A real pointer pick must reach the center, not the nearby constraint annotation.
  await center.click()
  await expect(drawing.locator('[data-sketch-point-role="center"]')).toHaveClass(/stroke-ring/)
  const centerBounds = await center.boundingBox()
  if (!centerBounds) throw new Error("The circle center must remain visible.")
  await page.mouse.move(
    centerBounds.x + centerBounds.width / 2,
    centerBounds.y + centerBounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(origin.x + 40, origin.y + 30)
  await page.mouse.up()
  await expect(center).toHaveAttribute("cx", "0")
  await expect(center).toHaveAttribute("cy", "0")
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expect(center).toHaveAttribute("cx", "0")
  await expect(center).toHaveAttribute("cy", "0")
  await expect(
    page.getByRole("button", { name: "Select constraint Fixed", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Select", exact: true }).click()
  await center.click()
  await expect(drawing.locator('[data-sketch-point-role="center"]')).toHaveClass(/stroke-ring/)
})
