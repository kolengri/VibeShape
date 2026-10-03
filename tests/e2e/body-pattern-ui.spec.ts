import type { Page } from "@playwright/test"
import { readPatternFeatureParameters } from "../../packages/domain/src/part-design-pattern"
import { readPlacementFeatureParameters } from "../../packages/domain/src/part-design-placement"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}
async function startPattern(page: Page, name = "Box 1") {
  await page.getByRole("treeitem", { name: `Part ${name}`, exact: true }).click()
  await page.getByRole("button", { name: `Pattern ${name}`, exact: true }).click()
  return page.getByRole("form", { name: "Pattern body", exact: true })
}
async function renameInstance(page: Page, part: { id: string; name: string }, name: string) {
  await page
    .locator(`[data-part-id="${part.id}"]`)
    .getByRole("button", { name: `Rename part ${part.name}`, exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "Rename item", exact: true })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await saved(page)
}
async function exportPart(page: Page, name: string) {
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await dialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
  await page.getByRole("option", { name, exact: true }).click()
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Export STEP", exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.step$/)
  await expect(dialog).not.toBeVisible()
}

test("patterns variable-count linear copies, guards invalid count, cancels, edits atomically, undoes, reopens and exports one instance", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Add variable", exact: true }).click()
  await page.getByRole("textbox", { name: "Variable name", exact: true }).fill("copies")
  await page.getByRole("combobox", { name: "Variable expression", exact: true }).fill("3")
  await page.getByRole("button", { name: "Apply variables", exact: true }).click()
  await saved(page)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Model", exact: true })
    .click()
  await createSolids(page)
  const before = await saveProject(page)
  const source = required(
    before.project.snapshot.parts.find(({ name }) => name === "Box 1"),
    "The seed part must exist.",
  )
  let form = await startPattern(page)
  const count = form.getByRole("combobox", { name: "Instance count", exact: true })
  await count.fill("2.5")
  await expect(
    form.getByText("Instance count must resolve to an integer from 2 to 256, including the seed.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await count.fill("#copies")
  await form.getByRole("combobox", { name: "Spacing", exact: true }).fill("-30 mm")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  const canceled = await saveProject(page)
  expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  form = await startPattern(page)
  await form.getByRole("combobox", { name: "Instance count", exact: true }).fill("#copies")
  await form.getByRole("combobox", { name: "Spacing", exact: true }).fill("-30 mm")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).dblclick()
  await saved(page)
  let applied = await saveProject(page)
  const feature = required(
    applied.project.snapshot.features.find((item) => readPatternFeatureParameters(item)),
    "The ordinary pattern feature must persist.",
  )
  const params = readPatternFeatureParameters(feature)
  expect(params).toMatchObject({
    kind: "linear",
    count: { value: 3, source: { expression: "#copies" } },
    spacing: { value: -30 },
  })
  let instances = applied.project.snapshot.parts.filter(({ bodyHistory }) =>
    bodyHistory.some(({ featureId }) => featureId === feature.id),
  )
  await renameInstance(
    page,
    required(
      instances.find(({ id }) => id !== source.id),
      "An independent instance must exist.",
    ),
    "Pattern copy",
  )
  applied = await saveProject(page)
  instances = applied.project.snapshot.parts.filter(({ bodyHistory }) =>
    bodyHistory.some(({ featureId }) => featureId === feature.id),
  )
  expect(instances).toHaveLength(3)
  expect(applied.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 2)
  expect(instances.find(({ id }) => id === source.id)).toEqual({
    ...source,
    bodyHistory: [
      ...source.bodyHistory,
      { schemaVersion: 0, featureId: feature.id, outputRole: "pattern.instance.0" },
    ],
  })
  expect(instances.map(({ bodyHistory }) => bodyHistory.at(-1)?.outputRole).sort()).toEqual([
    "pattern.instance.0",
    "pattern.instance.1",
    "pattern.instance.2",
  ])
  for (const instance of instances)
    await expect(page.locator(`[data-part-id="${instance.id}"]`)).toHaveAttribute(
      "data-part-status",
      "available",
    )
  await page.getByRole("treeitem", { name: "Pattern 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit body pattern", exact: true })
  await expect(form.getByRole("combobox", { name: "Instance count", exact: true })).toHaveValue(
    "#copies",
  )
  await form.getByRole("combobox", { name: "Instance count", exact: true }).fill("#copies + 1")
  await form.getByRole("combobox", { name: "Spacing", exact: true }).fill("-40 mm")
  await expect(form.getByRole("button", { name: "Update feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await saved(page)
  const edited = await saveProject(page)
  expect(edited.project.snapshot.parts).toHaveLength(applied.project.snapshot.parts.length + 1)
  expect(
    edited.project.snapshot.parts.filter(({ id }) => instances.some((part) => part.id === id)),
  ).toEqual(instances)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(applied.project.snapshot.features)
  expect(undone.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.features).toEqual(edited.project.snapshot.features)
  expect(reloaded.project.snapshot.parts).toEqual(edited.project.snapshot.parts)
  await openProject(page, reloaded)
  expect((await saveProject(page)).project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
  await exportPart(
    page,
    required(
      instances.find(({ id }) => id !== source.id),
      "An independent instance must exist.",
    ).name,
  )
})

test("patterns a full circle without an endpoint copy, edits a signed partial angle and places one independently owned instance", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)
  let form = await startPattern(page)
  await form.getByRole("radio", { name: "Circular", exact: true }).check()
  await form.getByRole("radio", { name: "Z", exact: true }).check()
  await form.getByRole("combobox", { name: "Instance count", exact: true }).fill("4")
  await form.getByRole("combobox", { name: "Total angle", exact: true }).fill("360 deg")
  for (const axis of ["X", "Y", "Z"])
    await form.getByRole("combobox", { name: `Center ${axis}`, exact: true }).fill("0 mm")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  const circular = await saveProject(page)
  const feature = required(
    circular.project.snapshot.features.find((item) => readPatternFeatureParameters(item)),
    "The circular feature must persist.",
  )
  const instances = circular.project.snapshot.parts.filter(({ bodyHistory }) =>
    bodyHistory.some(({ featureId }) => featureId === feature.id),
  )
  expect(instances).toHaveLength(4)
  expect(new Set(instances.map(({ id }) => id)).size).toBe(4)
  expect(circular.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 3)
  expect(readPatternFeatureParameters(feature)).toMatchObject({
    kind: "circular",
    axis: "Z",
    angle: { value: 2 * Math.PI },
  })
  await page.getByRole("treeitem", { name: "Pattern 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit body pattern", exact: true })
  await form.getByRole("combobox", { name: "Total angle", exact: true }).fill("-180 deg")
  await expect(form.getByRole("button", { name: "Update feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await saved(page)
  let partial = await saveProject(page)
  expect(partial.project.snapshot.parts).toEqual(circular.project.snapshot.parts)
  const instance = required(
    instances.find(({ bodyHistory }) => bodyHistory.at(-1)?.outputRole === "pattern.instance.1"),
    "Instance one must be independently owned.",
  )
  await renameInstance(page, instance, "Orbital copy")
  partial = await saveProject(page)
  await page.locator(`[data-part-id="${instance.id}"]`).getByRole("treeitem").click()
  await page.getByRole("button", { name: "Place part Orbital copy", exact: true }).click()
  const placement = page.getByRole("form", { name: "Place part", exact: true })
  await placement.getByRole("combobox", { name: "Translate Z", exact: true }).fill("25 mm")
  await expect(
    placement.getByRole("button", { name: "Create placement", exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
  await placement.getByRole("button", { name: "Create placement", exact: true }).click()
  await saved(page)
  const placed = await saveProject(page)
  const transform = required(
    placed.project.snapshot.features.find((item) => readPlacementFeatureParameters(item)),
    "The selected instance placement must persist.",
  )
  expect(readPlacementFeatureParameters(transform)?.targetBody).toEqual({
    schemaVersion: 0,
    featureId: feature.id,
    outputRole: "pattern.instance.1",
  })
  expect(placed.project.snapshot.parts.filter(({ id }) => id !== instance.id)).toEqual(
    partial.project.snapshot.parts.filter(({ id }) => id !== instance.id),
  )
  await exportPart(page, "Orbital copy")
})
