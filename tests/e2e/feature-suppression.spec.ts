import { expect, test } from "./fixtures"

test("suppresses and restores a feature through persisted history", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await toolbar.getByRole("button", { name: "Box", exact: true }).click()
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")

  await page.getByRole("button", { name: "Suppress Box 1" }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  await expect(page.getByRole("button", { name: "Unsuppress Box 1" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Hide Box 1" })).toBeDisabled()

  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await expect(page.getByRole("button", { name: "Suppress Box 1" })).toBeVisible()

  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "0",
  )
  await page.getByRole("button", { name: "Unsuppress Box 1" }).click()
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
  )
  await expect(page.getByRole("button", { name: "Suppress Box 1" })).toBeVisible()
})
