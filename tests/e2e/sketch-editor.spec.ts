import { expect, test } from "./fixtures"
import { addDimension, drawRectangle, selectSketchEntities } from "./sketch-helpers"

test.describe("full sketch editor", () => {
  test("authors every alpha analytical primitive on the canvas", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const clickAt = (horizontal: number, vertical: number) =>
      page.mouse.click(bounds.x + bounds.width * horizontal, bounds.y + bounds.height * vertical)

    await page.getByRole("button", { name: "Point", exact: true }).click()
    await clickAt(0.2, 0.25)
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await clickAt(0.25, 0.7)
    await clickAt(0.45, 0.6)
    const construction = page.getByRole("button", { name: "Construction geometry" })
    await construction.click()
    await expect(construction).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Circle", exact: true }).click()
    await clickAt(0.65, 0.3)
    await clickAt(0.75, 0.3)
    await construction.click()
    await expect(construction).toHaveAttribute("aria-pressed", "false")
    await page.getByRole("button", { name: "Center-point arc", exact: true }).click()
    await clickAt(0.7, 0.7)
    await clickAt(0.8, 0.7)
    await clickAt(0.7, 0.6)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(7)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(1)
    await expect(
      drawing.locator('[data-sketch-entity-type="circle"][stroke-dasharray="6 4"]'),
    ).toHaveCount(1)
  })

  test("draws, constrains, dimensions, edits, persists, and reopens a profile", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("textbox", { name: "Variable expression" }).fill("48 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await page.getByRole("combobox", { name: "Support plane" }).selectOption("xz")
    const drawing = await drawRectangle(page)
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)

    await selectSketchEntities(page, drawing, "point", [0])
    await page.getByRole("button", { name: "Fix point" }).click()
    await selectSketchEntities(page, drawing, "point", [0, 1])
    await addDimension(page, "Horizontal distance", "#width")
    await selectSketchEntities(page, drawing, "point", [1, 2])
    await addDimension(page, "Vertical distance", "20 mm")

    await expect(page.getByText("Fully constrained", { exact: true })).toBeVisible()
    await expect(page.getByText("Profile: 960 mm² · 136 mm perimeter")).toBeVisible()
    await page.getByRole("button", { name: "Finish sketch" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Rename", exact: true }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("span")
    await page.getByRole("button", { name: "Rename variable" }).dblclick()

    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByRole("button", { name: "Extrude selected profile" })).toBeEnabled()
    await page.getByRole("button", { name: "Edit sketch" }).click()
    await expect(page.getByText("Horizontal distance · #span", { exact: true })).toBeVisible()
    const verticalConstraint = page
      .getByRole("listitem")
      .filter({ hasText: "Vertical distance · 20 mm" })
    await verticalConstraint.getByRole("button", { name: "Remove" }).click()
    const editableDrawing = page.getByRole("img", { name: "Editable sketch geometry" })
    await selectSketchEntities(page, editableDrawing, "point", [1, 2])
    await addDimension(page, "Vertical distance", "25 mm")
    await page.getByRole("button", { name: "Finish sketch" }).dblclick()
    await expect(page.getByText("Profile: 1,200 mm² · 146 mm perimeter")).toBeVisible()

    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await page.getByRole("button", { name: "Edit sketch" }).click()
    await expect(page.getByText("Horizontal distance · #span", { exact: true })).toBeVisible()
    await expect(page.getByText("Vertical distance · 25 mm", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("img", { name: "Solved sketch geometry" })).toBeVisible()
  })
})
