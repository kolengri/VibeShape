import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

for (const command of ["Extrude", "Revolve"] as const) {
  test(`starts ${command} immediately after finishing a closed sketch`, async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const action = toolbar.getByRole("button", { name: command, exact: true })
    await expect(action).toBeDisabled()
    await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()

    await expect(page.getByRole("treeitem", { name: "Sketch 1", exact: true })).toBeVisible()
    await expect(action).toBeEnabled()
    await action.click()
    const form = page.getByRole("form", { name: `${command} profile`, exact: true })
    await expect(form.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-selected-sketch-profile-count", "1")
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-selected-sketch-profile-count", "0")
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await expect(action).toBeEnabled()
    await action.click()
    await expect(
      page.getByRole("heading", { name: `${command} profile`, exact: true }),
    ).toBeVisible()
    await expect(form).toHaveCount(0)
    await viewport
      .getByRole("combobox", { name: "Select saved profile" })
      .selectOption({ label: "Sketch 1 · Profile 1" })
    await expect(form.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    if (command === "Extrude") {
      await expect(viewport).toHaveAttribute("data-preview-status", "ready")
      await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
      await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    } else {
      await form.getByRole("button", { name: "Cancel", exact: true }).click()
    }
  })
}
