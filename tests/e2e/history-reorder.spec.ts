import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

async function createBox(page: Page) {
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Box", exact: true }).click()
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
}

test("reorders independent History items with undo, redo, and reload persistence", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await createBox(page)
  await createBox(page)

  const viewport = page.getByRole("region", { name: "3D viewport" })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  const featureRows = page.locator('[data-history-kind="feature"] [role="treeitem"]')
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await expect(featureRows).toHaveText(["Box 1", "Box 2"])

  await page.getByRole("button", { name: "Move Box 2 earlier" }).click()
  await expect(featureRows).toHaveText(["Box 2", "Box 1"])
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(featureRows).toHaveText(["Box 1", "Box 2"])
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(featureRows).toHaveText(["Box 2", "Box 1"])

  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await expect(page.locator('[data-history-kind="feature"] [role="treeitem"]')).toHaveText([
    "Box 2",
    "Box 1",
  ])
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "2",
  )
})
