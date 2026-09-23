import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane } from "./sketch-helpers"

type ScreenMatrix = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>

async function sketchScreenPoint(drawing: Locator, x: number, y: number) {
  return drawing.locator("[data-sketch-plane-projection]").evaluate(
    (element, point) => {
      const geometry = element as unknown as { getScreenCTM?: () => ScreenMatrix | null }
      const matrix = geometry.getScreenCTM?.()
      if (!matrix) throw new Error("Missing screen projection.")
      return {
        x: matrix.a * point.x - matrix.c * point.y + matrix.e,
        y: matrix.b * point.x - matrix.d * point.y + matrix.f,
      }
    },
    { x, y },
  )
}

async function pickSketchPoint(page: Page, drawing: Locator, x: number, y: number) {
  const position = await sketchScreenPoint(drawing, x, y)
  await page.mouse.click(position.x, position.y)
}

async function standardView(page: Page, name: string) {
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

test("keeps projected geometry aligned through orbit, zoom, pan, point dragging, and context actions", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page)
  await page.getByRole("button", { name: "Line", exact: true }).click()
  await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
  await standardView(page, "Isometric")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await expect(drawing).toHaveAttribute("data-sketch-plane-available", "true")
  await page.keyboard.down("Shift")
  await pickSketchPoint(page, drawing, -10, -10)
  await pickSketchPoint(page, drawing, 10, 10)
  await page.keyboard.up("Shift")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Select", exact: true }).click()
  const initial = await sketchScreenPoint(drawing, 10, 10)
  await page.mouse.move(initial.x, initial.y)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(initial.x + 35, initial.y + 20, { steps: 5 })
  await page.mouse.up({ button: "middle" })
  await expect.poll(() => sketchScreenPoint(drawing, 10, 10)).not.toEqual(initial)
  await standardView(page, "Isometric")
  const beforeZoom = await sketchScreenPoint(drawing, 10, 10)
  const origin = await sketchScreenPoint(drawing, 0, 0)
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.wheel(0, -250)
  await expect
    .poll(async () => {
      const point = await sketchScreenPoint(drawing, 10, 10)
      const center = await sketchScreenPoint(drawing, 0, 0)
      return Math.hypot(point.x - center.x, point.y - center.y)
    })
    .toBeGreaterThan(Math.hypot(beforeZoom.x - origin.x, beforeZoom.y - origin.y) * 1.1)
  const beforePan = await sketchScreenPoint(drawing, 10, 10)
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(origin.x + 40, origin.y + 30, { steps: 5 })
  await page.mouse.up({ button: "right" })
  await expect(page.getByRole("menu", { name: "Sketch actions" })).not.toBeVisible()
  await expect
    .poll(async () => (await sketchScreenPoint(drawing, 10, 10)).x)
    .toBeCloseTo(beforePan.x + 40, 0)
  const start = await sketchScreenPoint(drawing, 10, 10)
  const end = await sketchScreenPoint(drawing, 15, 5)
  await page.keyboard.down("Shift")
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  const line = drawing.locator('[data-sketch-entity-type="line"]')
  await expect.poll(async () => Number(await line.getAttribute("x2"))).toBeCloseTo(15, 0)
  await expect.poll(async () => Number(await line.getAttribute("y2"))).toBeCloseTo(5, 0)
  const midpoint = await sketchScreenPoint(drawing, 2.5, -2.5)
  await page.mouse.click(midpoint.x, midpoint.y, { button: "right" })
  await expect(page.getByRole("menu", { name: "Sketch actions" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Add drawing dimension" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(line).toHaveCount(1)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expect(drawing).toBeVisible()
  await expect(line).toHaveCount(1)
  await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
  await standardView(page, "Isometric")
  const reopenedPosition = await sketchScreenPoint(drawing, 0, 0)
  await page.mouse.move(reopenedPosition.x, reopenedPosition.y)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(reopenedPosition.x + 30, reopenedPosition.y + 20, { steps: 4 })
  await page.mouse.up({ button: "middle" })
  await expect.poll(() => sketchScreenPoint(drawing, 0, 0)).not.toEqual(reopenedPosition)
})

for (const plane of ["xy", "xz", "yz"] as const) {
  test(`draws on the ${plane.toUpperCase()} sketch plane in isometric view without resetting the camera`, async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()
    await confirmSketchPlane(page, plane)
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
    await standardView(page, "Isometric")
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    await expect(drawing).toBeVisible()
    await expect(drawing).toHaveAttribute("data-sketch-spatial", "true")
    await expect(drawing).toHaveAttribute("data-sketch-plane-available", "true")
    const projection = drawing.locator("[data-sketch-plane-projection]")
    const cameraBefore = await projection.getAttribute("transform")
    const pointerTolerance = await projection.evaluate((element) => {
      const geometry = element as unknown as {
        getScreenCTM?: () => { inverse: () => ScreenMatrix } | null
      }
      const inverse = geometry.getScreenCTM?.()?.inverse()
      if (!inverse) throw new Error("Missing inverse screen projection.")
      // Native pointer coordinates may be quantized to a CSS pixel by the browser.
      return Math.max(
        Math.abs(inverse.a) + Math.abs(inverse.c),
        Math.abs(inverse.b) + Math.abs(inverse.d),
      )
    })
    await page.keyboard.down("Shift")
    await pickSketchPoint(page, drawing, -15, -10)
    await pickSketchPoint(page, drawing, 15, 10)
    await page.keyboard.up("Shift")
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
    await expect(projection).toHaveAttribute("transform", cameraBefore ?? "")
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    const line = drawing.locator('[data-sketch-entity-type="line"]')
    const coordinates = await line.evaluate((element) =>
      ["x1", "y1", "x2", "y2"].map((name) => Number(element.getAttribute(name))),
    )
    expect(coordinates).toHaveLength(4)
    for (const [index, expected] of [-15, -10, 15, 10].entries()) {
      expect(Math.abs((coordinates[index] ?? Number.NaN) - expected)).toBeLessThanOrEqual(
        pointerTolerance,
      )
    }
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
  })
}

test("blocks placement on an edge-on plane and recovers without losing the drawing tool", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page)
  await page.getByRole("button", { name: "Line", exact: true }).click()
  await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
  await standardView(page, "Front")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await expect(drawing).toHaveAttribute("data-sketch-plane-available", "false")
  await expect(
    page.getByText(
      "The sketch plane is edge-on. Rotate the view or choose Normal to sketch to draw.",
      { exact: true },
    ),
  ).toBeVisible()
  await drawing.click({ position: { x: 100, y: 250 } })
  await drawing.click({ position: { x: 200, y: 300 } })
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
  await standardView(page, "Isometric")
  await expect(drawing).toHaveAttribute("data-sketch-plane-available", "true")
  await pickSketchPoint(page, drawing, -10, -10)
  await pickSketchPoint(page, drawing, 10, 10)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
})
