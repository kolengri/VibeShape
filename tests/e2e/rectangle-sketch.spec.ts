import { expect, test } from "./fixtures"

test.describe("variable-driven rectangle sketch", () => {
  test("creates, solves, edits, persists, and reopens a constrained profile", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("textbox", { name: "Variable expression" }).fill("48 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Create sketch" }).click()
    await expect(page.getByRole("heading", { name: "Create rectangle sketch" })).toBeVisible()
    await page.getByRole("textbox", { name: "Width" }).fill("#width")
    await page.getByRole("textbox", { name: "Height" }).fill("20 mm")
    await page.getByRole("combobox", { name: "Support plane" }).selectOption("xz")
    await expect(
      page.getByRole("img", { name: "Unsaved rectangular sketch preview" }),
    ).toBeVisible()
    await expect(page.getByText("Unsaved preview", { exact: true })).toBeVisible()

    await page
      .getByRole("form", { name: "Create rectangle sketch" })
      .getByRole("button", { name: "Create sketch" })
      .dblclick()
    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await expect(page.getByRole("img", { name: "Solved sketch geometry" })).toBeVisible()
    await expect(page.getByText("Fully constrained", { exact: true })).toBeVisible()
    await expect(page.getByText("Profile: 960 mm² · 136 mm perimeter")).toBeVisible()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Rename", exact: true }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("span")
    await page.getByRole("button", { name: "Rename variable" }).dblclick()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByRole("textbox", { name: "Width" })).toHaveValue("#span")
    await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("20 mm")
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("xz")
    await page.getByRole("textbox", { name: "Height" }).fill("25 mm")
    await page.getByRole("button", { name: "Update sketch" }).dblclick()
    await expect(page.getByText("Profile: 1,200 mm² · 146 mm perimeter")).toBeVisible()

    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByRole("textbox", { name: "Width" })).toHaveValue("#span")
    await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("25 mm")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("img", { name: "Solved sketch geometry" })).toBeVisible()
    await expect(page.getByText("Profile: 1,200 mm² · 146 mm perimeter")).toBeVisible()
  })
})
