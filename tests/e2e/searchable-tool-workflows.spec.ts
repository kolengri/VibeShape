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
  // Results are grouped by type; the Parts group holds the matching part.
  const results = tree.getByRole("tree", { name: "Model search results" })
  const part = results.getByRole("group", { name: "Parts", exact: true }).getByRole("treeitem")
  await expect(part).toHaveCount(1)
  await expect(part).toHaveAccessibleName("Cylinder 1")
  await expect(tree.getByText("1 selected item is outside these results.")).toBeVisible()
  await search.focus()
  await page.keyboard.press("ArrowDown")
  await expect(part).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(part).toHaveAttribute("aria-selected", "true")
  await page.screenshot({ path: test.info().outputPath("model-search.png") })
  await page.keyboard.press("Escape")
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("")
  await expect(results).not.toBeVisible()
  await expect(
    page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
})

test("finds hidden origin planes through search and replaces authored selection", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
  await tree.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  const planeGroup = tree.getByRole("treeitem", { name: "Planes", exact: true })
  await planeGroup.click()
  await tree.getByRole("button", { name: "Hide XZ", exact: true }).click()
  await planeGroup.click()
  const search = tree.getByRole("searchbox", { name: "Search model" })
  await search.focus()
  const results = tree.getByRole("tree", { name: "Model search results" })
  await search.fill("xz")
  // The hidden origin plane is still found, in the Planes group.
  const result = results
    .getByRole("group", { name: "Planes", exact: true })
    .getByRole("treeitem", { name: "XZ", exact: true })
  await expect(result).toBeVisible()
  await search.press("ArrowDown")
  await expect(result).toBeFocused()
  await result.press("Enter")
  await expect(result).toHaveAttribute("aria-selected", "true")
  await result.press("Delete")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await page.screenshot({
    path: test.info().outputPath("origin-plane-search.png"),
    animations: "disabled",
  })
  await result.press("Escape")
  await expect(search).toBeFocused()
  await planeGroup.click()
  await expect(tree.getByRole("treeitem", { name: "XZ", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(tree.getByRole("button", { name: "Hide XZ", exact: true })).toBeVisible()
  await expect(tree.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
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
  const result = tree
    .getByRole("tree", { name: "Model search results" })
    .getByRole("group", { name: "Parts", exact: true })
    .getByRole("treeitem", { name: "Cylinder 1", exact: true })
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
    // Large toolbar categories open a searchable picker from the keyboard.
    const toolbar = page.getByRole("toolbar", { name: "Model commands", exact: true })
    const modify = toolbar.getByRole("button", { name: "Modify", exact: true })
    await modify.focus()
    await page.keyboard.press("ArrowDown")
    const modifyDialog = page.getByRole("dialog", { name: "Modify", exact: true })
    const modifySearch = modifyDialog.getByRole("combobox", { name: "Search tools…" })
    await expect(modifySearch).toBeFocused()
    await modifySearch.fill("Chamfer")
    const disabled = modifyDialog.getByRole("option", { name: "Chamfer", exact: true })
    await expect(disabled).toHaveAttribute("aria-disabled", "true")
    await expect(disabled).toContainText("Create an eligible solid first.")
    await modifySearch.fill("unavailable-tool-name")
    await expect(modifyDialog.getByText("No matching tools")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(modify).toBeFocused()
    // Primitives fits a plain menu (Box is promoted beside it); the keyboard opens and activates it.
    const primitives = toolbar.getByRole("button", { name: "Primitives", exact: true })
    await primitives.focus()
    await page.keyboard.press("ArrowDown")
    const cylinder = page.getByRole("menuitem", { name: "Cylinder", exact: true })
    await expect(cylinder).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath(`compact-tool-search-${theme}.png`),
      animations: "disabled",
    })
    await cylinder.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("form", { name: "Create cylinder", exact: true })).toBeVisible()
    await expect(cylinder).not.toBeVisible()
  })
}
