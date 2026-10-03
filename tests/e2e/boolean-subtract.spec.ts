import { expect, test } from "./fixtures"

test.describe("Boolean subtraction", () => {
  test("restores selectable sources after a failed cut and preserves saved repair inputs", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto("/")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    for (const label of ["Box 1", "Box 2"]) {
      await toolbar.getByRole("button", { name: "Box", exact: true }).click()
      await page
        .getByRole("form", { name: "Create box" })
        .getByRole("button", { name: "Create box", exact: true })
        .click()
      await expect(page.getByRole("treeitem", { name: label, exact: true })).toBeVisible()
    }
    const subtract = toolbar.getByRole("button", { name: "Subtract", exact: true })
    await subtract.click()
    await page
      .getByRole("form", { name: "Subtract solids" })
      .getByRole("button", { name: "Subtract", exact: true })
      .click()
    const failedFeature = page.getByRole("treeitem", { name: "Subtract 1", exact: true })
    await expect(failedFeature).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(subtract).toBeEnabled()
    await subtract.click()
    const createForm = page.getByRole("form", { name: "Subtract solids" })
    await expect(
      createForm.getByRole("combobox", { name: "Target solid" }).locator("option"),
    ).toHaveText(["Box 1", "Box 2"])
    await createForm.getByRole("button", { name: "Cancel", exact: true }).click()
    await failedFeature.click()
    const editForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      editForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    await expect(
      editForm.getByRole("combobox", { name: "Tool solid" }).locator("option:checked"),
    ).toHaveText("Box 2")
    await editForm.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.reload()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(subtract).toBeEnabled()
  })

  test("creates, edits, reopens, and safely deletes ordered solid inputs", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const subtractCommand = toolbar.getByRole("button", { name: "Subtract", exact: true })
    await expect(subtractCommand).toBeDisabled()

    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()

    async function createCylinder(radius: string, label: string) {
      await toolbar.getByRole("button", { name: "Cylinder", exact: true }).click()
      const form = page.getByRole("form", { name: "Create cylinder" })
      await form.getByRole("combobox", { name: "Radius" }).fill(radius)
      await form.getByRole("combobox", { name: "Height" }).fill("40 mm")
      await form.getByRole("checkbox", { name: "Center height about placement origin" }).check()
      await form.getByRole("button", { name: "Create cylinder" }).click()
      await expect(page.getByRole("treeitem", { name: label, exact: true })).toBeVisible()
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
    await expect(createForm.getByRole("checkbox", { name: "Keep tool solid" })).not.toBeChecked()
    await createForm.getByRole("button", { name: "Subtract" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    const editForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      editForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    const editTool = editForm.getByRole("combobox", { name: "Tool solid" })
    await expect(editTool.locator("option:checked")).toHaveText("Cylinder 1")
    await editTool.selectOption({ label: "Cylinder 2" })
    await editForm.getByRole("checkbox", { name: "Keep tool solid" }).check()
    await editForm.getByRole("button", { name: "Update subtraction" }).dblclick()
    await expect(editForm).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      reopenedForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    await expect(
      reopenedForm.getByRole("combobox", { name: "Tool solid" }).locator("option:checked"),
    ).toHaveText("Cylinder 2")

    await expect(reopenedForm.getByRole("checkbox", { name: "Keep tool solid" })).toBeChecked()
    await reopenedForm.getByRole("checkbox", { name: "Keep tool solid" }).uncheck()
    await reopenedForm.getByRole("button", { name: "Update subtraction" }).click()
    await expect(reopenedForm).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await subtractCommand.click()
    const nextForm = page.getByRole("form", { name: "Subtract solids" })
    await expect(
      nextForm.getByRole("combobox", { name: "Target solid" }).locator("option"),
    ).toHaveText(["Cylinder 1", "Subtract 1"])
    await nextForm.getByRole("button", { name: "Cancel", exact: true }).click()

    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(page.getByRole("button", { name: "Delete feature" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Delete and keep references" })).toHaveCount(0)
    await expect(
      page.getByText("Deletion is blocked by: Subtract 1 (feature dependency)."),
    ).toBeVisible()

    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    await page.getByRole("button", { name: "Delete feature" }).click()
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete Subtract 1?" })
    await expect(deleteDialog).toContainText("This removes the feature from model history.")
    await deleteDialog.getByRole("button", { name: "Delete feature", exact: true }).dblclick()
    await expect(deleteDialog).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await page.getByRole("treeitem", { name: "Cylinder 2", exact: true }).click()
    await page.getByRole("button", { name: "Delete feature" }).click()
    await page
      .getByRole("alertdialog", { name: "Delete Cylinder 2?" })
      .getByRole("button", { name: "Delete feature", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Cylinder 2", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Cylinder 2", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()

    await page.getByRole("button", { name: "Compound", exact: true }).click()
    const compound = page.getByRole("form", { name: "Create Compound", exact: true })
    await compound.getByRole("button", { name: "Add part Box 1", exact: true }).click()
    await compound.getByRole("button", { name: "Add part Cylinder 1", exact: true }).click()
    await compound.getByRole("button", { name: "Create", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Compound 1", exact: true })).toBeVisible()
    await expect(subtractCommand).toBeDisabled()
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Compound 1", exact: true })).not.toBeVisible()
    await expect(subtractCommand).toBeEnabled()
  })
})
