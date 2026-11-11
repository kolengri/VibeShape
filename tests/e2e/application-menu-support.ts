import { expect, type Page } from "@playwright/test"

export async function openApplicationMenuItem(page: Page, name: string) {
  if (name !== "Settings…" && name !== "FAQ and MCP setup…") {
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
  }
  await page.getByRole("button", { name: "Application menu", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

export async function openAiConnections(page: Page) {
  const footer = page.locator("main footer:visible")
  await expect(footer).toBeVisible()
  return footer
}

export async function enableLocalAi(page: Page) {
  const footer = await openAiConnections(page)
  await footer.getByRole("button", { name: "Enable AI session", exact: true }).click()
  await expect(footer.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
}

/** Opens the local MCP approval menu; the remote connection has its own separate trigger. */
export async function openLocalAiApprovalMenu(page: Page) {
  const footer = await openAiConnections(page)
  await footer
    .getByRole("button", { name: "Local MCP connection and approval mode", exact: true })
    .click()
}

export async function openAutoApplySetup(page: Page) {
  await openLocalAiApprovalMenu(page)
  await page.getByRole("menuitemradio", { name: "Apply automatically", exact: true }).click()
}
