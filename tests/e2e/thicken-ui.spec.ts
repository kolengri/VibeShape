import type { Page } from "@playwright/test"
import { boxFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { readPressPullFeatureParameters } from "../../packages/domain/src/part-design-press-pull"
import { readThickenFeatureParameters } from "../../packages/domain/src/part-design-thicken"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

type SavedProject = Awaited<ReturnType<typeof saveProject>>

async function undoRedoReopen(page: Page, before: SavedProject, applied: SavedProject) {
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    before.project.snapshot.features,
  )
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.features).toEqual(applied.project.snapshot.features)
  await openProject(page, reloaded)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.features).toEqual(reloaded.project.snapshot.features)
  expect(imported.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  return imported
}

test("thickens the top face of a part into a new body, undoes, redoes and reopens it", async ({
  page,
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const before = await saveProject(page)
  const box = before.project.snapshot.features.find(({ label }) => label === "Box 1")
  const height = boxFeatureParametersSchema.parse(box?.parameters).height.value
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Thicken", exact: true }).click()
  const form = page.getByRole("form", { name: "Thicken", exact: true })
  const apply = form.getByRole("button", { name: "Apply thicken", exact: true })
  await expect(apply).toBeDisabled()
  await form.locator("summary").click()
  // The top face is the catalogue row whose center lies at the box height.
  const topCenter = `, ${height.toFixed(2)}) mm`
  let checked = 0
  for (const face of await form.getByRole("checkbox").all()) {
    const name = (await face.getAttribute("aria-label")) ?? (await face.evaluate(labelText))
    if (!name.endsWith(topCenter)) continue
    await face.check()
    checked += 1
  }
  expect(checked).toBe(1)
  await form.getByRole("combobox", { name: "Thickness", exact: true }).fill("3 mm")
  await form.getByRole("radio", { name: "Both sides, split evenly", exact: true }).check()
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.click()
  await saved(page)
  const applied = await saveProject(page)
  const thicken = applied.project.snapshot.features.find((feature) =>
    readThickenFeatureParameters(feature),
  )
  if (!thicken) throw new Error("An authored Thicken must be saved.")
  expect(readThickenFeatureParameters(thicken)).toMatchObject({
    thickness: { value: 3 },
    side: "symmetric",
    operation: "new",
  })
  expect(JSON.stringify(thicken.parameters)).not.toContain("candidateId")
  // New keeps the source part and adds one independent part for the thickened body.
  expect(applied.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 1)
  const imported = await undoRedoReopen(page, before, applied)
  await page.getByRole("treeitem", { name: "Thicken 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit thicken", exact: true })
  await edit.locator("summary").click()
  await expect(edit.locator('input[type="checkbox"][name="thicken-faces"]:checked')).toHaveCount(1)
  await expect(edit.getByRole("combobox", { name: "Thickness", exact: true })).toHaveValue("3 mm")
  expect(readThickenFeatureParameters(thicken)).toEqual(
    readThickenFeatureParameters(
      imported.project.snapshot.features.find(({ id }) => id === thicken.id) ?? thicken,
    ),
  )
})

test("press-pulls the curved wall of a cylinder and reopens the version 2 feature", async ({
  page,
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const create = page.getByRole("form", { name: "Create cylinder" })
  await create.getByRole("combobox", { name: "Radius" }).fill("10 mm")
  await create.getByRole("combobox", { name: "Height" }).fill("60 mm")
  await create.getByRole("button", { name: "Create cylinder", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const before = await saveProject(page)
  // In the isometric view the canvas center of a tall cylinder lies on its curved wall.
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("The model canvas is unavailable.")
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: "right",
  })
  const menu = page.getByRole("menu", { name: "Selection actions", exact: true })
  await menu.getByRole("menuitem", { name: "Press Pull", exact: true }).click()
  const pull = page.getByRole("form", { name: "Press Pull", exact: true })
  await pull.getByRole("combobox", { name: "Distance", exact: true }).fill("2 mm")
  const apply = pull.getByRole("button", { name: "Apply Press Pull", exact: true })
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.click()
  await expect(pull).not.toBeVisible()
  await saved(page)
  const applied = await saveProject(page)
  const feature = applied.project.snapshot.features.find((item) =>
    readPressPullFeatureParameters(item),
  )
  if (!feature) throw new Error("An authored Press Pull must be saved.")
  expect(feature.type.schemaVersion).toBe(2)
  expect(readPressPullFeatureParameters(feature)).toMatchObject({
    distance: { value: 2 },
    face: { signature: { geometryClass: "CYLINDRE" } },
  })
  await undoRedoReopen(page, before, applied)
  await page.getByRole("treeitem", { name: "Press Pull 1", exact: true }).click()
  await expect(
    page
      .getByRole("form", { name: "Edit Press Pull", exact: true })
      .getByRole("combobox", { name: "Distance", exact: true }),
  ).toHaveValue("2 mm")
})

// Runs in the browser; the label holds the visible ordinal and the screen-reader measurement.
function labelText(element: { closest(selector: string): { textContent: string | null } | null }) {
  return element.closest("label")?.textContent ?? ""
}
