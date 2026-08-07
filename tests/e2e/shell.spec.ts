import { expect, test } from "@playwright/test"

test("renders the foundation CAD shell", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByText("VibeShape", { exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr")
  await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("Ready")
})
