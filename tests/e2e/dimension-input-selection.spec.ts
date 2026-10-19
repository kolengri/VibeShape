import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("steps focused dimensions with arrows and retains authored units", async ({ page }) => {
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box" })
  const width = form.getByRole("combobox", { name: "Width", exact: true })
  await width.fill("0.1 cm")
  await width.press("ArrowUp")
  await expect(width).toHaveValue("1.1 cm")
  await width.press("ArrowUp")
  await expect(width).toHaveValue("2.1 cm")
  await width.press("ArrowDown")
  await expect(width).toHaveValue("1.1 cm")
  await expect(width).toBeFocused()
  await width.press("Shift+ArrowUp")
  await expect(width).toHaveValue("1.1 cm")
  await width.fill("2 * 10 mm")
  await width.press("ArrowUp")
  await expect(width).toHaveValue("2 * 10 mm")
})

test("replaces the number on first click and Tab while retaining units", async ({ page }) => {
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box" })
  const width = form.getByRole("combobox", { name: "Width", exact: true })
  const depth = form.getByRole("combobox", { name: "Depth", exact: true })
  await width.fill("20 mm")
  await depth.fill("30 mm")
  const bounds = await width.boundingBox()
  if (!bounds) throw new Error("The width input has no bounds.")
  await width.click({ position: { x: bounds.width - 8, y: bounds.height / 2 } })
  await expect
    .poll(() =>
      width.evaluate((input) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
      ),
    )
    .toBe("20")
  await page.keyboard.type("45")
  await expect(width).toHaveValue("45 mm")
  await page.keyboard.press("Tab")
  await expect(depth).toBeFocused()
  await expect
    .poll(() =>
      depth.evaluate((input) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
      ),
    )
    .toBe("30")
  await page.keyboard.type("15")
  await expect(depth).toHaveValue("15 mm")
  // A subsequent click in the focused field must permit ordinary caret placement.
  const depthBounds = await depth.boundingBox()
  if (!depthBounds) throw new Error("The depth input has no bounds.")
  await depth.click({ position: { x: depthBounds.width - 8, y: depthBounds.height / 2 } })
  await expect
    .poll(() => depth.evaluate((input) => input.selectionStart === input.selectionEnd))
    .toBe(true)
  await expect(depth).toHaveValue("15 mm")
})
