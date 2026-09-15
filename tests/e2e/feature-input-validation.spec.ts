import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("rejects invalid Extrude dimensions without changing the saved model", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  const distance = form.getByRole("combobox", { name: "Distance", exact: true })
  const create = form.getByRole("button", { name: "Create extrusion", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  for (const invalid of ["not a length", "0 mm"]) {
    await distance.fill(invalid)
    await expect(create).toBeDisabled()
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "0")
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toHaveCount(0)
  }
  await distance.fill("12 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await create.click()
  const feature = page.getByRole("treeitem", { name: "Extrusion 1", exact: true })
  await expect(feature).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", { timeout: 30_000 })
  await feature.click()
  const edit = page.getByRole("form", { name: "Edit extrusion", exact: true })
  await edit.getByRole("combobox", { name: "Distance", exact: true }).fill("0 mm")
  await expect(edit.getByRole("button", { name: "Update extrusion", exact: true })).toBeDisabled()
  await expect(viewport).toHaveAttribute("data-preview-feature-count", "0")
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await edit.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await feature.click()
  await expect(edit.getByRole("combobox", { name: "Distance", exact: true })).toHaveValue("12 mm")
})
