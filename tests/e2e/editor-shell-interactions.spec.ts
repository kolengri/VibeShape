import { mkdir } from "node:fs/promises"
import type { Locator, Page } from "@playwright/test"
import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

async function requiredAttribute(locator: Locator, name: string) {
  await expect(locator).toHaveCount(1)
  const value = await locator.getAttribute(name)
  if (!value) throw new Error(`The authored row must expose ${name}.`)
  return value
}

async function expectCanvasRetained(
  canvas: Locator,
  original: Awaited<ReturnType<Locator["elementHandle"]>>,
) {
  expect(await canvas.evaluate((element, previous) => element === previous, original)).toBe(true)
}

async function expectCompactActionsVisible(history: Locator, viewport: Locator) {
  await expect(history.getByRole("button", { name: "Details", exact: true })).toBeInViewport({
    ratio: 1,
  })
  for (const name of ["Section view", "Standard views", "Fit view"]) {
    await expect(viewport.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 })
  }
}

async function pickVisibleBody(page: Page, viewport: Locator, browser: Locator) {
  await viewport.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Top", exact: true }).click()
  await viewport.getByRole("button", { name: "Fit view", exact: true }).click()
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The fitted model canvas must be visible.")
  // The symmetric fixture puts a shared box edge at the center; select inside a face.
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height * 0.6 } })
  await expect(viewport).toHaveAttribute("data-selected-feature", /.+/)
  const featureId = await requiredAttribute(viewport, "data-selected-feature")
  const owner = browser.locator(`[data-part-id][data-feature-id="${featureId}"]`)
  await expect(owner).toHaveCount(1)
  await expect(owner.getByRole("treeitem")).toHaveAttribute("aria-selected", "true")
}

for (const [theme, removeKey] of [
  ["dark", "Delete"],
  ["light", "Backspace"],
] as const) {
  test(`synchronizes authored selection, hover, modal focus and atomic ${removeKey} in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 720 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    await saved(page)
    await page
      .locator("html")
      .evaluate((element, value) => element.classList.toggle("dark", value === "dark"), theme)
    await createSolids(page)

    const browser = page.getByRole("complementary", { name: "Model tree", exact: true })
    const history = page.getByRole("region", { name: "Feature history", exact: true })
    const viewport = page.getByRole("region", {
      name: "3D viewport",
      exact: true,
      includeHidden: true,
    })
    const box = browser.getByRole("treeitem", { name: "Part Box 1", exact: true })
    const cylinder = browser.getByRole("treeitem", { name: "Part Cylinder 1", exact: true })
    const boxRow = browser.locator("[data-part-id]").filter({
      has: page.getByRole("treeitem", { name: "Part Box 1", exact: true }),
    })
    const cylinderRow = browser.locator("[data-part-id]").filter({
      has: page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }),
    })
    const boxFeature = await requiredAttribute(boxRow, "data-feature-id")
    const cylinderFeature = await requiredAttribute(cylinderRow, "data-feature-id")
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await pickVisibleBody(page, viewport, browser)

    await box.click()
    await cylinder.click({ modifiers: ["ControlOrMeta"] })
    await expect(box).toHaveAttribute("aria-selected", "true")
    await expect(cylinder).toHaveAttribute("aria-selected", "true")
    await box.click({ modifiers: ["ControlOrMeta"] })
    await expect(box).toHaveAttribute("aria-selected", "false")
    await expect(cylinder).toHaveAttribute("aria-selected", "true")
    await box.click()
    await cylinder.click({ modifiers: ["Shift"] })
    await expect(
      browser.locator('[data-part-id] [role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2)
    await expect(page.getByRole("form", { name: /^Edit (box|cylinder)$/ })).toHaveCount(0)

    await history.getByRole("button", { name: "Details", exact: true }).click()
    const boxHistory = history.locator(`[data-history-id="${boxFeature}"]`)
    const cylinderHistory = history.locator(`[data-history-id="${cylinderFeature}"]`)
    await box.hover()
    await expect(viewport).toHaveAttribute("data-preselected-feature", boxFeature)
    await expect(boxHistory).toHaveAttribute("data-history-source-highlighted", "true")
    await expect(cylinderHistory).not.toHaveAttribute("data-history-source-highlighted", "true")
    await history.getByRole("treeitem", { name: "Cylinder 1", exact: true }).hover()
    await expect(viewport).toHaveAttribute("data-preselected-feature", cylinderFeature)
    await expect(cylinderRow.locator('[role="none"]').first()).toHaveClass(/ring-primary/)
    await expect(boxRow.locator('[role="none"]').first()).not.toHaveClass(/ring-primary/)
    await page.getByRole("button", { name: "Application menu", exact: true }).hover()
    await expect(viewport).not.toHaveAttribute("data-preselected-feature")
    await expect(boxHistory).not.toHaveAttribute("data-history-source-highlighted", "true")
    await expect(boxRow).toHaveAttribute("data-part-visible", "true")
    await expect(cylinderRow).toHaveAttribute("data-part-visible", "true")
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    const canvas = viewport.locator("canvas")
    const originalCanvas = await canvas.elementHandle()
    if (!originalCanvas) throw new Error("The model canvas must be mounted.")
    const variablesTrigger = browser.getByRole("treeitem", { name: "Variables", exact: true })
    await variablesTrigger.click()
    const variables = page.getByRole("dialog", { name: "Variables", exact: true })
    await expect(variables).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expectCanvasRetained(canvas, originalCanvas)
    await variables
      .getByRole("button", { name: "Done", exact: true })
      .filter({ hasText: "Done" })
      .click()
    await expect(variables).toHaveCount(0)
    await expect(variablesTrigger).toBeFocused()
    await expectCanvasRetained(canvas, originalCanvas)

    await box.click()
    await cylinder.click({ modifiers: ["Shift"] })
    await expect(
      browser.locator('[data-part-id] [role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2)
    await mkdir("artifacts/project-navigation-ai-settings", { recursive: true })
    await page.screenshot({
      path: `artifacts/project-navigation-ai-settings/editor-shell-${testInfo.project.name}-${theme}-1024.png`,
      animations: "disabled",
    })
    await page.setViewportSize({ width: 512, height: 360 })
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await expectCompactActionsVisible(history, viewport)
    await page.screenshot({
      path: `artifacts/project-navigation-ai-settings/editor-shell-${testInfo.project.name}-${theme}-200-percent-equivalent.png`,
      animations: "disabled",
    })
    await page.setViewportSize({ width: 1024, height: 720 })

    await cylinder.focus()
    await cylinder.press(removeKey)
    const confirmation = page.getByRole("alertdialog", {
      name: "Delete 2 selected items?",
      exact: true,
    })
    await expect(page.getByRole("alertdialog")).toHaveCount(1)
    await expect(confirmation).toContainText("Box 1")
    await expect(confirmation).toContainText("Cylinder 1")
    await confirmation.getByRole("button", { name: "Delete selection", exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(box).toHaveCount(0)
    await expect(cylinder).toHaveCount(0)
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await saved(page)
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(box).toBeVisible()
    await expect(cylinder).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await saved(page)
    await originalCanvas.dispose()
  })
}
