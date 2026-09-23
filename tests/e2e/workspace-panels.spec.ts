import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane } from "./sketch-helpers"

test.setTimeout(60_000)

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
}

async function width(locator: Locator) {
  return locator.evaluate((element) => Math.round(element.getBoundingClientRect().width))
}

async function reopenWorkspace(page: Page) {
  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
}

test("resizes panels with pointer and keyboard, restores defaults, and retains preferences", async ({
  page,
}) => {
  await openWorkspace(page)
  const tree = page.locator("#workspace-tree")
  const task = page.locator("#workspace-task")
  const separator = page.getByRole("separator", { name: "Model tree width" })
  await expect.poll(() => width(tree)).toBe(240)
  const bounds = await separator.boundingBox()
  if (!bounds) throw new Error("The tree separator must be visible")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + 100, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => width(tree)).toBe(320)
  await reopenWorkspace(page)
  await expect.poll(() => width(tree)).toBe(320)
  await separator.press("ArrowRight")
  await expect.poll(() => width(tree)).toBeGreaterThan(320)
  await separator.dblclick()
  await expect.poll(() => width(tree)).toBe(240)

  const taskSeparator = page.getByRole("separator", { name: "Task panel width" })
  await taskSeparator.press("ArrowLeft")
  await expect.poll(() => width(task)).toBeGreaterThan(320)
  await taskSeparator.dblclick()
  await expect.poll(() => width(task)).toBe(320)
  await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Workspace layout settings" })
  await settings.getByRole("button", { name: "Hide Model tree", exact: true }).click()
  await settings.getByRole("button", { name: "Hide Task panel", exact: true }).click()
  await expect.poll(() => width(tree)).toBe(0)
  await expect.poll(() => width(task)).toBe(0)
  await page.keyboard.press("Escape")
  await reopenWorkspace(page)
  await expect.poll(() => width(tree)).toBe(0)
  await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
  await settings.getByRole("button", { name: "Reset layout", exact: true }).click()
  await expect.poll(() => width(tree)).toBe(240)
  await expect.poll(() => width(task)).toBe(320)
})

for (const theme of ["light", "dark"] as const) {
  test(`reveals the same viewport beneath transparent backgrounds in ${theme} theme`, async ({
    page,
  }) => {
    await openWorkspace(page)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await page
      .locator("html")
      .evaluate((element, theme) => element.classList.toggle("dark", theme === "dark"), theme)
    const canvas = page.locator(".workspace-viewport canvas").first()
    const originalCanvas = await canvas.elementHandle()
    await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "Workspace layout settings" })
    const opacity = settings.getByRole("slider", {
      name: "Model tree background opacity",
      exact: true,
    })
    await opacity.fill("35")
    await expect(page.locator(".cad-workspace-grid")).toHaveAttribute("data-transparent", "true")
    await page.keyboard.press("Escape")
    expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
      true,
    )
    await expect.poll(() => width(page.locator(".workspace-viewport"))).toBe(1440)
    await expect(canvas).toHaveAttribute("data-orientation-inset", "256,8,80")
    const panel = page.locator(".workspace-panel--tree")
    expect(
      await panel.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).opacity,
      ),
    ).toBe("1")
    expect(
      await panel.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor,
      ),
    ).toMatch(/0\.35/)
    const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
    expect(
      await tree.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)")
    await page.screenshot({ path: test.info().outputPath(`transparent-panels-${theme}.png`) })
    await reopenWorkspace(page)
    await expect(page.locator(".cad-workspace-grid")).toHaveAttribute("data-transparent", "true")
    await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
    await expect(opacity).toHaveValue("35")
    await page.keyboard.press("Escape")
    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
    await expect(page.locator(".cad-workspace-grid")).toHaveAttribute("data-transparent", "false")
    await expect.poll(() => width(page.locator(".workspace-viewport"))).toBe(864)
  })
}

