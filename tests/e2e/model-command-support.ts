import { expect, type Locator, type Page } from "@playwright/test"

type ModelCommandMenu = "Create" | "Modify" | "Primitives" | "Inspect"

export async function openModelCommand(
  page: Page,
  menu: ModelCommandMenu,
  name: string,
): Promise<Locator> {
  const toolbar = page.getByRole("toolbar", { name: "Model commands", exact: true })
  const direct = toolbar.getByRole("button", { name, exact: true })
  const group = toolbar.getByRole("button", { name: menu, exact: true })
  const compact = toolbar.getByRole("button", { name: "Modeling actions", exact: true })
  const item = page.getByRole("menuitem", { name, exact: true })
  await expect(direct.or(item).or(group).or(compact).first()).toBeVisible()
  if (await direct.isVisible()) return direct
  if (await item.isVisible()) return item
  await group.or(compact).first().click()
  await expect(item).toBeVisible()
  return item
}

export async function invokeModelCommand(page: Page, menu: ModelCommandMenu, name: string) {
  await (await openModelCommand(page, menu, name)).click()
}

export async function expandHistoryDetails(page: Page) {
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeAttached()
  const details = page.getByRole("button", { name: "Details", exact: true })
  if ((await details.getAttribute("aria-pressed")) !== "true") await details.click()
  await expect(details).toHaveAttribute("aria-pressed", "true")
}
