import type { Page } from "@playwright/test"
import { boxFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { readDraftFeatureParameters } from "../../packages/domain/src/part-design-draft"
import { readScaleFeatureParameters } from "../../packages/domain/src/part-design-scale"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function createBox(page: Page) {
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
  return saveProject(page)
}

async function undoRedoReopen(
  page: Page,
  before: Awaited<ReturnType<typeof saveProject>>,
  applied: Awaited<ReturnType<typeof saveProject>>,
) {
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
  // The part keeps its identity; its body history now ends at the applied feature.
  expect(imported.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  return imported
}

test("drafts the side faces of a part, undoes, redoes and reopens it", async ({ page }) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  const before = await createBox(page)
  const box = before.project.snapshot.features.find(({ label }) => label === "Box 1")
  const height = boxFeatureParametersSchema.parse(box?.parameters).height.value
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Draft", exact: true }).click()
  const form = page.getByRole("form", { name: "Draft", exact: true })
  const apply = form.getByRole("button", { name: "Apply draft", exact: true })
  await expect(apply).toBeDisabled()
  await form.locator("summary").click()
  // Side faces are the catalogue rows whose center lies at half the box height.
  const sideCenter = `, ${(height / 2).toFixed(2)}) mm`
  const faces = form.getByRole("checkbox")
  let checked = 0
  for (const face of await faces.all()) {
    const name = (await face.getAttribute("aria-label")) ?? (await face.evaluate(labelText))
    if (!name.endsWith(sideCenter)) continue
    await face.check()
    checked += 1
  }
  expect(checked).toBe(4)
  await expect(form.getByText("4 / 6 faces selected")).toBeVisible()
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.click()
  await saved(page)
  const applied = await saveProject(page)
  const draft = applied.project.snapshot.features.find((feature) =>
    readDraftFeatureParameters(feature),
  )
  if (!draft) throw new Error("An authored Draft must be saved.")
  const parameters = readDraftFeatureParameters(draft)
  expect(parameters?.faces).toHaveLength(4)
  expect(parameters?.neutralPlane).toEqual({ kind: "origin-plane", plane: "XY" })
  expect(JSON.stringify(draft.parameters)).not.toContain("candidateId")
  expect(applied.project.snapshot.parts.map(({ id }) => id)).toEqual(
    before.project.snapshot.parts.map(({ id }) => id),
  )
  const imported = await undoRedoReopen(page, before, applied)
  await page.getByRole("treeitem", { name: "Draft 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit draft", exact: true })
  await edit.locator("summary").click()
  await expect(edit.locator('input[type="checkbox"][name="draft-faces"]:checked')).toHaveCount(4)
  expect(readDraftFeatureParameters(draft)).toEqual(
    readDraftFeatureParameters(
      imported.project.snapshot.features.find(({ id }) => id === draft.id) ?? draft,
    ),
  )
})

test("scales a part about its bounding-box center, undoes, redoes and reopens it", async ({
  page,
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  const before = await createBox(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Scale", exact: true }).click()
  const form = page.getByRole("form", { name: "Scale", exact: true })
  await form.getByRole("combobox", { name: "Scale factor", exact: true }).fill("1.5")
  const apply = form.getByRole("button", { name: "Apply scale", exact: true })
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.click()
  await saved(page)
  const applied = await saveProject(page)
  const scale = applied.project.snapshot.features.find((feature) =>
    readScaleFeatureParameters(feature),
  )
  if (!scale) throw new Error("An authored Scale must be saved.")
  expect(readScaleFeatureParameters(scale)).toMatchObject({
    factor: { value: 1.5 },
    center: { kind: "bounding-box-center" },
  })
  expect(applied.project.snapshot.parts.map(({ id }) => id)).toEqual(
    before.project.snapshot.parts.map(({ id }) => id),
  )
  await undoRedoReopen(page, before, applied)
  await page.getByRole("treeitem", { name: "Scale 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit scale", exact: true })
  await expect(edit.getByRole("combobox", { name: "Scale factor", exact: true })).toHaveValue("1.5")
})

// Runs in the browser; the label holds the visible ordinal and the screen-reader measurement.
function labelText(element: { closest(selector: string): { textContent: string | null } | null }) {
  return element.closest("label")?.textContent ?? ""
}
