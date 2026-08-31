import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, selectSketchTool } from "./sketch-helpers"

async function drawProfileAwayFromBothOriginAxes(page: Page) {
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")

  await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.42)
  await page.mouse.click(bounds.x + bounds.width * 0.74, bounds.y + bounds.height * 0.3)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
}

test.describe("selector-backed revolve", () => {
  test("creates, previews, edits, and reopens a graphical sketch-line-axis solid", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    for (const dimension of ["Width", "Depth", "Height"] as const) {
      await boxForm.getByRole("combobox", { name: dimension }).fill("500 mm")
    }
    await boxForm.getByRole("button", { name: "Create box" }).click()

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawProfileAwayFromBothOriginAxes(page)

    await page.getByRole("button", { name: "Revolve selected profile" }).click()
    const form = page.getByRole("form", { name: "Revolve profile" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(form.getByRole("combobox", { name: "Angle" })).toHaveValue("360 deg")
    await expect(viewport).toHaveAttribute("data-sketch-reference-candidate-count", "8")
    await viewport
      .getByRole("combobox", { name: "Select a Revolve axis with the keyboard" })
      .selectOption({ label: "Sketch 1 · Line 1" })
    await expect(form.getByText("Sketch 1 · Line 1")).toBeVisible()

    await form.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await page.getByRole("button", { name: "Revolve selected profile" }).click()
    const reopenedCreateForm = page.getByRole("form", { name: "Revolve profile" })
    await expect(
      reopenedCreateForm.getByText(
        "Click a highlighted sketch line or straight model edge in the 3D viewport, or use X/Y above.",
      ),
    ).toBeVisible()
    await expect(
      reopenedCreateForm.getByRole("button", { name: "Horizontal sketch axis (X)" }),
    ).toHaveAttribute("aria-pressed", "true")
    await viewport
      .getByRole("combobox", { name: "Select a Revolve axis with the keyboard" })
      .selectOption({ label: "Sketch 1 · Line 1" })
    await expect(reopenedCreateForm.getByText("Sketch 1 · Line 1")).toBeVisible()
    await reopenedCreateForm.getByRole("combobox", { name: "Angle" }).fill("180 deg")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
    await reopenedCreateForm.getByRole("button", { name: "Create revolve" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit revolve" })
    await expect(editForm.getByText("Sketch 1 · Line 1")).toBeVisible()
    await expect(editForm.getByRole("combobox", { name: "Angle" })).toHaveValue("180 deg")
    await editForm.getByRole("combobox", { name: "Angle" }).fill("270 deg")
    await editForm.getByRole("combobox", { name: "Result operation" }).selectOption("remove")
    await editForm.getByRole("combobox", { name: "Target body" }).selectOption({ label: "Box 1" })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await editForm.getByRole("button", { name: "Update revolve" }).click()
    await expect(editForm).toHaveCount(0)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit revolve" })
    await expect(reopenedForm.getByRole("combobox", { name: "Angle" })).toHaveValue("270 deg")
    await expect(reopenedForm.getByText("Sketch 1 · Line 1")).toBeVisible()
    await expect(reopenedForm.getByRole("combobox", { name: "Result operation" })).toHaveValue(
      "remove",
    )
    await expect(
      reopenedForm.getByRole("combobox", { name: "Target body" }).locator("option:checked"),
    ).toHaveText("Box 1")
  })

  test("persists a stable straight model-edge axis selected from the viewport", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawProfileAwayFromBothOriginAxes(page)
    await page.getByRole("button", { name: "Revolve selected profile" }).click()

    const form = page.getByRole("form", { name: "Revolve profile" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    const picker = viewport.getByRole("combobox", {
      name: "Select a Revolve axis with the keyboard",
    })
    const modelEdgeOption = picker
      .locator("option")
      .filter({ hasText: /^Box 1 · Edge \d+$/ })
      .first()
    await expect(modelEdgeOption).toBeAttached()
    const optionValue = await modelEdgeOption.getAttribute("value")
    if (!optionValue) throw new Error("The model-edge axis option has no value.")
    const selectedLabel = await modelEdgeOption.textContent()
    if (!selectedLabel) throw new Error("The model-edge axis option has no readable label.")
    await picker.selectOption(optionValue)
    await expect(form.getByText(selectedLabel, { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
    await form.getByRole("button", { name: "Create revolve" }).click()

    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit revolve" }).getByText(selectedLabel, { exact: true }),
    ).toBeVisible()
  })
})
