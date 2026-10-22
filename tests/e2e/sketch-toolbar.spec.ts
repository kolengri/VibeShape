import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

async function clickUsableControl(page: Page, control: Locator) {
  await expect(control).toBeVisible()
  await control.scrollIntoViewIfNeeded()
  const point = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    // The interior square spans 24px; edge midpoints avoid the Button's rounded corners.
    const offsets = [4, 16, 28].flatMap((x) => [4, 16, 28].map((y) => ({ x, y })))
    offsets.push({ x: 16, y: 1 }, { x: 16, y: 31 }, { x: 1, y: 16 }, { x: 31, y: 16 })
    const receivesPointer = offsets.map(({ x, y }) =>
      element.contains(element.ownerDocument.elementFromPoint(bounds.x + x, bounds.y + y)),
    )
    return { x, y, width: bounds.width, height: bounds.height, receivesPointer }
  })
  expect(point.width).toBe(32)
  expect(point.height).toBe(32)
  expect(
    point.receivesPointer.slice(0, 9).every(Boolean),
    "The control must expose a usable 24px interior square.",
  ).toBe(true)
  expect(
    point.receivesPointer.slice(9).every(Boolean),
    "The control's straight edge midpoints must remain usable.",
  ).toBe(true)
  await page.mouse.move(point.x, point.y)
  await page.mouse.click(point.x, point.y)
}

async function expectAssistantBelowToolbar(page: Page, toolbar: Locator) {
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const assistant = page.getByRole("complementary", { name: "AI chat", exact: true })
  await expect(assistant).toBeVisible()
  const [barBounds, panelBounds, workspaceBounds] = await Promise.all([
    toolbar.boundingBox(),
    assistant.boundingBox(),
    page.getByTestId("workspace-center").boundingBox(),
  ])
  if (!barBounds || !panelBounds || !workspaceBounds) {
    throw new Error("The toolbar, assistant, and workspace must remain measurable.")
  }
  expect(panelBounds.y).toBeGreaterThanOrEqual(barBounds.y + barBounds.height)
  expect(panelBounds.y).toBe(workspaceBounds.y)
  expect(workspaceBounds.y).toBeGreaterThanOrEqual(barBounds.y + barBounds.height)
  await assistant.getByRole("button", { name: "Collapse AI chat", exact: true }).click()
  await expect(assistant).toHaveCount(0)
}

async function expectSeparateScrollbar(toolbar: Locator, control: Locator) {
  const [railBounds, buttonBounds, undoBounds] = await Promise.all([
    toolbar.locator(".overflow-x-auto").boundingBox(),
    control.boundingBox(),
    toolbar.getByRole("button", { name: "Undo", exact: true }).boundingBox(),
  ])
  if (!railBounds || !buttonBounds || !undoBounds) {
    throw new Error("The native scrollbar and control rows must remain measurable.")
  }
  expect(railBounds.y + railBounds.height - (buttonBounds.y + buttonBounds.height)).toBe(16)
  expect(undoBounds.y).toBe(buttonBounds.y)
}

async function scrollToolbarAtLowerEdge(page: Page, toolbar: Locator) {
  const rail = toolbar.locator(".overflow-x-auto")
  const initial = await rail.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.bottom - 1,
      scrollLeft: element.scrollLeft,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }
  })
  expect(initial.scrollWidth).toBeGreaterThan(initial.width)
  // The native scrollbar occupies its own lower strip below the usable control row.
  await page.mouse.move(initial.x, initial.y)
  await page.mouse.wheel(160, 0)
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(initial.scrollLeft)
  return rail
}

for (const width of [800, 1280]) {
  test(`keeps sketch toolbar targets usable and scrolling reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
    if (width === 800) {
      await page.getByRole("button", { name: "Open task panel", exact: true }).click()
    }
    await confirmSketchPlane(page, "xy")
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const extrude = toolbar.getByRole("button", { name: "Extrude", exact: true })
    const unavailableReason = page.getByRole("dialog", { name: "Extrude", exact: true })
    const form = page.getByRole("form", { name: "Extrude profile", exact: true })

    await expect(extrude).toHaveAttribute("aria-disabled", "true")
    await clickUsableControl(page, extrude)
    await expect(unavailableReason).toBeVisible()
    await expect(form).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(unavailableReason).not.toBeVisible()
    await expect(drawing).toBeVisible()
    await expectSeparateScrollbar(toolbar, extrude)
    await expectAssistantBelowToolbar(page, toolbar)

    const rail = await scrollToolbarAtLowerEdge(page, toolbar)
    const orbit = toolbar.getByRole("button", { name: "Orbit 3D view", exact: true })
    await clickUsableControl(page, orbit)
    await expect(orbit).toHaveAttribute("aria-pressed", "true")
    const normal = toolbar.getByRole("button", { name: "Normal to sketch", exact: true })
    await clickUsableControl(page, normal)
    await expect(normal).toHaveAttribute("aria-pressed", "true")
    await expect(drawing).not.toHaveAttribute("data-sketch-spatial", "true")

    const manager = toolbar.getByRole("button", { name: "Open constraint manager", exact: true })
    await clickUsableControl(page, manager)
    await expect(page.getByRole("dialog", { name: /^Constraint manager/ })).toBeVisible()
    await expect(manager).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(drawing).toBeVisible()

    await normal.focus()
    await normal.press("Home")
    await expect(extrude).toBeFocused()
    await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(0)
    await extrude.press("Enter")
    await expect(unavailableReason).toBeVisible()
    await expect(form).toHaveCount(0)
    await page.keyboard.press("Escape")

    await drawRectangle(page)
    await expect(extrude).toBeEnabled()
    await expect(extrude).toHaveAttribute("data-loading", "false")
    await clickUsableControl(page, extrude)
    await expect(form).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-preview-status",
      "ready",
    )
    await expect(toolbar).toHaveAttribute("data-sketch-mode", "false")
    expect(await toolbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(36)
    await expectAssistantBelowToolbar(page, toolbar)
  })
}
