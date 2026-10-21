import { expect, test } from "./fixtures"

test.describe("document variables", () => {
  test("edits a searched variable without losing hidden rows on Apply", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("treeitem", { name: "Variables" }).click()
    for (const [index, name, expression] of [
      [0, "width", "20 mm"],
      [1, "height", "#width * 2"],
    ] as const) {
      await page.getByRole("button", { name: "Add variable", exact: true }).click()
      await page.getByRole("textbox", { name: "Variable name", exact: true }).nth(index).fill(name)
      await page
        .getByRole("combobox", { name: "Variable expression", exact: true })
        .nth(index)
        .fill(expression)
    }
    await page.getByRole("searchbox", { name: "Search variables", exact: true }).fill("#HEIGHT")
    await expect(page.getByRole("textbox", { name: "Variable name", exact: true })).toHaveCount(1)
    await expect(page.getByRole("textbox", { name: "Variable name", exact: true })).toHaveValue(
      "height",
    )
    await page.getByRole("combobox", { name: "Variable expression", exact: true }).fill("50 mm")
    await page.getByRole("button", { name: "Apply variables", exact: true }).click()
    await page
      .getByRole("dialog", { name: "Variables", exact: true })
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Done", exact: true })
      .click()
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await page.reload()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable name", exact: true })).toHaveCount(2)
    await expect(
      page.getByRole("combobox", { name: "Variable expression", exact: true }).nth(0),
    ).toHaveValue("20 mm")
    await expect(
      page.getByRole("combobox", { name: "Variable expression", exact: true }).nth(1),
    ).toHaveValue("50 mm")
  })

  test("creates, evaluates, persists, and reopens a variable table", async ({ page }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()

    await expect(
      page.getByRole("heading", { name: "Variables", exact: true, level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole("table", { name: "Document variables" })).toBeVisible()
    await page.getByRole("button", { name: "Add variable" }).click()

    const name = page.getByRole("textbox", { name: "Variable name" })
    await expect(name).toBeFocused()
    await name.fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("20 mm")
    await expect(page.getByText("20 mm", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Apply variables" }).dblclick()
    await expect(name).toBeDisabled()
    await page
      .getByRole("dialog", { name: "Variables", exact: true })
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Done", exact: true })
      .click()
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()

    await page.reload()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable name" })).toHaveValue("width")
    await expect(page.getByRole("combobox", { name: "Variable expression" })).toHaveValue("20 mm")
    await expect(page.getByText("20 mm", { exact: true })).toBeVisible()
  })

  test("completes variable references in expression fields", async ({ page }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
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
