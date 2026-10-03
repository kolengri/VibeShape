import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane } from "./sketch-helpers"

async function screenPoint(drawing: Locator, x: number, y: number) {
  return drawing.locator("[data-sketch-plane-projection]").evaluate(
    (element, point) => {
      const projection = element as unknown as {
        getScreenCTM?: () => {
          a: number
          b: number
          c: number
          d: number
          e: number
          f: number
        } | null
      }
      if (typeof projection.getScreenCTM !== "function")
        throw new Error("The sketch requires an SVG projection.")
      const matrix = projection.getScreenCTM()
      if (!matrix) throw new Error("The sketch projection must be available.")
      return {
        x: matrix.a * point.x - matrix.c * point.y + matrix.e,
        y: matrix.b * point.x - matrix.d * point.y + matrix.f,
      }
    },
    { x, y },
  )
}
async function clickPoint(page: Page, drawing: Locator, x: number, y: number) {
  const point = await screenPoint(drawing, x, y)
  await page.mouse.click(point.x, point.y)
}
async function moveToPoint(page: Page, drawing: Locator, x: number, y: number) {
  const point = await screenPoint(drawing, x, y)
  await page.mouse.move(point.x, point.y)
}
async function pointIds(drawing: Locator) {
  return drawing
    .locator('[data-sketch-entity-type="point"]')
    .evaluateAll((points) =>
      points.map((point) => point.getAttribute("data-sketch-entity-id")).sort(),
    )
}

test("creates a four-click cubic Spline, cancels previews, drags a control and retains identities through Undo and reopening", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page)
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await toolbar.getByRole("button", { name: "Spline", exact: true }).click()
  await clickPoint(page, drawing, 0, 0)
  await clickPoint(page, drawing, 0, 10)
  await moveToPoint(page, drawing, 20, 10)
  await expect(drawing.locator("[data-sketch-spline-control-polygon]")).toBeVisible()
  await expect(drawing.locator("[data-sketch-spline-preview-curve]")).toBeVisible()
  await expect(drawing.locator('[data-sketch-entity-type="cubic-bezier"]')).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(drawing.locator("[data-sketch-spline-control-polygon]")).toHaveCount(0)
  await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(0)

  await clickPoint(page, drawing, 0, 0)
  await clickPoint(page, drawing, 0, 10)
  await clickPoint(page, drawing, 20, 10)
  await clickPoint(page, drawing, 20, 0)
  const cubic = drawing.locator('[data-sketch-entity-type="cubic-bezier"]')
  await expect(cubic).toHaveCount(1)
  await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(4)
  const capturedCurveId = await cubic.getAttribute("data-sketch-entity-id")
  const capturedPointIds = await pointIds(drawing)
  const initialPath = await cubic.getAttribute("d")
  expect(initialPath).toContain(" C ")
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(cubic).toHaveCount(0)
  await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(0)
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(cubic).toHaveAttribute("data-sketch-entity-id", capturedCurveId ?? "")
  expect(await pointIds(drawing)).toEqual(capturedPointIds)

  await toolbar.getByRole("button", { name: "Line", exact: true }).click()
  await clickPoint(page, drawing, 20, 0)
  await clickPoint(page, drawing, 0, 0)
  await toolbar.getByRole("button", { name: "Select", exact: true }).click()
  await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(4)
  const firstControlId = await drawing
    .locator('[data-sketch-entity-type="point"]')
    .evaluateAll((points) => {
      const control = points.find(
        (point) =>
          Math.abs(Number(point.getAttribute("cx"))) < 0.001 &&
          Math.abs(Number(point.getAttribute("cy")) - 10) < 0.001,
      )
      return control?.getAttribute("data-sketch-entity-id") ?? null
    })
  if (!firstControlId) throw new Error("The authored first control point must remain selectable.")
  const firstControl = drawing.locator(
    `[data-sketch-entity-id="${firstControlId}"][data-sketch-entity-type="point"]`,
  )
  const from = await screenPoint(drawing, 0, 10)
  const to = await screenPoint(drawing, 0, 15)
  await page.keyboard.down("Shift")
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect.poll(async () => Number(await firstControl.getAttribute("cy"))).toBeCloseTo(15, 3)
  await expect(cubic).not.toHaveAttribute("d", initialPath ?? "")
  const editedPath = await cubic.getAttribute("d")
  expect(await pointIds(drawing)).toEqual(capturedPointIds)
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(cubic).toHaveAttribute("d", initialPath ?? "")
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(cubic).toHaveAttribute("d", editedPath ?? "")

  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(drawing).not.toBeVisible()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expect(drawing).toBeVisible()
  await expect(cubic).toHaveAttribute("data-sketch-entity-id", capturedCurveId ?? "")
  await expect(cubic).toHaveAttribute("d", editedPath ?? "")
  expect(await pointIds(drawing)).toEqual(capturedPointIds)
})
