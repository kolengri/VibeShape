import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

for (const hidden of [false, true]) {
  test(`saves an open organic mesh from a ${hidden ? "hidden" : "visible"} source and reopens both Parts`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box", exact: true })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    const source = page.getByRole("treeitem", { name: "Part Box 1", exact: true })
    await expect(source).toBeVisible()
    if (hidden) await page.getByRole("button", { name: "Hide part Box 1", exact: true }).click()
    await invokeModelCommand(page, "Modify", "Quick lightweighting")
    const panel = page.getByRole("region", { name: "Quick lightweighting", exact: true })
    await panel.getByRole("combobox", { name: "Source Part", exact: true }).click()
    await page.getByRole("option", { name: "Box 1", exact: true }).click()
    await panel.getByRole("button", { name: "Open organic", exact: true }).click()
    const apply = panel.getByRole("button", { name: "Apply lightweighting", exact: true })
    await expect(apply).toBeEnabled({ timeout: 120_000 })
    await apply.click()
    await expect(panel).toBeHidden({ timeout: 30_000 })
    const result = page.getByRole("treeitem", {
      name: "Part Box 1 — organic lightweighting",
      exact: true,
    })
    await expect(result).toBeVisible()
    await page.reload()
    await expect(source).toBeVisible()
    await expect(result).toBeVisible()
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
  })
}
