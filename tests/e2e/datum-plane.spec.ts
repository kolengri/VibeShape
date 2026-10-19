import type { Page } from "@playwright/test"
import { datumPlaneParametersSchema } from "../../packages/domain/src/reference-geometry"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { drawRectangle } from "./sketch-helpers"

async function selectFeatureFace(page: Page, featureLabel: string) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
  const statusBar = page.locator("main > footer")
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
  test("groups angled planes and preserves their angle through edit, undo, reload and native backup", async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.goto("/")
    const browser = page.getByRole("complementary", { name: "Model tree" })
    const plane = browser.getByRole("treeitem", { name: "Datum plane 1", exact: true })
    await invokeModelCommand(page, "Create", "Datum plane")
    const create = page.getByRole("form", { name: "Create datum plane", exact: true })
    await create.getByRole("combobox", { name: "Rotation axis", exact: true }).selectOption("y")
    await create.getByRole("combobox", { name: "Angle", exact: true }).fill("45 deg")
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-preview-status",
      "ready",
      { timeout: 120_000 },
    )
    await create.getByRole("button", { name: "Create datum plane", exact: true }).click()
    await saved(page)
    await expect(browser.getByRole("treeitem", { name: "Planes", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    for (const name of ["XY", "XZ", "YZ"])
      await expect(browser.getByRole("treeitem", { name, exact: true })).toBeVisible()
    await expect(plane).toBeVisible()
    const created = await saveProject(page)
    const feature = created.project.snapshot.features.find(({ label }) => label === "Datum plane 1")
    if (!feature) throw new Error("The saved project is missing its datum plane.")
    const parameters = datumPlaneParametersSchema.parse(feature.parameters)
    expect(parameters.rotation?.axis).toBe("y")
    expect(parameters.rotation?.angle.value).toBeCloseTo(Math.PI / 4, 12)
    await plane.click()
    const edit = page.getByRole("form", { name: "Edit datum plane", exact: true })
    await expect(edit.getByRole("combobox", { name: "Angle", exact: true })).toHaveValue("45 deg")
    await edit.getByRole("combobox", { name: "Angle", exact: true }).fill("-30 deg")
    await edit.getByRole("button", { name: "Update datum plane", exact: true }).click()
    await saved(page)
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await saved(page)
    await plane.click()
    await expect(edit.getByRole("combobox", { name: "Angle", exact: true })).toHaveValue("45 deg")
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await saved(page)
    await page.reload()
    await plane.click()
    await expect(edit.getByRole("combobox", { name: "Angle", exact: true })).toHaveValue("-30 deg")
    await expect(edit.getByRole("combobox", { name: "Rotation axis", exact: true })).toHaveValue(
      "y",
    )
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    const backup = await saveProject(page)
    await openProject(page, backup)
    await expect(plane).toBeVisible()
    const reopened = await saveProject(page)
    const restored = reopened.project.snapshot.features.find(({ id }) => id === feature.id)
    expect(restored?.parameters).toEqual(
      backup.project.snapshot.features.find(({ id }) => id === feature.id)?.parameters,
    )
  })

  test("creates, edits, hides, and uses an offset plane as a sketch support", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()

    await invokeModelCommand(page, "Create", "Datum plane")
    const createForm = page.getByRole("form", { name: "Create datum plane" })
    await createForm.getByRole("combobox", { name: "Support" }).selectOption("xz")
    await createForm.getByRole("combobox", { name: "Offset" }).fill("14 mm")
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(page.getByText("Unsaved datum plane preview", { exact: true })).toBeVisible()
    await expect(
      page
        .getByRole("complementary", { name: "Model tree" })
        .getByRole("treeitem", { name: "Datum plane 1" }),
    ).not.toBeVisible()
    await createForm.getByRole("button", { name: "Create datum plane" }).dblclick()

    await expect(
      page
        .getByRole("complementary", { name: "Model tree" })
        .getByRole("treeitem", { name: "Datum plane 1" }),
    ).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page
      .getByRole("complementary", { name: "Model tree" })
      .getByRole("button", { name: "Hide Datum plane 1" })
      .click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await page
      .getByRole("complementary", { name: "Model tree" })
      .getByRole("button", { name: "Show Datum plane 1" })
      .click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")

    await page
      .getByRole("complementary", { name: "Model tree" })
      .getByRole("treeitem", { name: "Datum plane 1" })
      .click()
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

    await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })
  })

  test("offsets a reusable plane from a selected planar feature face", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await selectFeatureFace(page, "Box 1")

    await invokeModelCommand(page, "Create", "Datum plane")
    const form = page.getByRole("form", { name: "Create datum plane" })
    await expect(form.getByRole("combobox", { name: "Support" })).toBeDisabled()
    await expect(form.getByRole("combobox", { name: "Support" })).toHaveText("Selected model face")
    await form.getByRole("combobox", { name: "Offset" }).fill("8 mm")
    await form.getByRole("button", { name: "Create datum plane" }).click()

    await expect(
      page
        .getByRole("complementary", { name: "Model tree" })
        .getByRole("treeitem", { name: "Datum plane 1" }),
    ).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "2",
      { timeout: 120_000 },
    )
  })
})
