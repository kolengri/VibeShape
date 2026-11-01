import { expect, test } from "./fixtures"
import { closeVariablesDialog } from "./variables-ui-support"

test("saves a slider template, applies a configuration and restores it after reload and Undo", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto("/")
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Add variable", exact: true }).click()
  await page.getByRole("textbox", { name: "Variable name", exact: true }).fill("width")
  await page.getByRole("combobox", { name: "Variable expression", exact: true }).fill("20 mm")
  await page.getByRole("button", { name: "Apply variables", exact: true }).click()
  await page.getByRole("button", { name: "Customizer", exact: true }).click()
  await page.getByText("Configure sliders", { exact: true }).click()
  await page.getByRole("checkbox", { name: "Expose width", exact: true }).check()
  await page.getByRole("spinbutton", { name: "Maximum", exact: true }).fill("100")
  await page.getByRole("textbox", { name: "Group", exact: true }).fill("Size")
  await page.getByRole("button", { name: "Apply customizer changes", exact: true }).click()
  await expect(page.getByRole("slider", { name: "width (mm)", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Configuration name", exact: true }).fill("Small")
  await page.getByRole("button", { name: "Save current configuration", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Apply configuration Small", exact: true }),
  ).toBeVisible()
  await page.getByRole("spinbutton", { name: "Value for width", exact: true }).fill("40")
  await page.getByRole("button", { name: "Apply customizer changes", exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "Value for width", exact: true })).toHaveValue(
    "40",
  )
  await closeVariablesDialog(page)
  await page.reload()
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Customizer", exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "Value for width", exact: true })).toHaveValue(
    "40",
  )
  await page.getByRole("button", { name: "Apply configuration Small", exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "Value for width", exact: true })).toHaveValue(
    "20",
  )
  await closeVariablesDialog(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Customizer", exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "Value for width", exact: true })).toHaveValue(
    "40",
  )
})
