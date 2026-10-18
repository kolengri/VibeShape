import { expect, type Page } from "@playwright/test"

type ModelCommandMenu = "Create" | "Modify" | "Primitives" | "Inspect"

export async function openModelCommand(page: Page, menu: ModelCommandMenu, name: string) {
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: menu, exact: true })
    .click()
  return page.getByRole("menuitem", { name, exact: true })
}

export async function invokeModelCommand(page: Page, menu: ModelCommandMenu, name: string) {
  await (await openModelCommand(page, menu, name)).click()
}

export async function expandHistoryDetails(page: Page) {
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  const details = page.getByRole("button", { name: "Details", exact: true })
  if ((await details.getAttribute("aria-pressed")) !== "true") await details.click()
  await expect(details).toHaveAttribute("aria-pressed", "true")
}
