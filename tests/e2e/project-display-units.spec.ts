import { expect, test } from "./fixtures"

test.describe("project display units", () => {
  test("applies project units to input, resolved values, viewport copy, and reload", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Project units: mm, deg" }).click()
    const dialog = page.getByRole("dialog", { name: "Project units" })
    await dialog.getByRole("combobox", { name: "Length unit" }).selectOption("in")
    await dialog.getByRole("combobox", { name: "Angle unit" }).selectOption("rad")
    await dialog.getByRole("button", { name: "Apply project units" }).dblclick()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText("Units: in · rad", { exact: true })).toBeVisible()
    await expect(page.getByText("XY · in", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("25.4 mm")
    await expect(page.getByRole("cell", { name: "1 in" })).toBeVisible()
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const createBox = page.getByRole("form", { name: "Create box" })
    await expect(createBox.getByRole("combobox", { name: "Width" })).toHaveValue(
      "0.787401574803 in",
    )
    await createBox.getByRole("combobox", { name: "Width" }).fill("2")
    await createBox.getByRole("button", { name: "Create box" }).dblclick()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()

    await page.getByRole("treeitem", { name: "Box 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Width" }),
    ).toHaveValue("2 in")

    await page.reload()
    await expect(page.getByText("Units: in · rad", { exact: true })).toBeVisible()
    await expect(page.getByText("XY · in", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("cell", { name: "1 in" })).toBeVisible()
    await page.getByRole("treeitem", { name: "Box 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Width" }),
    ).toHaveValue("2 in")
  })
})
