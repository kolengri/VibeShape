import { expect, test } from "./fixtures"

test.describe("Box parameters", () => {
  test("creates and reopens a Box driven by a document variable", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
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
    const canvasBounds = await viewport.locator("canvas").boundingBox()
    if (!canvasBounds) throw new Error("The geometry canvas has no measurable bounds.")
    const statusBar = page.locator("footer[role='status']")
    await expect
      .poll(async () => {
        await viewport.locator("canvas").click({
          position: { x: canvasBounds.width / 2, y: canvasBounds.height / 2 },
        })
        return statusBar.textContent()
      })
      .toMatch(/Selection: Box 1 · Face \d+/)
    await viewport.getByRole("button", { name: "Clear selection" }).click()
    await expect(statusBar).toContainText("Selection: None")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Box 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit box" })
    await expect(editForm.getByRole("textbox", { name: "Width" })).toHaveValue("#width")
    await editForm.getByRole("textbox", { name: "Depth" }).fill("28 mm")
    await editForm.getByRole("button", { name: "Update box" }).dblclick()
    await expect(editForm).not.toBeVisible()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await page.getByRole("treeitem", { name: "Box 1" }).click()
    const reopenedEditForm = page.getByRole("form", { name: "Edit box" })
    await expect(reopenedEditForm.getByRole("textbox", { name: "Width" })).toHaveValue("#width")
    await expect(reopenedEditForm.getByRole("textbox", { name: "Depth" })).toHaveValue("28 mm")

    await reopenedEditForm.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    const committedName = page.getByRole("textbox", { name: "Variable name" })
    await expect(committedName).toBeDisabled()
    await page.getByRole("button", { name: "Rename", exact: true }).click()
    await expect(committedName).toBeFocused()
    await committedName.fill("span")
    await page.getByRole("button", { name: "Rename variable" }).dblclick()
    await expect(committedName).toHaveValue("span")
    await expect(committedName).toBeDisabled()

    await page.getByRole("treeitem", { name: "Box 1" }).click()
    const renamedEditForm = page.getByRole("form", { name: "Edit box" })
    await expect(renamedEditForm.getByRole("textbox", { name: "Width" })).toHaveValue("#span")
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")

    await page.reload()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable name" })).toHaveValue("span")
    await page.getByRole("treeitem", { name: "Box 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("textbox", { name: "Width" }),
    ).toHaveValue("#span")
  })
})
