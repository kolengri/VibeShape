import { readUnionFeatureParameters } from "../../packages/domain/src/part-design-body-combination"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

test("unions two exact sibling outputs through ordered body slots and preserves them across Undo and portable reopen", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Compound", exact: true }).click()
  let form = page.getByRole("form", { name: "Create Compound", exact: true })
  await form.getByRole("button", { name: "Add part Box 1", exact: true }).click()
  await form.getByRole("button", { name: "Add part Cylinder 1", exact: true }).click()
  await form.getByRole("button", { name: "Create", exact: true }).click()
  await expect(form).not.toBeVisible({ timeout: 30_000 })
  await saved(page)
  const before = await saveProject(page)
  const parts = before.project.snapshot.parts
  expect(parts).toHaveLength(2)
  const producer = parts[0]?.bodyHistory.at(-1)?.featureId
  expect(producer).toBeDefined()
  expect(parts[1]?.bodyHistory.at(-1)?.featureId).toBe(producer)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Union", exact: true }).click()
  form = page.getByRole("form", { name: "Create Union", exact: true })
  await form.getByRole("button", { name: "Add part Box 1", exact: true }).click()
  await expect(form.getByRole("button", { name: "Add part Cylinder 1", exact: true })).toBeEnabled()
  await form.getByRole("button", { name: "Add part Cylinder 1", exact: true }).click()
  await form.getByRole("button", { name: "Create", exact: true }).dblclick()
  await expect(form).not.toBeVisible({ timeout: 30_000 })
  await saved(page)
  const applied = await saveProject(page)
  const union = applied.project.snapshot.features.find((feature) =>
    readUnionFeatureParameters(feature),
  )
  if (!union) throw new Error("The ordinary Union intent must be present.")
  expect(union.type.schemaVersion).toBe(2)
  expect(union.dependencies).toEqual([producer])
  expect(readUnionFeatureParameters(union)?.bodies).toEqual(
    parts.map(({ bodyHistory }) => bodyHistory.at(-1)),
  )
  await expect(page.locator(`[data-part-id="${parts[0]?.id}"]`)).toHaveAttribute(
    "data-part-status",
    "available",
  )
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.parts).toEqual(parts)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    applied.project.snapshot.features,
  )
  await page.reload()
  await saved(page)
  await openProject(page, applied)
  const reopened = await saveProject(page)
  expect(reopened.project.snapshot.features).toEqual(applied.project.snapshot.features)
  expect(reopened.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Export STEP", exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.step$/)
})
