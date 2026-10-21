import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("searches FDM tools with artwork, restores focus, and tabs to the selected axis", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Modify", "FDM tools")
  const form = page.getByRole("form", { name: "FDM tools", exact: true })
  const trigger = form.getByRole("combobox", { name: "Tool", exact: true })
  await trigger.click()
  const search = page.getByRole("combobox", { name: "Search options…", exact: true })
  await expect(search).toBeFocused()
  await search.fill("coupon")
  const option = page.getByRole("option", { name: "Calibration coupon", exact: true })
  await expect(option).toBeVisible()
  await expect(option.locator("svg").first()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("fdm-tool-search.png") })
  await page.keyboard.press("Enter")
  await expect(trigger).toContainText("Calibration coupon")
  await expect(trigger).toBeFocused()
  await trigger.click()
  await search.fill("no-matching-tool")
  await expect(page.getByText("No matching options", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(trigger).toContainText("Calibration coupon")
  await trigger.click()
  await page.keyboard.press("Tab")
  await expect(search).not.toBeVisible()
  await expect(form.getByRole("radio", { name: "Z", exact: true })).toBeFocused()
})

test("finds a model by name and type, preserves hidden selection, and restores the tree", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
  const search = tree.getByRole("searchbox", { name: "Search model" })
  await search.fill("Cylinder")
  await tree.getByRole("button", { name: "Parts", exact: true }).click()
  const results = tree.getByRole("tree", { name: "Model search results" })
  await expect(results.getByRole("treeitem")).toHaveCount(1)
  await expect(tree.getByText("1 selected item is outside these results.")).toBeVisible()
  await search.focus()
  await page.keyboard.press("ArrowDown")
  await expect(results.getByRole("treeitem")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(results.getByRole("treeitem")).toHaveAttribute("aria-selected", "true")
  await page.screenshot({ path: test.info().outputPath("model-search.png") })
  await page.keyboard.press("Escape")
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("")
  await expect(results).not.toBeVisible()
  await expect(
    page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
})

test("deletes a filtered model result after confirmation while preserving query editing", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
  const search = tree.getByRole("searchbox", { name: "Search model" })
  await search.fill("Cylinderx")
  await search.press("Backspace")
  await search.press("Delete")
  await expect(search).toHaveValue("Cylinder")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await tree.getByRole("button", { name: "Parts", exact: true }).click()
  const result = tree.getByRole("tree", { name: "Model search results" }).getByRole("treeitem", {
    name: "Cylinder 1",
    exact: true,
  })
  await result.click()
  await result.press("Delete")
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole("button", { name: "Keep selection", exact: true }).click()
  await expect(result).toBeFocused()
  await result.press("Backspace")
  await confirmation.getByRole("button", { name: "Delete selection", exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await saved(page)
  await expect(result).toHaveCount(0)
  await tree.getByRole("button", { name: "Clear model search", exact: true }).click()
  await expect(tree.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
  await expect(tree.getByRole("treeitem", { name: "Part Cylinder 1", exact: true })).toHaveCount(0)
})

for (const theme of ["light", "dark"] as const) {
  test(`searches compact tools with the keyboard in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 512, height: 384 })
    await page.goto("/")
    await saved(page)
    await page.locator("html").evaluate((element, theme) => {
      element.classList.toggle("dark", theme === "dark")
      element.style.colorScheme = theme
    }, theme)
    const trigger = page.getByRole("button", { name: "Modeling actions", exact: true })
    await trigger.focus()
    await page.keyboard.press("ArrowDown")
    const dialog = page.getByRole("dialog", { name: "Modeling actions", exact: true })
    const search = dialog.getByRole("combobox", { name: "Search tools…" })
    await expect(search).toBeFocused()
    await search.fill("Extrude")
    const disabled = dialog.getByRole("option", { name: "Extrude", exact: true })
    await expect(disabled).toHaveAttribute("aria-disabled", "true")
    await expect(disabled).toContainText("Select a closed sketch profile first.")
    await search.fill("unavailable-tool-name")
    await expect(dialog.getByText("No matching tools")).toBeVisible()
    await search.fill("Box")
    await expect(dialog.getByRole("option")).toHaveCount(1)
    await page.screenshot({
      path: test.info().outputPath(`compact-tool-search-${theme}.png`),
      animations: "disabled",
    })
    await page.keyboard.press("Enter")
    await expect(page.getByRole("form", { name: "Create box", exact: true })).toBeVisible()
    await expect(dialog).not.toBeVisible()
  })
}
