import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("offers both exact Split outputs as Hole targets after a real worker rebuild", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeAttached({
    timeout: 90_000,
  })
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Split", exact: true }).click()
  const split = page.getByRole("form", { name: "Split part", exact: true })
  await expect(split.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await split.getByRole("button", { name: "Apply split", exact: true }).click()
  await saved(page)
  await page
    .getByRole("toolbar", { name: "Model commands", exact: true })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page)
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("button", { name: "Hole", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Hole", exact: true }).click()
  const hole = page.getByRole("form", { name: "Hole", exact: true })
  const targetBody = hole.getByRole("combobox", { name: "Target body", exact: true })
  await expect(targetBody.getByRole("option", { name: /split\.negative/ })).toBeAttached()
  await expect(targetBody.getByRole("option", { name: /split\.positive/ })).toBeAttached()
  await targetBody.selectOption({ label: "Split 1 · split.positive" })
  await expect(targetBody.locator("option:checked")).toHaveText("Split 1 · split.positive")
  await hole.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Split 1", exact: true })).toBeVisible()
})
