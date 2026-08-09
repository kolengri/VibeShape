import { expect, test } from "./fixtures"

test.describe("Boolean subtraction", () => {
  test("creates, edits, reopens, and safely deletes ordered solid inputs", async ({ page }) => {
    await page.goto("/")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const subtractCommand = toolbar.getByRole("button", { name: "Subtract", exact: true })
    await expect(subtractCommand).toBeDisabled()

    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()

    async function createCylinder(radius: string, label: string) {
      await toolbar.getByRole("button", { name: "Cylinder", exact: true }).click()
      const form = page.getByRole("form", { name: "Create cylinder" })
      await form.getByRole("textbox", { name: "Radius" }).fill(radius)
      await form.getByRole("textbox", { name: "Height" }).fill("40 mm")
      await form.getByRole("checkbox", { name: "Center on the origin" }).check()
      await form.getByRole("button", { name: "Create cylinder" }).click()
      await expect(page.getByRole("treeitem", { name: label })).toBeVisible()
    }

    await createCylinder("5 mm", "Cylinder 1")
    await createCylinder("6 mm", "Cylinder 2")
    await expect(subtractCommand).toBeEnabled()
    await subtractCommand.click()

    const createForm = page.getByRole("form", { name: "Subtract solids" })
    const createTarget = createForm.getByRole("combobox", { name: "Target solid" })
    const createTool = createForm.getByRole("combobox", { name: "Tool solid" })
    await expect(createTarget.locator("option:checked")).toHaveText("Box 1")
    await expect(createTool.locator("option:checked")).toHaveText("Cylinder 1")
    await createForm.getByRole("button", { name: "Subtract" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Subtract 1" })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Subtract 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      editForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    const editTool = editForm.getByRole("combobox", { name: "Tool solid" })
    await expect(editTool.locator("option:checked")).toHaveText("Cylinder 1")
    await editTool.selectOption({ label: "Cylinder 2" })
    await editForm.getByRole("button", { name: "Update subtraction" }).dblclick()
    await expect(editForm).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Subtract 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await page.getByRole("treeitem", { name: "Subtract 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      reopenedForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    await expect(
      reopenedForm.getByRole("combobox", { name: "Tool solid" }).locator("option:checked"),
    ).toHaveText("Cylinder 2")

    await page.getByRole("treeitem", { name: "Box 1" }).click()
    await expect(page.getByRole("button", { name: "Delete feature" })).toBeDisabled()
    await expect(page.getByText("Remove dependent features first: Subtract 1.")).toBeVisible()

    await page.getByRole("treeitem", { name: "Subtract 1" }).click()
    await page.getByRole("button", { name: "Delete feature" }).click()
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete Subtract 1?" })
    await expect(deleteDialog).toContainText(
      "This removes the feature from model history. This action cannot be undone yet.",
    )
    await deleteDialog.getByRole("button", { name: "Delete feature", exact: true }).dblclick()
    await expect(deleteDialog).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Subtract 1" })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await page.getByRole("treeitem", { name: "Cylinder 2" }).click()
    await page.getByRole("button", { name: "Delete feature" }).click()
    await page
      .getByRole("alertdialog", { name: "Delete Cylinder 2?" })
      .getByRole("button", { name: "Delete feature", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Cylinder 2" })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Subtract 1" })).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Cylinder 2" })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  })
})
