import { expect, test } from "./fixtures"

test.describe("Box parameters", () => {
  test("creates and reopens a Box driven by a document variable", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("textbox", { name: "Variable expression" }).fill("24 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", {
        name: "Box",
        exact: true,
      })
      .click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    await expect(boxForm).toBeVisible()
    await boxForm.getByRole("textbox", { name: "Width" }).fill("#width")
    await boxForm.getByRole("button", { name: "Create box" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(viewport.getByRole("button", { name: "Fit view" })).toBeVisible()
    await expect
      .poll(() =>
        viewport.locator("canvas").evaluate((canvas) => {
          const element = canvas as unknown as {
            width: number
            height: number
            getContext: (type: "webgl2") => unknown
          }
          return element.width > 0 && element.height > 0 && element.getContext("webgl2") !== null
        }),
      )
      .toBe(true)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  })
})
