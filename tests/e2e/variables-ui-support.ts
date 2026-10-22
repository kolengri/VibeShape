import { expect, type Page } from "@playwright/test"

export async function closeVariablesDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Variables", exact: true })
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Done", exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
}
