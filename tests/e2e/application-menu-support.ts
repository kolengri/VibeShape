import { expect, type Page } from "@playwright/test"

export async function openApplicationMenuItem(page: Page, name: string) {
  await expect(page.locator("main > header")).not.toContainText("Opening local document…")
  await page.getByRole("button", { name: "Application menu", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

export async function openAiConnections(page: Page) {
  const footer = page.locator("main > footer")
  await expect(footer).toBeVisible()
  return footer
}

export async function enableLocalAi(page: Page) {
  const footer = await openAiConnections(page)
  await footer.getByRole("button", { name: "Enable AI session", exact: true }).click()
  await expect(footer.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
}

export async function openAutoApplySetup(page: Page) {
  const footer = await openAiConnections(page)
  await footer.getByRole("button", { name: "AI connection and approval mode", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Apply automatically", exact: true }).click()
}
