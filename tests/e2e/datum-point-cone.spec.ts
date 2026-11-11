import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect as baseExpect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test.setTimeout(90_000)
const expect = baseExpect.configure({ timeout: 15_000 })

async function waitForSaved(page: Page) {
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function createTruncatedCone(page: Page) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await invokeModelCommand(page, "Primitives", "Cone")
  const form = page.getByRole("form", { name: "Create cone" })
  await form.getByRole("combobox", { name: "Radius", exact: true }).fill("12 mm")
  const topRadius = form.getByRole("combobox", { name: "Top radius", exact: true })
  await expect(topRadius).toHaveValue("0 mm")
  await topRadius.fill("12 mm")
  await topRadius.blur()
  await expect(topRadius).toHaveAttribute("aria-invalid", "true")
  await topRadius.fill("5 mm")
  await form.getByRole("combobox", { name: "Height", exact: true }).fill("30 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  await form.getByRole("button", { name: "Create cone", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Cone 1", exact: true })).toBeVisible()
  await waitForSaved(page)
}

test("creates a truncated cone and restores its top radius after reload", async ({ page }) => {
  await page.goto("/")
  await waitForSaved(page)
  await createTruncatedCone(page)
  await page.reload()
  await page.getByRole("treeitem", { name: "Cone 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit cone" })
  await expect(edit.getByRole("combobox", { name: "Top radius", exact: true })).toHaveValue("5 mm")
  await expect(edit.getByRole("combobox", { name: "Radius", exact: true })).toHaveValue("12 mm")
})

test("places a datum point at a circular edge center, undoes it, and restores it after reload", async ({
  page,
}) => {
  await page.goto("/")
  await waitForSaved(page)
  await createTruncatedCone(page)
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await openApplicationMenuItem(page, "Commands Ctrl/Cmd+K")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Datum point")
  await palette.getByRole("option", { name: /^Datum point/ }).click()
  const form = page.getByRole("form", { name: "Create datum point" })
  await form.getByRole("combobox", { name: "Locate by", exact: true }).selectOption({
    label: "Circular edge center",
  })
  const circle = form.getByRole("combobox", { name: "Circular edge", exact: true })
  const option = circle.locator("option", { hasText: "(0, 0, 30)" })
  await expect(option).toHaveCount(1)
  await circle.selectOption({ label: (await option.textContent()) ?? "" })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  await form.getByRole("button", { name: "Create datum point", exact: true }).click()
  const point = page.getByRole("treeitem", { name: "Datum point 1", exact: true })
  await expect(point).toBeVisible()
  await waitForSaved(page)

  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(point).toHaveCount(0)
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(point).toBeVisible()
  await waitForSaved(page)

  await page.reload()
  await point.click()
  const edit = page.getByRole("form", { name: "Edit datum point" })
  await expect(edit.getByRole("combobox", { name: "Locate by", exact: true })).toHaveValue(
    "circle-center",
  )
  await expect(edit.getByRole("combobox", { name: "Circular edge", exact: true })).toHaveValue(
    "saved",
  )
  await expect(
    edit.getByRole("combobox", { name: "Circular edge", exact: true }).locator("option:checked"),
  ).toHaveText("Current reference")
})
