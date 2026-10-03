import { expect, type Page } from "@playwright/test"

export async function openApplicationMenuItem(page: Page, name: string) {
  await expect(page.locator("main > header")).not.toContainText("Opening local document…")
  await page.getByRole("button", { name: "Application menu", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

export async function openAiConnections(page: Page) {
  const dialog = page.getByRole("dialog", { name: "AI connections…", exact: true })
  if (!(await dialog.isVisible())) await openApplicationMenuItem(page, "AI connections…")
  return dialog
}

export async function enableLocalAi(page: Page) {
  const dialog = await openAiConnections(page)
  await dialog.getByRole("button", { name: "Enable AI session", exact: true }).click()
  await expect(
    dialog.getByRole("button", { name: "Disable AI session", exact: true }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Close AI connections", exact: true }).click()
  await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
}
