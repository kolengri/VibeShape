import { expect, test } from "./fixtures"

test.describe("document variables", () => {
  test("creates, evaluates, persists, and reopens a variable table", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()

    await expect(page.getByRole("heading", { name: "Variables", exact: true })).toBeVisible()
    await expect(page.getByRole("table", { name: "Document variables" })).toBeVisible()
    await page.getByRole("button", { name: "Add variable" }).click()

    const name = page.getByRole("textbox", { name: "Variable name" })
    await expect(name).toBeFocused()
    await name.fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("20 mm")
    await expect(page.getByText("20 mm", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Apply variables" }).dblclick()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(name).toBeDisabled()

    await page.reload()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable name" })).toHaveValue("width")
    await expect(page.getByRole("combobox", { name: "Variable expression" })).toHaveValue("20 mm")
    await expect(page.getByText("20 mm", { exact: true })).toBeVisible()
  })

  test("completes variable references in expression fields", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()

    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("20 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable name" })).toBeDisabled()

    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).nth(1).fill("height")
    const expression = page.getByRole("combobox", { name: "Variable expression" }).nth(1)
    await expression.fill("#wi")

    await expect(page.getByRole("listbox", { name: "Available variables" })).toBeVisible()
    await expect(page.getByRole("option", { name: /#width/ })).toBeVisible()
    await expression.press("Enter")
    await expect(expression).toHaveValue("#width")
  })
})
