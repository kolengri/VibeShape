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
  // Task windows render their own footer; the status bar is the one owning the selection status.
  const footer = page
    .locator("main footer:visible")
    .filter({ has: page.getByRole("status").filter({ hasText: /^Selection: / }) })
  await expect(footer).toBeVisible()
  return footer
}

export async function enableLocalAi(page: Page) {
  const footer = await openAiConnections(page)
  await footer.getByRole("button", { name: "Enable AI session", exact: true }).click()
  await expect(footer.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
}

/**
 * Waits until a remembered local MCP session has reconnected after a reload. Stop AI is also shown
 * while the session is still recovering, when the bridge rejects tool calls as suspended.
 */
export async function expectLocalAiReconnected(page: Page) {
  await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByRole("button", { name: "Local MCP connection and approval mode", exact: true }),
  ).toBeVisible({ timeout: 30_000 })
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
