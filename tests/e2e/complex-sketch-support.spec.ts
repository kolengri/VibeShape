import type { Page } from "@playwright/test"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

async function standardView(page: Page, name: "Top" | "Front") {
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

async function confirmPickedSketchSupport(page: Page) {
  const chooser = page.getByRole("listbox", { name: "Select sketch support", exact: true })
  if (await chooser.isVisible()) await chooser.getByRole("option").first().click()
  await expect(
    page.getByRole("img", { name: "Editable sketch geometry", exact: true }),
  ).toBeVisible()
}

async function pickSupport(page: Page, label: string, selecting: boolean) {
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The committed solid has no visible canvas.")
  const hint = page.getByText(new RegExp(`^Click to sketch on ${label} · Face \\d+$`))
  for (const y of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    for (const x of [0.4, 0.6, 0.3, 0.7, 0.5]) {
      const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y }
      await page.mouse.move(point.x, point.y)
      await page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
      if (selecting && !(await hint.isVisible())) continue
      await page.mouse.click(point.x, point.y)
      if (selecting) {
        await confirmPickedSketchSupport(page)
        return
      }
      if (
        await page
          .locator("main footer:visible")
          .getByText(new RegExp(`Selection: ${label} · Face \\d+`))
          .isVisible()
      )
        return
    }
  }
  throw new Error(`No planar support on ${label} was pickable in the current view.`)
}

async function cutBox(page: Page) {
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  for (const [name, value] of [
    ["Width", "24 mm"],
    ["Depth", "18 mm"],
    ["Height", "12 mm"],
  ] as const)
    await box.getByRole("combobox", { name, exact: true }).fill(value)
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(box).toHaveCount(0)
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const cylinder = page.getByRole("form", { name: "Create cylinder", exact: true })
  await cylinder.getByRole("combobox", { name: "Radius", exact: true }).fill("3 mm")
  await cylinder.getByRole("combobox", { name: "Height", exact: true }).fill("30 mm")
  await cylinder
    .getByRole("checkbox", { name: "Center height about placement origin", exact: true })
    .check()
  await cylinder.getByRole("button", { name: "Create cylinder", exact: true }).click()
  await expect(cylinder).toHaveCount(0)
  await invokeModelCommand(page, "Modify", "Subtract")
  const subtract = page.getByRole("form", { name: "Subtract solids", exact: true })
  await expect(
    subtract.getByRole("button", { name: "Select Target solid in 3D", exact: true }),
  ).toHaveText("Box 1")
  await expect(
    subtract.getByRole("button", { name: "Select Tool solid in 3D", exact: true }),
  ).toHaveText("Cylinder 1")
  await subtract.getByRole("button", { name: "Subtract", exact: true }).click()
  await expect(subtract).toHaveCount(0)
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "idle")
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await saved(page)
}

for (const view of ["Top", "Front"] as const) {
  test(`authors and reopens a sketch on a complex planar support in ${view} view`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await cutBox(page)
    await standardView(page, view)
    await invokeModelCommand(page, "Create", "Create sketch")
    await pickSupport(page, "Subtract 1", true)
    await expect(page.getByRole("combobox", { name: "Support plane", exact: true })).toHaveValue(
      "feature-face",
    )
    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await saved(page)
    const archive = await saveProject(page)
    const support = archive.project.snapshot.sketches[0]?.support
    const owner = archive.project.snapshot.features.find(({ label }) => label === "Subtract 1")
    expect(owner).toBeDefined()
    expect(support).toMatchObject({
      kind: "feature-face",
      reference: {
        featureId: owner?.id,
        signature: { geometryClass: "PLANE", directionMode: "oriented" },
      },
    })
    expect(support?.reference.semanticRole).toBeUndefined()
    expect(support?.reference.intent).toBeUndefined()
    expect(support?.reference).not.toHaveProperty("meshFaceId")
    expect(support?.reference).not.toHaveProperty("candidateId")
    await page.reload()
    await saved(page)
    await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
    const drawing = page.getByRole("img", { name: "Editable sketch geometry", exact: true })
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await expect(
      page.getByRole("combobox", { name: "Support plane", exact: true }).locator("option:checked"),
    ).toHaveText(/Subtract 1 · Face \d+/)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await invokeModelCommand(page, "Create", "Extrude")
    const extrude = page.getByRole("form", { name: "Extrude profile", exact: true })
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const profile = viewport.getByRole("combobox", { name: "Select saved profile", exact: true })
    if ((await viewport.getAttribute("data-selected-sketch-profile-count")) === "0")
      await profile.selectOption({ label: "Sketch 1 · Profile 1" })
    await extrude.getByRole("combobox", { name: "Distance", exact: true }).fill("2 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await extrude.getByRole("button", { name: "Create extrusion", exact: true }).click()
    await expect(extrude).toHaveCount(0)
    await expect(viewport).toHaveAttribute("data-preview-status", "idle")
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await saved(page)
  })
}

test("previews and persists a datum on a complex planar support from an extrusion side", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await invokeModelCommand(page, "Create", "Create sketch")
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await invokeModelCommand(page, "Create", "Extrude")
  const extrude = page.getByRole("form", { name: "Extrude profile", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const profile = viewport.getByRole("combobox", { name: "Select saved profile", exact: true })
  if ((await viewport.getAttribute("data-selected-sketch-profile-count")) === "0")
    await profile.selectOption({ label: "Sketch 1 · Profile 1" })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  await extrude.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(extrude).toHaveCount(0)
  await expect(viewport).toHaveAttribute("data-preview-status", "idle")
  await standardView(page, "Front")
  await pickSupport(page, "Extrusion 1", false)
  await invokeModelCommand(page, "Create", "Datum plane")
  const datum = page.getByRole("form", { name: "Create datum plane", exact: true })
  await expect(
    datum.getByRole("combobox", { name: "Support", exact: true }).locator("option:checked"),
  ).toHaveText("Selected model face")
  await datum.getByRole("combobox", { name: "Offset", exact: true }).fill("3 mm")
  await datum.getByRole("combobox", { name: "Angle", exact: true }).fill("30 deg")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  await datum.getByRole("button", { name: "Create datum plane", exact: true }).click()
  await expect(datum).toHaveCount(0)
  await saved(page)
  const archive = await saveProject(page)
  const savedDatum = archive.project.snapshot.features.find(
    ({ label }) => label === "Datum plane 1",
  )
  expect(savedDatum?.references[0]?.semanticRole).toMatch(/^extrusion\.side\./)
  await page.reload()
  await saved(page)
  await expect(
    page
      .getByRole("complementary", { name: "Model tree", exact: true })
      .getByRole("treeitem", { name: "Datum plane 1", exact: true }),
  ).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
})
