import { expect, test } from "./fixtures"

test.describe("Cylinder parameters", () => {
  test("creates, edits, renders, and reopens a variable-driven Cylinder", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("radius")
    await page.getByRole("textbox", { name: "Variable expression" }).fill("12 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Cylinder", exact: true })
      .click()
    const createForm = page.getByRole("form", { name: "Create cylinder" })
    await expect(createForm).toBeVisible()
    await createForm.getByRole("textbox", { name: "Radius" }).fill("#radius")
    await createForm.getByRole("checkbox", { name: "Center on the origin" }).check()
    await createForm.getByRole("button", { name: "Create cylinder" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Cylinder 1" })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Cylinder 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit cylinder" })
    await expect(editForm.getByRole("textbox", { name: "Radius" })).toHaveValue("#radius")
    await expect(editForm.getByRole("checkbox", { name: "Center on the origin" })).toBeChecked()
    await editForm.getByRole("textbox", { name: "Height" }).fill("42 mm")
    await editForm.getByRole("button", { name: "Update cylinder" }).dblclick()
    await expect(editForm).not.toBeVisible()

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Cylinder 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await page.getByRole("treeitem", { name: "Cylinder 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit cylinder" })
    await expect(reopenedForm.getByRole("textbox", { name: "Radius" })).toHaveValue("#radius")
    await expect(reopenedForm.getByRole("textbox", { name: "Height" })).toHaveValue("42 mm")
    await expect(reopenedForm.getByRole("checkbox", { name: "Center on the origin" })).toBeChecked()
  })
})
