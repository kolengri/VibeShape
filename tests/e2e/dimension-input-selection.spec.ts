import { expect, test } from "./fixtures"

test("replaces the number on first click and Tab while retaining units", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Box", exact: true })
    .click()
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
