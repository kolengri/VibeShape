import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { drawRectangle } from "./sketch-helpers"

async function selectFeatureFace(page: Page, featureLabel: string) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
  const statusBar = page.locator("footer[role='status']")
  const samples = [
    { x: bounds.width * 0.5, y: bounds.height * 0.5 },
    { x: bounds.width * 0.4, y: bounds.height * 0.55 },
    { x: bounds.width * 0.6, y: bounds.height * 0.55 },
    { x: bounds.width * 0.5, y: bounds.height * 0.3 },
  ]
  let sampleIndex = 0
  await expect
    .poll(async () => {
      await canvas.click({
        position: samples[sampleIndex % samples.length] as (typeof samples)[number],
      })
      sampleIndex += 1
      return statusBar.textContent()
    })
    .toMatch(new RegExp(`Selection: ${featureLabel} · Face \\d+`))
}

test.describe("datum plane reference geometry", () => {
  test("creates, edits, hides, and uses an offset plane as a sketch support", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Datum plane" }).click()
    const createForm = page.getByRole("form", { name: "Create datum plane" })
    await createForm.getByRole("combobox", { name: "Support" }).selectOption("xz")
    await createForm.getByRole("combobox", { name: "Offset" }).fill("14 mm")
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(page.getByText("Unsaved datum plane preview", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Datum plane 1" })).not.toBeVisible()
    await createForm.getByRole("button", { name: "Create datum plane" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Datum plane 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page.getByRole("button", { name: "Hide Datum plane 1" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await page.getByRole("button", { name: "Show Datum plane 1" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")

    await page.getByRole("treeitem", { name: "Datum plane 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit datum plane" })
    await expect(editForm.getByRole("combobox", { name: "Support" })).toHaveValue("xz")
    await editForm.getByRole("combobox", { name: "Offset" }).fill("16 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await editForm.getByRole("button", { name: "Update datum plane" }).click()
    await expect(viewport).toHaveAttribute("data-preview-status", "idle")

    await selectFeatureFace(page, "Datum plane 1")

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("feature-face")
    await drawRectangle(page)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Extrude", exact: true })
      .click()
    await page
      .getByRole("form", { name: "Extrude profile" })
      .getByRole("button", { name: "Create extrusion" })
      .click()

    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })
  })

  test("offsets a reusable plane from a selected planar feature face", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await selectFeatureFace(page, "Box 1")

    await toolbar.getByRole("button", { name: "Datum plane" }).click()
    const form = page.getByRole("form", { name: "Create datum plane" })
    await expect(form.getByRole("combobox", { name: "Support" })).toBeDisabled()
    await expect(form.getByRole("combobox", { name: "Support" })).toHaveText("Selected model face")
    await form.getByRole("combobox", { name: "Offset" }).fill("8 mm")
    await form.getByRole("button", { name: "Create datum plane" }).click()

    await expect(page.getByRole("treeitem", { name: "Datum plane 1" })).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "2",
      { timeout: 120_000 },
    )
  })
})
