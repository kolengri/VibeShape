import type { Locator, Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
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
      // Integer CSS pixels make pointer quantization identical across browser engines.
      const x = Math.round(matrix.a * point.x - matrix.c * point.y + matrix.e)
      const y = Math.round(matrix.b * point.x - matrix.d * point.y + matrix.f)
      const determinant = matrix.a * matrix.d - matrix.b * matrix.c
      return {
        x,
        y,
        sketchY: (matrix.b * (x - matrix.e) - matrix.a * (y - matrix.f)) / determinant,
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

async function expectControlHandles(drawing: Locator, curveId: string) {
  const handles = drawing.locator(`[data-sketch-bezier-handles="${curveId}"] line`)
  await expect(handles).toHaveCount(2)
  await expect
    .poll(() =>
      handles.evaluateAll((lines) =>
        lines.every((line) => {
          const svg = line.closest("svg")
          return [
            ["anchor", "1"],
            ["control", "2"],
          ].every(([role, suffix]) => {
            const id = line.getAttribute(`data-sketch-handle-${role}-id`)
            const point = svg?.querySelector(`circle[data-sketch-entity-id="${id}"]`)
            return (
              point !== null &&
              point !== undefined &&
              Number(line.getAttribute(`x${suffix}`)) === Number(point.getAttribute("cx")) &&
              Number(line.getAttribute(`y${suffix}`)) === Number(point.getAttribute("cy"))
            )
          })
        }),
      ),
    )
    .toBe(true)
  await expect(handles.first()).toHaveAttribute("stroke-dasharray", "4 3")
  await expect(handles.first()).toHaveAttribute("vector-effect", "non-scaling-stroke")
}

async function captureControlThemes(page: Page, drawing: Locator, browserName: string) {
  if (browserName !== "chromium") return
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  for (const theme of ["Dark", "Light"]) {
    await openApplicationMenuItem(page, "Settings…")
    const settings = page.getByRole("dialog", { name: "Settings", exact: true })
    await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
    await page.getByRole("option", { name: theme, exact: true }).click()
    await settings.getByRole("button", { name: "Done", exact: true }).click()
    await expect(drawing.locator('[data-sketch-point-role="bezier-control"]')).toHaveCount(2)
    await expect(drawing.locator("[data-sketch-bezier-handles] line")).toHaveCount(2)
    await page.screenshot({
      path: test.info().outputPath(`bezier-handles-${theme.toLowerCase()}.png`),
    })
  }
}

async function inspectControlNavigation(page: Page, drawing: Locator, curveId: string) {
  const rotate = page.getByRole("button", { name: "Rotate view", exact: true })
  await rotate.click()
  await expect(rotate).toHaveAttribute("aria-pressed", "true")
  await expect(drawing).not.toBeVisible()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "1")
  await page.screenshot({ path: test.info().outputPath("bezier-navigation-planar.png") })
  const canvas = await viewport.locator("canvas").boundingBox()
  if (!canvas) throw new Error("The navigation canvas must be visible.")
  const start = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 80, start.y + 50, { steps: 8 })
  await page.mouse.up()
  await page.screenshot({ path: test.info().outputPath("bezier-navigation-oblique.png") })
  await rotate.click()
  await expect(rotate).toHaveAttribute("aria-pressed", "false")
  await expect(drawing).toBeVisible()
  await expectControlHandles(drawing, curveId)
}

test("creates a four-click cubic Spline, cancels previews, drags a control and retains identities through Undo and reopening", async ({
  page,
  browserName,
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
  if (!capturedCurveId) throw new Error("The authored curve must have a stable identity.")
  const capturedPointIds = await pointIds(drawing)
  const initialPath = await cubic.getAttribute("d")
  expect(initialPath).toContain(" C ")
  await expect(drawing.locator('[data-sketch-point-role="bezier-control"]')).toHaveCount(2)
  await expect(drawing.locator('[data-sketch-point-role="vertex"]')).toHaveCount(2)
  await expect(
    drawing.locator('[data-sketch-point-role="bezier-control"]').first(),
  ).toHaveAttribute("rx", "0")
  await expect(
    drawing.locator('[data-sketch-point-role="bezier-control"]').first(),
  ).toHaveAttribute("transform", /^rotate\(45 /)
  await expectControlHandles(drawing, capturedCurveId)
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(cubic).toHaveCount(0)
  await expect(drawing.locator("[data-sketch-bezier-handles]")).toHaveCount(0)
  await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(0)
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(cubic).toHaveAttribute("data-sketch-entity-id", capturedCurveId)
  expect(await pointIds(drawing)).toEqual(capturedPointIds)

  await toolbar.getByRole("button", { name: "Line", exact: true }).click()
  await clickPoint(page, drawing, 20, 0)
  await clickPoint(page, drawing, 0, 0)
  await toolbar.getByRole("button", { name: "Select", exact: true }).click()
  await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(4)
  const firstControlId = await drawing
    .locator('[data-sketch-point-role="bezier-control"]')
    .first()
    .getAttribute("data-sketch-point-id")
  if (!firstControlId) throw new Error("The authored first control point must remain selectable.")
  const firstControl = drawing.locator(
    `[data-sketch-entity-id="${firstControlId}"][data-sketch-entity-type="point"]`,
  )
  const fromBox = await firstControl.boundingBox()
  if (!fromBox) throw new Error("The control point hit area must be visible.")
  const from = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 }
  const to = await screenPoint(drawing, 0, 15)
  await page.keyboard.down("Shift")
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await expectControlHandles(drawing, capturedCurveId)
  await expect(
    drawing.locator('[data-sketch-drag-overlay] [data-sketch-point-role="bezier-control"]'),
  ).toHaveAttribute("data-sketch-point-id", firstControlId)
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect
    .poll(async () => Number(await firstControl.getAttribute("cy")))
    .toBeCloseTo(to.sketchY, 3)
  await expect(cubic).not.toHaveAttribute("d", initialPath ?? "")
  const editedPath = await cubic.getAttribute("d")
  expect(await pointIds(drawing)).toEqual(capturedPointIds)
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(cubic).toHaveAttribute("d", initialPath ?? "")
  await expectControlHandles(drawing, capturedCurveId)
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(cubic).toHaveAttribute("d", editedPath ?? "")
  await expectControlHandles(drawing, capturedCurveId)

  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(drawing).not.toBeVisible()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
    "data-rendered-sketch-count",
    "1",
  )
  await page.screenshot({ path: test.info().outputPath("bezier-saved-preview.png") })
  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expect(drawing).toBeVisible()
  await expect(cubic).toHaveAttribute("data-sketch-entity-id", capturedCurveId)
  await expect(cubic).toHaveAttribute("d", editedPath ?? "")
  await expectControlHandles(drawing, capturedCurveId)
  expect(await pointIds(drawing)).toEqual(capturedPointIds)
  await captureControlThemes(page, drawing, browserName)
  await inspectControlNavigation(page, drawing, capturedCurveId)
  expect(await pointIds(drawing)).toEqual(capturedPointIds)
})
