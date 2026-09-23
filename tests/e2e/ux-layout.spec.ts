import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

async function expectContained(dialog: Locator, page: Page) {
  const viewport = page.viewportSize()
  const bounds = await dialog.boundingBox()
  if (!viewport || !bounds) throw new Error("The visible dialog must have measurable bounds.")
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}

for (const theme of ["light", "dark"] as const) {
  test(`keeps project dialogs and the command palette reachable at compact zoom-equivalent size in ${theme} theme`, async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page
      .locator("html")
      .evaluate((element, theme) => element.classList.toggle("dark", theme === "dark"), theme)
    await page.setViewportSize({ width: 512, height: 384 })
    await page.getByRole("button", { name: "Project units: mm, deg", exact: true }).click()
    const units = page.getByRole("dialog", { name: "Project units", exact: true })
    await expectContained(units, page)
    await units.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded()
    await expect(units.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath("compact-units.png") })
    await page.keyboard.press("Escape")
    await expect(units).not.toBeVisible()
    await expect(
      page.getByRole("button", { name: "Project units: mm, deg", exact: true }),
    ).toBeFocused()
    await page.getByRole("button", { name: "Commands", exact: true }).click()
    await expectContained(page.getByRole("dialog"), page)
    await page.getByRole("combobox").press("End")
    const lastAvailableCommand = page.locator('[role="option"]:not([aria-disabled="true"])').last()
    await expect(lastAvailableCommand).toHaveAttribute("aria-selected", "true")
    await expect(lastAvailableCommand).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath("compact-command-palette.png") })
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Project…", exact: true }).click()
    const projects = page.getByRole("dialog", { name: "Projects", exact: true })
    await expectContained(projects, page)
    await projects
      .getByRole("listitem")
      .filter({ hasText: "Current" })
      .getByRole("button", { name: /^Duplicate / })
      .click()
    const copy = projects.getByRole("listitem").filter({ hasText: "Untitled project copy" })
    await copy.getByRole("button", { name: /^Delete / }).click()
    const confirmation = page.getByRole("alertdialog")
    await expectContained(confirmation, page)
    await confirmation
      .getByRole("button", { name: "Keep project", exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      confirmation.getByRole("button", { name: "Keep project", exact: true }),
    ).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath("compact-delete-confirmation.png") })
    await confirmation.getByRole("button", { name: "Keep project", exact: true }).click()
    await expect(confirmation).not.toBeVisible()
    await expect(copy).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click()
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true })
    await expectContained(help, page)
    await help.getByRole("textbox", { name: "Search shortcuts…" }).fill("extrude")
    await expect(help.getByText("Extrude", { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("compact-shortcut-help.png") })
    await page.keyboard.press("Escape")
    await expect(
      page.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
    ).toBeFocused()
  })
}

test("keeps the model tree inside its column after a long feature rename", async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Box", exact: true })
    .click()
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  const feature = page.getByRole("treeitem", { name: "Box 1", exact: true })
  await feature.focus()
  await page.keyboard.press("F2")
  const name =
    "MountingFeatureSelectedForStatusBarLayoutVerification0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
  const rename = page.getByRole("dialog", { name: "Rename feature" })
  await rename.getByRole("textbox", { name: "Feature name" }).fill(name)
  await rename.getByRole("button", { name: "Rename feature", exact: true }).click()
  await expect(rename).not.toBeVisible()
  const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
  await expect
    .poll(() =>
      tree.evaluate((element) => ({
        left: element.scrollLeft,
        width: element.scrollWidth - element.clientWidth,
      })),
    )
    .toEqual({ left: 0, width: 0 })
  await expect(page.getByRole("treeitem", { name, exact: true })).toBeInViewport()
  await expect(page.getByRole("treeitem", { name: "Variables", exact: true })).toBeInViewport()
  await page.getByRole("treeitem", { name: "Body 1", exact: true }).click()
  await expect.poll(() => tree.evaluate((element) => element.scrollLeft)).toBe(0)
  await page.screenshot({ path: test.info().outputPath("long-name-model-tree.png") })
})
