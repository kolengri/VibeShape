import type { Locator, Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test.setTimeout(60_000)

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
}

async function width(locator: Locator) {
  return locator.evaluate((element) => Math.round(element.getBoundingClientRect().width))
}

async function openWorkspaceSettings(page: Page) {
  await openApplicationMenuItem(page, "Settings…")
  const settings = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Settings", exact: true }) })
  await settings.getByRole("tab", { name: "Workspace", exact: true }).click()
  return settings
}

async function reopenWorkspace(page: Page) {
  await page.reload()
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
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

  await invokeModelCommand(page, "Primitives", "Box")
  const taskSeparator = page.getByRole("separator", { name: "Task panel width" })
  await taskSeparator.press("ArrowLeft")
  await expect.poll(() => width(task)).toBeGreaterThan(320)
  await taskSeparator.dblclick()
  await expect.poll(() => width(task)).toBe(320)
  const settings = await openWorkspaceSettings(page)
  await settings.getByRole("button", { name: "Hide Model tree", exact: true }).click()
  await settings.getByRole("button", { name: "Hide Task panel", exact: true }).click()
  await expect.poll(() => width(tree)).toBe(0)
  await expect.poll(() => width(task)).toBe(0)
  await page.keyboard.press("Escape")
  await reopenWorkspace(page)
  await expect.poll(() => width(tree)).toBe(0)
  await invokeModelCommand(page, "Primitives", "Box")
  await openWorkspaceSettings(page)
  await settings.getByRole("button", { name: "Reset layout", exact: true }).click()
  await expect.poll(() => width(tree)).toBe(240)
  await expect.poll(() => width(task)).toBe(320)
})

test("resizes the model tree without a task panel and preserves the viewport across task transitions", async ({
  page,
}) => {
  await openWorkspace(page)
  const tree = page.locator("#workspace-tree")
  const canvas = page.locator(".workspace-viewport canvas").first()
  const originalCanvas = await canvas.elementHandle()
  const separator = page.getByRole("separator", { name: "Model tree width", exact: true })
  const resize = async (delta: number) => {
    const before = await width(tree)
    const bounds = await separator.boundingBox()
    if (!bounds) throw new Error("The model tree separator must be visible")
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + 100
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + delta, y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => width(tree)).toBe(before + delta)
  }
  await expect(page.getByRole("separator", { name: "Task panel width" })).toHaveCount(0)
  await resize(60)
  await invokeModelCommand(page, "Primitives", "Box")
  await expect.poll(() => width(tree)).toBe(300)
  await resize(40)
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await expect.poll(() => width(tree)).toBe(340)
  await resize(-40)
  expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
    true,
  )
  await reopenWorkspace(page)
  await expect.poll(() => width(tree)).toBe(300)
  await separator.press("ArrowRight")
  await expect.poll(() => width(tree)).toBeGreaterThan(300)
})

for (const theme of ["light", "dark"] as const) {
  test(`reveals the same viewport beneath transparent backgrounds in ${theme} theme`, async ({
    page,
  }) => {
    await openWorkspace(page)
    await invokeModelCommand(page, "Primitives", "Box")
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
    const settings = await openWorkspaceSettings(page)
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
    const historyHeight = await page
      .locator(".workspace-history")
      .evaluate((element) => element.clientHeight)
    await expect(canvas).toHaveAttribute("data-orientation-inset", `264,${historyHeight + 16},80`)
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
    await openWorkspaceSettings(page)
    await expect(opacity).toHaveValue("35")
    await page.keyboard.press("Escape")
    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
    await expect(page.locator(".cad-workspace-grid")).toHaveAttribute("data-transparent", "false")
    await expect.poll(() => width(page.locator(".workspace-viewport"))).toBe(1440)
  })
}

