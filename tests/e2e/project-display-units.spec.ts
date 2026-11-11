import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane } from "./sketch-helpers"

test.describe("project display units", () => {
  test("applies project units to input, resolved values, viewport copy, and reload", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()

    await openApplicationMenuItem(page, "Settings…")
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
    await dialog.getByRole("tab", { name: "Project units", exact: true }).click()
    await dialog.getByRole("combobox", { name: "Length unit" }).selectOption("in")
    await dialog.getByRole("combobox", { name: "Angle unit" }).selectOption("rad")
    await dialog.getByRole("button", { name: "Apply project units" }).dblclick()
    await dialog.getByRole("button", { name: "Done", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText("Units: in · rad", { exact: true })).toBeVisible()
    // The model viewport no longer shows an XYZ readout (#352); sketch orientation copy carries units.
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()
    await confirmSketchPlane(page, "xy")
    await expect(page.getByText("XY · in", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toHaveCount(0)

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("25.4 mm")
    await expect(page.getByRole("cell", { name: "1 in" })).toBeVisible()
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    const variables = page.getByRole("dialog", { name: "Variables", exact: true })
    await variables
      .getByRole("button", { name: "Done", exact: true })
      .filter({ hasText: "Done" })
      .click()
    await expect(variables).toHaveCount(0)
    await invokeModelCommand(page, "Primitives", "Box")
    const createBox = page.getByRole("form", { name: "Create box" })
    await expect(createBox.getByRole("combobox", { name: "Width" })).toHaveValue(
      "0.787401574803 in",
    )
    await createBox.getByRole("combobox", { name: "Width" }).fill("2")
    await createBox.getByRole("button", { name: "Create box", exact: true }).dblclick()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Width" }),
    ).toHaveValue("2 in")

    await page.reload()
    await expect(page.getByText("Units: in · rad", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("cell", { name: "1 in" })).toBeVisible()
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Width" }),
    ).toHaveValue("2 in")
  })
})
