import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function layoutBounds(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error("The layout surface must have measurable bounds.")
  return bounds
}

async function setAdditionalRows(contents: readonly Locator[], expanded: boolean) {
  for (const content of contents) {
    await content.evaluate((element, grow) => {
      element.querySelector("[data-layout-growth]")?.remove()
      if (!grow) return
      const additionalFields = element.ownerDocument.createElement("div")
      additionalFields.dataset.layoutGrowth = "true"
      additionalFields.style.height = "1200px"
      additionalFields.textContent = "Additional parameter and inspection rows"
      element.append(additionalFields)
    }, expanded)
  }
}

async function scrollBodiesToEnd(contents: readonly Locator[]) {
  for (const content of contents) {
    expect(
      await content.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeGreaterThan(0)
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  }
}

async function expectViewportControlsAboveTask(page: Page, task: Locator) {
  await expect
    .poll(async () => {
      const canvas = page.locator(".workspace-viewport canvas").first()
      const viewport = await layoutBounds(canvas)
      const panel = await layoutBounds(task)
      const inset = (await canvas.getAttribute("data-orientation-inset"))?.split(",").map(Number)
      if (!inset || inset[1] === undefined) return false
      const clearBottom = viewport.y + viewport.height - inset[1]
      return clearBottom <= panel.y + 1 && panel.y - clearBottom <= 16
    })
    .toBe(true)
}

test("keeps task chrome reachable at a 200% equivalent viewport", async ({ page }) => {
  await page.setViewportSize({ width: 512, height: 384 })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const form = page.getByRole("form", { name: "Create cylinder", exact: true })
  const task = page.locator(".workspace-panel--task")
  const header = form.locator('[data-slot="task-panel-header"]')
  const footer = form.locator('[data-slot="task-panel-footer"]')
  const cancel = footer.getByRole("button", { name: "Cancel", exact: true })
  const accept = footer.getByRole("button", { name: "Create cylinder", exact: true })
  await expect(cancel).toBeInViewport()
  await expect(accept).toBeInViewport()
  const toolbarBounds = await page.locator("nav[data-sketch-mode]").boundingBox()
  const historyBounds = await page.locator(".workspace-history").boundingBox()
  const taskBounds = await task.boundingBox()
  const headerBounds = await header.boundingBox()
  const footerBounds = await footer.boundingBox()
  if (!toolbarBounds || !historyBounds || !taskBounds || !headerBounds || !footerBounds)
    throw new Error("Task chrome must have bounds.")
  expect(taskBounds.y).toBeGreaterThanOrEqual(toolbarBounds.y + toolbarBounds.height)
  expect(taskBounds.y + taskBounds.height).toBeLessThanOrEqual(historyBounds.y)
  expect(footerBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height)
  expect(footerBounds.y + footerBounds.height).toBeLessThanOrEqual(taskBounds.y + taskBounds.height)
  expect(await cancel.evaluate((element) => element.getBoundingClientRect().height)).toBe(32)
  expect(await accept.evaluate((element) => element.getBoundingClientRect().height)).toBe(32)
  expect(
    await form
      .locator('[data-slot="task-panel-content"]')
      .evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(0)
  await cancel.click()
  await expect(form).toHaveCount(0)
  await invokeModelCommand(page, "Create", "Create sketch")
  await page.getByRole("button", { name: "Open task panel", exact: true }).click()
  const sketchHeader = task.locator('[data-slot="task-panel-header"]')
  const sketchFooter = task.locator('[data-slot="task-panel-footer"]')
  const sketchHeaderBounds = await sketchHeader.boundingBox()
  const sketchFooterBounds = await sketchFooter.boundingBox()
  const sketchTaskBounds = await task.boundingBox()
  if (!sketchHeaderBounds || !sketchFooterBounds || !sketchTaskBounds)
    throw new Error("Sketch chrome must have bounds.")
  expect(sketchFooterBounds.y).toBeGreaterThanOrEqual(
    sketchHeaderBounds.y + sketchHeaderBounds.height,
  )
  expect(sketchFooterBounds.y + sketchFooterBounds.height).toBeLessThanOrEqual(
    sketchTaskBounds.y + sketchTaskBounds.height,
  )
  await sketchFooter.getByRole("button", { name: "Cancel", exact: true }).click()
})

for (const width of [1280, 960]) {
  test(`fits sidebar windows to content and caps growing bodies at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    await invokeModelCommand(page, "Create", "Create sketch")
    if (width < 1024)
      await page.getByRole("button", { name: "Open task panel", exact: true }).click()

    const workspace = page.locator(".cad-workspace-grid")
    const task = page.locator(".workspace-panel--task")
    const tree = page.locator(".workspace-panel--tree")
    const fields = task.locator('[data-slot="task-panel-content"]')
    const treeContent = tree.locator('[data-slot="model-tree-content"]')
    const footer = task.locator('[data-slot="task-panel-footer"]')
    await expect(footer.getByRole("button", { name: "Cancel", exact: true })).toBeVisible()

    const workspaceBounds = await layoutBounds(workspace)
    const shortTask = await layoutBounds(task)
    const shortTree = await layoutBounds(tree)
    const taskCap = width < 1024 ? 450 : workspaceBounds.height
    expect(shortTask.height).toBeLessThan(taskCap - 20)
    expect(shortTree.height).toBeLessThan(workspaceBounds.height - 20)
    expect(await fields.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0)

    // Exercise content growth without coupling this layout contract to a particular CAD operation.
    await setAdditionalRows([fields, treeContent], true)
    await expect.poll(async () => (await task.boundingBox())?.height).toBeCloseTo(taskCap, 0)
    await expect
      .poll(async () => {
        const bodyBounds = await layoutBounds(workspace)
        const treeBounds = await layoutBounds(tree)
        return treeBounds.height - bodyBounds.height
      })
      .toBeCloseTo(0, 0)
    const header = task.locator('[data-slot="task-panel-header"]')
    const headerBounds = await header.boundingBox()
    const footerBounds = await footer.boundingBox()
    await scrollBodiesToEnd([fields, treeContent])
    expect(await header.boundingBox()).toEqual(headerBounds)
    expect(await footer.boundingBox()).toEqual(footerBounds)
    await expect(tree.getByRole("heading", { name: "Model tree", exact: true })).toBeInViewport()
    await expect(footer.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
    if (width < 1024) await expectViewportControlsAboveTask(page, task)
    await setAdditionalRows([fields, treeContent], false)
    await expect
      .poll(async () => (await task.boundingBox())?.height)
      .toBeCloseTo(shortTask.height, 0)
    await expect
      .poll(async () => (await tree.boundingBox())?.height)
      .toBeCloseTo(shortTree.height, 0)
  })
}

test("retains compact task state with a fixed header and footer and resets a fresh task scrollport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 760 })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const form = page.getByRole("form", { name: "Create cylinder", exact: true })
  const task = page.getByRole("complementary", { name: "Task panel", exact: true })
  const fields = form.locator('[data-slot="task-panel-content"]')
  const header = form.locator('[data-slot="task-panel-header"]')
  const footer = form.locator('[data-slot="task-panel-footer"]')
  await expect(form).toBeVisible()
  await form.getByRole("combobox", { name: "Height", exact: true }).fill("23 mm")
  await setAdditionalRows([fields], true)
  await expect
    .poll(async () => (await layoutBounds(page.locator(".workspace-panel--task"))).height)
    .toBe(380)
  const headerBefore = await header.boundingBox()
  const footerBefore = await footer.boundingBox()
  const scrollLimit = await fields.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  )
  expect(scrollLimit).toBeGreaterThan(0)
  await fields.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => fields.evaluate((element) => element.scrollTop)).toBe(scrollLimit)
  expect(await task.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await header.boundingBox()).toEqual(headerBefore)
  expect(await footer.boundingBox()).toEqual(footerBefore)
  await expect(footer.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
  await expect(
    footer.getByRole("button", { name: "Create cylinder", exact: true }),
  ).toBeInViewport()
  await expect(form.getByRole("heading", { name: "Create cylinder", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("compact-task-scrolled.png") })
  await page.getByRole("button", { name: "Collapse task panel", exact: true }).click()
  await expect(form).toBeHidden()
  await page.getByRole("button", { name: "Open task panel", exact: true }).click()
  await expect(form).toBeVisible()
  await expect(form.getByRole("combobox", { name: "Height", exact: true })).toHaveValue("23 mm")
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(form).toBeVisible()
  await page.setViewportSize({ width: 960, height: 760 })
  await expect(form).toBeVisible()
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(form).toHaveCount(0)
  await invokeModelCommand(page, "Primitives", "Cylinder")
  await expect(form).toBeVisible()
  await expect.poll(() => fields.evaluate((element) => element.scrollTop)).toBe(0)
  const accept = footer.getByRole("button", { name: "Create cylinder", exact: true })
  await expect(accept).toBeEnabled()
  expect(
    await accept.evaluate((element) => element.closest("button")?.form?.getAttribute("aria-label")),
  ).toBe("Create cylinder")
  await form.getByRole("combobox", { name: "Height", exact: true }).press("Enter")
  await expect(form).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible()
})

test("keeps variable rows compact and scrolls the table inside its dialog", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Variables", exact: true })
  for (let i = 0; i < 10; i += 1) {
    await dialog.getByRole("button", { name: "Add variable", exact: true }).click()
    await dialog
      .getByRole("textbox", { name: "Variable name", exact: true })
      .last()
      .fill(`size${i}`)
    await dialog
      .getByRole("combobox", { name: "Variable expression", exact: true })
      .last()
      .fill(i === 1 ? "#size0 + 1 mm" : `${10 + i} mm`)
  }
  await dialog.getByRole("button", { name: "Apply variables", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply variables", exact: true })).toBeDisabled()
  await dialog.getByRole("button", { name: "Done", exact: true }).last().click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  const table = dialog.getByRole("table")
  await expect(table.getByRole("row")).toHaveCount(11)
  await expect(
    table.getByRole("row").nth(1).getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled()
  const dimensions = await table.evaluate((element) => {
    const scroller = element.parentElement
    if (!scroller) throw new Error("Expected the variable table scroller")
    return {
      height: scroller.clientHeight,
      content: scroller.scrollHeight,
      rowHeights: [...element.querySelectorAll("tbody tr")].map(
        (row) => row.getBoundingClientRect().height,
      ),
    }
  })
  expect(dimensions.height).toBeLessThanOrEqual(320)
  expect(dimensions.content).toBeGreaterThan(dimensions.height)
  for (const height of dimensions.rowHeights) expect(height).toBeLessThanOrEqual(60)
  await page.screenshot({ path: test.info().outputPath("compact-variable-table.png") })
})