test("keeps the task draft and canvas mounted across compact layout and collapse", async ({
  page,
}) => {
  await openWorkspace(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  const input = form.getByRole("combobox", { name: "Width", exact: true })
  await input.fill("77")
  const formElement = await form.elementHandle()
  const canvas = page.locator(".workspace-viewport canvas").first()
  const canvasElement = await canvas.elementHandle()
  await page.setViewportSize({ width: 800, height: 720 })
  await expect(form).toBeVisible()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const preview = viewport.getByText("Unsaved feature preview", { exact: true })
  await expect(preview).toBeVisible()
  const previewBounds = await preview.boundingBox()
  const planesBounds = await viewport
    .getByRole("group", { name: "Origin plane visibility", exact: true })
    .boundingBox()
  if (!previewBounds || !planesBounds) throw new Error("Preview chrome must remain measurable")
  expect(previewBounds.y).toBeGreaterThan(planesBounds.y + planesBounds.height)
  await expect
    .poll(async () => {
      const canvasBounds = await canvas.boundingBox()
      const sheetBounds = await page.locator(".workspace-panel--task").boundingBox()
      const inset = (await canvas.getAttribute("data-orientation-inset"))?.split(",").map(Number)
      if (!canvasBounds || !sheetBounds || !inset) return false
      return canvasBounds.y + canvasBounds.height - (inset[1] ?? 0) <= sheetBounds.y
    })
    .toBe(true)
  await expect(input).toHaveValue("77")
  await expect(page.locator("#workspace-task")).toHaveAttribute("data-viewport-area", "bottom")
  expect(await form.evaluate((element, original) => element === original, formElement)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  const narrowTree = page.getByRole("complementary", { name: "Model tree", exact: true })
  await expect(narrowTree).toBeHidden()
  await expect.poll(() => width(page.locator(".workspace-viewport"))).toBe(390)
  await expect.poll(() => width(page.locator(".workspace-panel--task"))).toBe(374)
  await expect.poll(() => width(form)).toBeGreaterThan(350)
  await expect(input).toHaveValue("77")
  await page.getByRole("button", { name: "Show model tree", exact: true }).click()
  await expect(narrowTree).toBeVisible()
  await expect.poll(() => width(narrowTree)).toBeGreaterThanOrEqual(240)
  await page.getByRole("button", { name: "Hide model tree", exact: true }).click()
  await expect(narrowTree).toBeHidden()
  expect(await form.evaluate((element, original) => element === original, formElement)).toBe(true)
  expect(await canvas.evaluate((element, original) => element === original, canvasElement)).toBe(
    true,
  )
  await page.screenshot({ path: test.info().outputPath("compact-full-width-task-390.png") })
  await page.setViewportSize({ width: 512, height: 384 })
  await expect.poll(() => width(page.locator(".workspace-viewport"))).toBe(512)
  await expect
    .poll(async () => {
      const bounds = await canvas.boundingBox()
      const toolbar = await page.locator("nav[data-sketch-mode]").boundingBox()
      const sheet = await page.locator(".workspace-panel--task").boundingBox()
      const inset = (await canvas.getAttribute("data-orientation-inset"))?.split(",").map(Number)
      if (!bounds || !toolbar || !sheet || !inset) return false
      const bottom = bounds.y + bounds.height - (inset[1] ?? 0)
      return bottom - (inset[2] ?? 0) >= toolbar.y + toolbar.height && bottom <= sheet.y
    })
    .toBe(true)
  const settings = await openWorkspaceSettings(page)
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
  await expect.poll(() => width(page.locator("#workspace-tree"))).toBe(240)
  await expect
    .poll(() => page.locator("body").evaluate((element) => element.scrollWidth))
    .toBe(1024)
  await openWorkspaceSettings(page)
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
  const settings = await openWorkspaceSettings(page)
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

test("offers readable independent extrusion depths beside a temporary model tree on a phone", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openWorkspace(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await commands.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  const firstDepth = form.getByRole("combobox", { name: "Distance", exact: true })
  await firstDepth.fill("13 mm")
  await form.getByRole("checkbox", { name: "Second direction", exact: true }).check()
  const secondDepth = form.getByRole("combobox", { name: "Second distance", exact: true })
  await secondDepth.fill("7 mm")
  const originalForm = await form.elementHandle()
  const canvas = page.locator(".workspace-viewport canvas").first()
  const originalCanvas = await canvas.elementHandle()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => width(form)).toBeGreaterThan(350)
  await expect.poll(() => width(page.locator(".workspace-viewport"))).toBe(390)
  const treeDrawer = page.locator(".workspace-panel--tree")
  await expect(treeDrawer).toHaveAttribute("data-drawer-open", "false")
  await expect(treeDrawer).toHaveCSS("visibility", "hidden")
  await expect(treeDrawer).toHaveCSS("opacity", "0")
  await expect(firstDepth).toHaveValue("13 mm")
  await expect(secondDepth).toHaveValue("7 mm")
  await firstDepth.scrollIntoViewIfNeeded()
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("compact-extrusion-first-depth-390.png"),
  })
  await secondDepth.scrollIntoViewIfNeeded()
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("compact-extrusion-second-depth-390.png"),
  })
  await page.getByRole("button", { name: "Show model tree", exact: true }).click()
  await expect(treeDrawer).toHaveCSS("opacity", "1")
  await expect(page.getByRole("treeitem", { name: "Sketch 1", exact: true })).toBeVisible()
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("compact-model-tree-drawer-390.png"),
  })
  await page.getByRole("button", { name: "Hide model tree", exact: true }).click()
  await expect(treeDrawer).toHaveCSS("opacity", "0")
  await expect(firstDepth).toHaveValue("13 mm")
  await expect(secondDepth).toHaveValue("7 mm")
  expect(await form.evaluate((element, original) => element === original, originalForm)).toBe(true)
  expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
    true,
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(() => width(page.locator("#workspace-tree"))).toBe(240)
  await expect.poll(() => width(page.locator("#workspace-task"))).toBe(320)
})

for (const theme of ["light", "dark"] as const) {
  test(`keeps the idle model-tree toggle above bottom slots in ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    const toggle = page.getByRole("button", { name: "Show model tree", exact: true })
    const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
    const canvas = page.locator(".workspace-viewport canvas").first()
    const bounds = await canvas.boundingBox()
    const original = await canvas.elementHandle()
    for (const chatOpen of [false, true]) {
      if (chatOpen) await page.getByRole("button", { name: "AI chat", exact: true }).click()
      await toggle.click({ timeout: 3_000 })
      await expect(tree).toBeVisible()
      await page.getByRole("button", { name: "Hide model tree", exact: true }).click()
      await expect(tree).toBeHidden()
      await expect(toggle).toBeFocused()
      await expect.poll(() => canvas.boundingBox()).toEqual(bounds)
    }
    await toggle.press("Enter")
    const close = page.getByRole("button", { name: "Hide model tree", exact: true })
    await expect(close).toBeFocused()
    await close.press("Enter")
    await expect(tree).toBeHidden()
    await expect(toggle).toBeFocused()
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds)
    expect(await canvas.evaluate((node, original) => node === original, original)).toBe(true)
  })
}
