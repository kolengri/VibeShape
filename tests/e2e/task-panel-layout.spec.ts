import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("retains compact task state while scrolling and opens a fresh task at its beginning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 760 })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const form = page.getByRole("form", { name: "Create cylinder", exact: true })
  const task = page.getByRole("complementary", { name: "Task panel", exact: true })
  await expect(form).toBeVisible()
  await form.getByRole("combobox", { name: "Height", exact: true }).fill("23 mm")
  await task.evaluate((element) => {
    element.scrollTop = 300
  })
  await expect.poll(() => task.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)
  await expect(form.getByRole("heading", { name: "Create cylinder", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("compact-task-scrolled.png") })
  await page.getByRole("button", { name: "Collapse task panel", exact: true }).click()
  await expect(form).toBeHidden()
  await page.getByRole("button", { name: "Open task panel", exact: true }).click()
  await expect(form).toBeVisible()
  await expect(form.getByRole("combobox", { name: "Height", exact: true })).toHaveValue("23 mm")
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(form).toBeVisible()
  await page.setViewportSize({ width: 960, height: 760 })
  await expect(form).toBeVisible()
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(form).toHaveCount(0)
  await invokeModelCommand(page, "Primitives", "Cylinder")
  await expect(form).toBeVisible()
  await expect.poll(() => task.evaluate((element) => element.scrollTop)).toBe(0)
})

test("keeps variable rows compact and scrolls the table inside its dialog", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Variables", exact: true })
  for (let i = 0; i < 10; i += 1) {
    await dialog.getByRole("button", { name: "Add variable", exact: true }).click()
    await dialog
      .getByRole("textbox", { name: "Variable name", exact: true })
      .last()
      .fill(`size${i}`)
    await dialog
      .getByRole("combobox", { name: "Variable expression", exact: true })
      .last()
      .fill(i === 1 ? "#size0 + 1 mm" : `${10 + i} mm`)
  }
  await dialog.getByRole("button", { name: "Apply variables", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply variables", exact: true })).toBeDisabled()
  await dialog.getByRole("button", { name: "Done", exact: true }).last().click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  const table = dialog.getByRole("table")
  await expect(table.getByRole("row")).toHaveCount(11)
  await expect(
    table.getByRole("row").nth(1).getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled()
  const dimensions = await table.evaluate((element) => {
    const scroller = element.parentElement
    if (!scroller) throw new Error("Expected the variable table scroller")
    return {
      height: scroller.clientHeight,
      content: scroller.scrollHeight,
      rowHeights: [...element.querySelectorAll("tbody tr")].map(
        (row) => row.getBoundingClientRect().height,
      ),
    }
  })
  expect(dimensions.height).toBeLessThanOrEqual(320)
  expect(dimensions.content).toBeGreaterThan(dimensions.height)
  for (const height of dimensions.rowHeights) expect(height).toBeLessThanOrEqual(60)
  await page.screenshot({ path: test.info().outputPath("compact-variable-table.png") })
})
