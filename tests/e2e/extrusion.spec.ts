import { expect, test } from "./fixtures"

test.describe("selector-backed extrusion", () => {
  test("creates, rebuilds, edits, and reopens a variable-driven solid", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("depth")
    await page.getByRole("textbox", { name: "Variable expression" }).fill("18 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    await page.getByRole("button", { name: "Create sketch" }).click()
    const sketchForm = page.getByRole("form", { name: "Create rectangle sketch" })
    await sketchForm.getByRole("textbox", { name: "Width" }).fill("20 mm")
    await sketchForm.getByRole("textbox", { name: "Height" }).fill("10 mm")
    await sketchForm.getByRole("combobox", { name: "Support plane" }).selectOption("xz")
    await sketchForm.getByRole("button", { name: "Create sketch" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await page.getByRole("button", { name: "Extrude profile" }).click()
    const createForm = page.getByRole("form", { name: "Extrude profile" })
    await expect(createForm.getByText("Sketch 1", { exact: true })).toBeVisible()
    await createForm.getByRole("textbox", { name: "Distance" }).fill("#depth")
    await createForm.getByRole("checkbox", { name: "Extrude symmetrically" }).check()
    await createForm.getByRole("button", { name: "Create extrusion" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(editForm.getByRole("textbox", { name: "Distance" })).toHaveValue("#depth")
    await expect(editForm.getByRole("checkbox", { name: "Extrude symmetrically" })).toBeChecked()
    await editForm.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    const expression = page.getByRole("textbox", { name: "Variable expression" })
    await expression.fill("24 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable expression" })).toHaveValue("24 mm")
    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(reopenedForm.getByRole("textbox", { name: "Distance" })).toHaveValue("#depth")
    await expect(
      reopenedForm.getByRole("checkbox", { name: "Extrude symmetrically" }),
    ).toBeChecked()
  })
})
