import type { Locator, Page } from "@playwright/test"
import { readCoilFeatureParameters } from "../../packages/domain/src/part-design-coil"
import { readSweepFeatureParametersV2 } from "../../packages/domain/src/part-design-sweep"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, selectSketchTool } from "./sketch-helpers"

type ScreenMatrix = { a: number; b: number; c: number; d: number; e: number; f: number }
async function clickSketchPoint(page: Page, drawing: Locator, x: number, y: number) {
  const position = await drawing.locator("[data-sketch-plane-projection]").evaluate(
    (element, point) => {
      const geometry = element as unknown as { getScreenCTM?: () => ScreenMatrix | null }
      const matrix = geometry.getScreenCTM?.()
      if (!matrix) throw new Error("The sketch must expose its real drawing projection.")
      return {
        x: matrix.a * point.x - matrix.c * point.y + matrix.e,
        y: matrix.b * point.x - matrix.d * point.y + matrix.f,
      }
    },
    { x, y },
  )
  await page.mouse.click(position.x, position.y)
}

test("creates a coil, edits it, undoes, redoes and reopens the native project", async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto("/")
  await saved(page)
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await invokeModelCommand(page, "Create", "Coil")
  let form = page.getByRole("form", { name: "Coil", exact: true })
  await expect(form).toBeVisible()
  const pitch = form.getByRole("combobox", { name: "Pitch", exact: true })
  await pitch.fill("1.5 mm")
  await expect(form.getByText(/Increase the pitch above 2\.002 mm/)).toBeVisible()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await pitch.fill("4 mm")
  await form.getByRole("radio", { name: "Left-hand", exact: true }).check()
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Apply feature", exact: true }).dblclick()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Coil 1", exact: true })).toBeVisible()
  const created = await saveProject(page)
  const coils = created.project.snapshot.features.filter((feature) =>
    readCoilFeatureParameters(feature),
  )
  expect(coils).toHaveLength(1)
  const coil = coils[0]
  if (!coil) throw new Error("The coil must be saved once.")
  expect(readCoilFeatureParameters(coil)).toMatchObject({
    handedness: "left",
    operation: "new",
    pitch: { value: 4 },
  })

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Coil 1", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Coil 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit coil", exact: true })
  await form.getByRole("combobox", { name: "Helix radius", exact: true }).fill("12 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await saved(page)
  const edited = await saveProject(page)
  await page.reload()
  await saved(page)
  await openProject(page, edited)
  await saved(page)
  const reopened = await saveProject(page)
  const restored = reopened.project.snapshot.features.find(({ id }) => id === coil.id)
  expect(restored && readCoilFeatureParameters(restored)?.radius.value).toBe(12)
  await page.getByRole("treeitem", { name: "Coil 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit coil", exact: true })
  await expect(form.getByRole("combobox", { name: "Helix radius", exact: true })).toHaveValue(
    "12 mm",
  )
  await expect(form.getByRole("radio", { name: "Left-hand", exact: true })).toBeChecked()
})

test("sweeps a sketch profile along a helix, undoes, redoes and reopens it", async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  await clickSketchPoint(page, drawing, -1.5, -1.5)
  await clickSketchPoint(page, drawing, 1.5, 1.5)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)

  await invokeModelCommand(page, "Create", "Sweep")
  let form = page.getByRole("form", { name: "Sweep profile", exact: true })
  await form.getByRole("radio", { name: "Helix", exact: true }).check()
  await form
    .getByRole("combobox", { name: "Profile", exact: true })
    .selectOption({ label: "Sketch 1 · Profile 1" })
  // The helix tangent at its start is +Z at the XY origin: axis (2πR, 0, p), start radial +Y.
  await form.getByRole("combobox", { name: "Helix radius", exact: true }).fill("20 mm")
  await form.getByRole("combobox", { name: "Pitch", exact: true }).fill("10 mm")
  await form.getByRole("combobox", { name: "Turns", exact: true }).fill("2")
  await form.getByLabel("Reference source").selectOption("explicit")
  await form.getByRole("spinbutton", { name: "Origin Y (mm)", exact: true }).fill("-20")
  await form
    .getByRole("spinbutton", { name: "Direction X", exact: true })
    .fill(String(40 * Math.PI))
  await form.getByRole("spinbutton", { name: "Direction Z", exact: true }).fill("10")
  await expect(form.getByText(/^Required profile plane tilt \(lead angle\): 4\.55/)).toBeVisible()
  const apply = form.getByRole("button", { name: "Apply feature", exact: true })
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.click()
  await saved(page)
  const created = await saveProject(page)
  const sweep = created.project.snapshot.features.find((feature) =>
    readSweepFeatureParametersV2(feature),
  )
  if (!sweep) throw new Error("The helical Sweep must be saved as version 2.")
  expect(sweep.type.schemaVersion).toBe(2)
  expect(readSweepFeatureParametersV2(sweep)?.path).toMatchObject({
    kind: "helix",
    radius: { value: 20 },
    extent: { kind: "turns", turns: { value: 2 } },
  })

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Sweep 1", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  await openProject(page, created)
  await saved(page)
  await page.getByRole("treeitem", { name: "Sweep 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit sweep", exact: true })
  await expect(form.getByRole("radio", { name: "Helix", exact: true })).toBeChecked()
  await expect(form.getByRole("combobox", { name: "Helix radius", exact: true })).toHaveValue(
    "20 mm",
  )
})
