import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

type ScreenMatrix = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>

async function screenMatrix(drawing: Locator) {
  return drawing.locator("[data-sketch-plane-projection]").evaluate((element) => {
    const geometry = element as unknown as { getScreenCTM?: () => ScreenMatrix | null }
    const matrix = geometry.getScreenCTM?.()
    if (!matrix) throw new Error("Missing sketch camera projection.")
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
  })
}

async function expectView(drawing: Locator, expected: readonly number[]) {
  await expect
    .poll(async () => {
      const actual = await screenMatrix(drawing)
      return Math.max(...actual.map((value, index) => Math.abs(value - (expected[index] ?? 0))))
    })
    .toBeLessThan(0.001)
}

async function standardView(page: Page, name: string) {
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

async function createSketch(page: Page) {
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await page
    .getByRole("complementary", { name: "Sketch task panel" })
    .getByRole("button", { name: "XY plane", exact: true })
    .click()
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await expect(drawing).toHaveAttribute("data-sketch-spatial", "true")
  await expect(drawing).toHaveAttribute("data-sketch-plane-available", "true")
  return drawing
}

async function drawLine(page: Page, drawing: Locator) {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = await screenMatrix(drawing)
  await page.getByRole("button", { name: "Line", exact: true }).click()
  await page.keyboard.down("Shift")
  for (const [x, y] of [
    [-10, -5],
    [10, 5],
  ]) {
    await page.mouse.click(a * (x ?? 0) - c * (y ?? 0) + e, b * (x ?? 0) - d * (y ?? 0) + f)
  }
  await page.keyboard.up("Shift")
  await page.keyboard.press("Escape")
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
}

test("preserves the current isometric camera through sketch creation, History, undo, redo, and cancel", async ({
  page,
}) => {
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  const drawing = await createSketch(page)
  await standardView(page, "Isometric")
  const initial = await screenMatrix(drawing)
  expect(Math.abs(initial[1] ?? 0)).toBeGreaterThan(0.1)
  expect(Math.abs(initial[2] ?? 0)).toBeGreaterThan(0.1)
  await drawLine(page, drawing)
  await expectView(drawing, initial)
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("Missing sketch drawing bounds.")
  const x = bounds.x + bounds.width * 0.5
  const y = bounds.y + bounds.height * 0.5
  await page.mouse.move(x, y)
  await page.mouse.wheel(0, -250)
  await expect
    .poll(async () => Math.abs((await screenMatrix(drawing))[0] ?? 0))
    .toBeGreaterThan(Math.abs(initial[0] ?? 0) * 1.1)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(x + 40, y + 30, { steps: 5 })
  await page.mouse.up({ button: "right" })
  const current = await screenMatrix(drawing)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(drawing).not.toBeVisible()

  await createSketch(page)
  await expectView(drawing, current)
  await drawLine(page, drawing)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(drawing).not.toBeVisible()
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Sketch 2", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Sketch 2", exact: true })).toBeVisible()

  for (const name of ["Sketch 1", "Sketch 2", "Sketch 1"]) {
    await page.getByRole("treeitem", { name, exact: true }).click()
    await expect(drawing).toHaveAttribute("data-sketch-spatial", "true")
    await expectView(drawing, current)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await expect(drawing).not.toBeVisible()
  }
  await createSketch(page)
  await expectView(drawing, current)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expectView(drawing, current)

  await standardView(page, "Top")
  const top = await screenMatrix(drawing)
  expect(top[1]).toBeCloseTo(0, 5)
  expect(top[2]).toBeCloseTo(0, 5)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await page.getByRole("treeitem", { name: "Sketch 2", exact: true }).click()
  await expectView(drawing, top)
})

test("keeps an explicitly chosen normal camera on the next sketch without realigning its support", async ({
  page,
}) => {
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  const drawing = await createSketch(page)
  await drawLine(page, drawing)
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await expect(drawing).not.toHaveAttribute("data-sketch-spatial", "true")
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await page
    .getByRole("complementary", { name: "Sketch task panel" })
    .getByRole("button", { name: "XZ plane", exact: true })
    .click()
  await expect(drawing).toHaveAttribute("data-sketch-spatial", "true")
  await expect(drawing).toHaveAttribute("data-sketch-plane-available", "false")
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await expect(drawing).not.toHaveAttribute("data-sketch-spatial", "true")
  await drawLine(page, drawing)
})