test("keeps the task draft and canvas mounted across compact layout and collapse", async ({
  page,
}) => {
  await openWorkspace(page)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Box", exact: true })
    .click()
  const form = page.getByRole("form", { name: "Create box", exact: true })
  const input = form.getByRole("combobox", { name: "Width", exact: true })
  await input.fill("77")
  const formElement = await form.elementHandle()
  const canvas = page.locator(".workspace-viewport canvas").first()
  const canvasElement = await canvas.elementHandle()
  await page.setViewportSize({ width: 800, height: 720 })
  await expect(form).toBeVisible()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const preview = viewport.getByText("Unsaved extrusion preview", { exact: true })
  await expect(preview).toBeVisible()
  const previewBounds = await preview.boundingBox()
  const planesBounds = await viewport
    .getByRole("group", { name: "Origin plane visibility", exact: true })
    .boundingBox()
  if (!previewBounds || !planesBounds) throw new Error("Preview chrome must remain measurable")
  expect(previewBounds.y).toBeGreaterThan(planesBounds.y + planesBounds.height)
  await expect(input).toHaveValue("77")
  await expect.poll(() => width(page.locator("#workspace-task"))).toBe(0)
  expect(await form.evaluate((element, original) => element === original, formElement)).toBe(true)
  await page.setViewportSize({ width: 512, height: 384 })
  await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Workspace layout settings" })
  await expect(
    settings.getByRole("slider", { name: "Task panel width", exact: true }),
  ).toBeDisabled()
  await expect(
    settings.getByRole("slider", { name: "Model tree background opacity", exact: true }),
  ).toBeDisabled()
  const settingsBounds = await settings.boundingBox()
  if (!settingsBounds) throw new Error("The workspace settings must remain visible")
  expect(settingsBounds.x).toBeGreaterThanOrEqual(0)
  expect(settingsBounds.x + settingsBounds.width).toBeLessThanOrEqual(512)
  expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(384)
  await settings.getByRole("button", { name: "Reset layout", exact: true }).scrollIntoViewIfNeeded()
  await expect(settings.getByRole("button", { name: "Reset layout", exact: true })).toBeInViewport()
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 800, height: 720 })
  expect(await canvas.evaluate((element, original) => element === original, canvasElement)).toBe(
    true,
  )
  await page.screenshot({ path: test.info().outputPath("compact-task-draft.png") })
  await page.setViewportSize({ width: 1024, height: 720 })
  await expect(input).toHaveValue("77")
  await expect.poll(() => width(page.locator("#workspace-task"))).toBe(320)
  await expect
    .poll(() => page.locator("body").evaluate((element) => element.scrollWidth))
    .toBe(1024)
  await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
  await page.getByRole("button", { name: "Hide Task panel", exact: true }).click()
  await page.getByRole("button", { name: "Show Task panel", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(input).toHaveValue("77")
  expect(await form.evaluate((element, original) => element === original, formElement)).toBe(true)
})

test("keeps transparent panels above sketch gestures and viewport controls inside the clear region", async ({
  page,
}) => {
  await openWorkspace(page)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page)
  await page.getByRole("button", { name: "Workspace layout settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Workspace layout settings" })
  await settings
    .getByRole("slider", { name: "Model tree background opacity", exact: true })
    .fill("30")
  await settings
    .getByRole("slider", { name: "Task panel background opacity", exact: true })
    .fill("50")
  await page.keyboard.press("Escape")
  const sketch = page.getByRole("img", { name: "Editable sketch geometry" })
  const entityCount = await sketch.locator("[data-sketch-entity-type]").count()
  for (const selector of [".workspace-panel--tree", ".workspace-panel--task"]) {
    const panel = page.locator(selector)
    expect(
      await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const target = element.ownerDocument.elementFromPoint(bounds.x + 20, bounds.y + 70)
        return element.contains(target)
      }),
    ).toBe(true)
  }
  const planeToggle = page.getByRole("button", { name: "Hide YZ plane", exact: true }).last()
  const planeBounds = await planeToggle.boundingBox()
  expect(planeBounds?.x).toBeGreaterThan(248)
  expect((planeBounds?.x ?? 0) + (planeBounds?.width ?? 0)).toBeLessThan(1112)
  await planeToggle.click()
  await expect(
    page.getByRole("button", { name: "Show YZ plane", exact: true }).last(),
  ).toBeVisible()
  expect(await sketch.locator("[data-sketch-entity-type]").count()).toBe(entityCount)
  await page.screenshot({ path: test.info().outputPath("transparent-sketch-panels.png") })
})
