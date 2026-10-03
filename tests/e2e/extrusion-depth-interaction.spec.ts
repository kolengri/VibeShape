import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle, fitIsometricView } from "./sketch-helpers"

async function setIsometricView(page: Page) {
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Isometric", exact: true }).click()
}

async function closeHeldExtrusionTool(page: Page, canvas: Locator) {
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await form.getByRole("button", { name: "Cancel", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(form).toHaveCount(0)
  await expect(canvas).not.toHaveAttribute("data-translation-gizmo-dragging")
  await expect
    .poll(() =>
      canvas.evaluate((element) =>
        element.hasPointerCapture(Number(element.dataset.testDepthPointerId)),
      ),
    )
    .toBe(false)
  await page.mouse.up()
  await expect(form).toHaveCount(0)
}

async function cancelHeldDepthArrow(page: Page, canvas: Locator, cancel?: "escape" | "capture") {
  if (cancel === "escape") await page.keyboard.press("Escape")
  if (cancel === "capture") {
    await canvas.evaluate((element) => {
      if (!element.hasPointerCapture(Number(element.dataset.testDepthPointerId)))
        throw new Error("The depth arrow did not capture its pointer.")
      element.releasePointerCapture(Number(element.dataset.testDepthPointerId))
    })
  }
}

async function dragDepthArrow(
  page: Page,
  distance: Locator,
  side: "first" | "second",
  cancel?: "escape" | "capture" | "tool",
) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The depth-arrow canvas has no measurable bounds.")
  const original = await distance.inputValue()
  const offsets =
    side === "first"
      ? [175, 155, 195, 215, 235, 255, 275, 295, 315, 335, 355]
      : [130, 110, 150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350]
  const direction = side === "first" ? -1 : 1
  for (const offset of offsets) {
    await setIsometricView(page)
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2 + direction * offset
    await page.mouse.move(x, y)
    await canvas.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        (event: { pointerId: number }) => {
          element.dataset.testDepthPointerId = String(event.pointerId)
        },
        { once: true },
      )
    })
    await page.mouse.down()
    await page.mouse.move(x, y + direction * 50, { steps: 10 })
    const moved = await expect
      .poll(() => distance.inputValue(), { timeout: 750 })
      .not.toBe(original)
      .then(
        () => true,
        () => false,
      )
    if (!moved) {
      await page.mouse.up()
      continue
    }
    await expect(canvas).toHaveAttribute("data-translation-gizmo-dragging", "true")
    if (cancel === "tool") {
      await closeHeldExtrusionTool(page, canvas)
      return
    }
    await cancelHeldDepthArrow(page, canvas, cancel)
    await page.mouse.up()
    await page.evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    )
    if (cancel) await expect(distance).toHaveValue(original)
    else await expect(distance).not.toHaveValue(original)
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
    return
  }
  throw new Error(`The ${side} depth arrow did not respond to pointer dragging.`)
}

test("explains view-aligned depth dragging while preserving exact distance editing", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Top", exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath("top-depth-view.png") })
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  const distance = form.getByRole("combobox", { name: "Distance", exact: true })
  await expect(distance).toHaveValue("10 mm")
  await expect(
    viewport.getByText("Drag the depth arrow from an angled view, or enter an exact distance.", {
      exact: true,
    }),
  ).toBeVisible()
  await distance.fill("23 mm")
  await expect(viewport).toHaveAttribute("data-axial-gizmo-distance", "23")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Isometric", exact: true }).click()
  await expect(
    viewport.getByText("Drag the depth arrow from an angled view, or enter an exact distance.", {
      exact: true,
    }),
  ).toBeHidden()
})

test("drags both extrusion endpoints independently and cancels zoomed depth gestures", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await fitIsometricView(page)
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  const first = form.getByRole("combobox", { name: "Distance", exact: true })
  await form.getByRole("checkbox", { name: "Second direction", exact: true }).check()
  const second = form.getByRole("combobox", { name: "Second distance", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(first).toHaveValue("10 mm")
  await expect(second).toHaveValue("5 mm")
  await dragDepthArrow(page, first, "first")
  const firstAfterDrag = await first.inputValue()
  await expect(second).toHaveValue("5 mm")
  await viewport.getByRole("button", { name: "Second depth", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-axial-gizmo-side", "second")
  await expect(viewport).toHaveAttribute("data-axial-gizmo-distance", "5")
  await dragDepthArrow(page, second, "second")
  await expect(first).toHaveValue(firstAfterDrag)
  const secondAfterDrag = await second.inputValue()
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, -150)
  await dragDepthArrow(page, second, "second", "escape")
  await expect(first).toHaveValue(firstAfterDrag)
  await expect(second).toHaveValue(secondAfterDrag)
  await dragDepthArrow(page, second, "second", "capture")
  await expect(first).toHaveValue(firstAfterDrag)
  await expect(second).toHaveValue(secondAfterDrag)
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await page.screenshot({ path: testInfo.outputPath("two-depth-arrows.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  const controls = viewport.getByRole("group", { name: "Extrusion depth to adjust", exact: true })
  await expect(controls).toBeVisible()
  await expect
    .poll(async () => {
      const view = await viewport.boundingBox()
      const widget = await controls.boundingBox()
      return Boolean(
        view && widget && widget.x >= view.x && widget.x + widget.width <= view.x + view.width,
      )
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath("compact-two-depth-controls.png") })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dragDepthArrow(page, second, "second", "tool")
  await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toHaveCount(0)
})
