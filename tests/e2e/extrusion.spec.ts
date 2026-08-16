import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test.describe("selector-backed extrusion", () => {
  test("creates, rebuilds, edits, and reopens a variable-driven solid", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })
    await expect(startPanel.getByRole("heading", { name: "Start with a sketch" })).toBeVisible()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("depth")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("18 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xz")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Extrude selected profile" })).toBeEnabled()
    await page.getByRole("button", { name: "Extrude selected profile" }).click()
    const createForm = page.getByRole("form", { name: "Extrude profile" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(createForm.getByText("Sketch 1", { exact: true })).toBeVisible()
    await createForm.getByRole("combobox", { name: "Distance" }).fill("#depth")
    await createForm.getByRole("checkbox", { name: "Extrude symmetrically" }).check()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
    await expect(page.getByText("Unsaved extrusion preview", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).not.toBeVisible()
    await createForm.getByRole("button", { name: "Create extrusion" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(editForm.getByRole("combobox", { name: "Distance" })).toHaveValue("#depth")
    await expect(editForm.getByRole("checkbox", { name: "Extrude symmetrically" })).toBeChecked()
    await editForm.getByRole("combobox", { name: "Distance" }).fill("21 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
    await editForm.getByRole("button", { name: "Cancel" }).click()
    await expect(viewport).toHaveAttribute("data-preview-status", "idle")

    await page.getByRole("treeitem", { name: "Variables" }).click()
    const expression = page.getByRole("combobox", { name: "Variable expression" })
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
    await expect(page.getByRole("combobox", { name: "Variable expression" })).toHaveValue("24 mm")
    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(reopenedForm.getByRole("combobox", { name: "Distance" })).toHaveValue("#depth")
    await expect(
      reopenedForm.getByRole("checkbox", { name: "Extrude symmetrically" }),
    ).toBeChecked()
  })
})
