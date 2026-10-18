import type { Locator, Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function openLibrary(page: Page, name?: string) {
  await openApplicationMenuItem(page, "Library…")
  const dialog = page.getByRole("dialog", { name: "Local component library", exact: true })
  if (name) {
    await dialog.getByRole("button", { name: `Select library item ${name}`, exact: true }).click()
    await expect(
      dialog.getByRole("form", { name: "Insert into the assembly", exact: true }),
    ).toBeVisible()
  }
  return dialog
}
async function closeLibrary(dialog: Locator) {
  await dialog.getByRole("button", { name: "Close library", exact: true }).last().click()
  await expect(dialog).not.toBeVisible()
}
async function choose(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function insert(page: Page, dialog: Locator, reference: boolean) {
  if (reference) await choose(page, dialog, "Insertion mode", "Pinned library reference")
  const form = dialog.getByRole("form", { name: "Insert into the assembly", exact: true })
  await form
    .getByRole("textbox", { name: "Definition name", exact: true })
    .fill(reference ? "Reference definition" : "Copy definition")
  await form
    .getByRole("textbox", { name: "Occurrence name", exact: true })
    .fill(reference ? "Reference occurrence" : "Copy occurrence")
  await form
    .getByRole("button", {
      name: reference ? "Insert pinned reference" : "Insert copy",
      exact: true,
    })
    .click()
  await expect(
    dialog.getByText("The frozen component was inserted as one CAD transaction.", { exact: true }),
  ).toBeVisible({ timeout: 60_000 })
  await expect(dialog.getByRole("alert")).toHaveCount(0)
}
function assembly(source: Awaited<ReturnType<typeof saveProject>>) {
  const snapshot = source.project.snapshot
  if (snapshot.schemaVersion !== 4)
    throw new Error("Library insertion must preserve V4 assembly authority.")
  return snapshot.assembly
}
function requireDefinition(source: Awaited<ReturnType<typeof saveProject>>, name: string) {
  const definition = assembly(source).definitions.find((entry) => entry.name === name)
  if (!definition) throw new Error(`The frozen definition ${name} must be retained.`)
  return definition
}
function expectFrozenWidth(
  source: Awaited<ReturnType<typeof saveProject>>,
  name: string,
  width: number,
) {
  const model = requireDefinition(source, name).pinnedModels[0]
  if (!model) throw new Error("An inserted component must retain its frozen source model.")
  expect(model.snapshot.features.find(({ label }) => label === "Box 1")?.parameters).toMatchObject({
    width: { value: width },
  })
}

test("publishes immutable local versions and explicitly inserts, updates and detaches assembly references with ordinary Undo and native reopening", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  await box.getByRole("combobox", { name: "Width", exact: true }).fill("20 mm")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
  await saved(page)
  const before = await saveProject(page)
  let dialog = await openLibrary(page)
  const save = dialog.getByRole("form", { name: "Save a frozen component", exact: true })
  await save.getByRole("textbox", { name: "Component name", exact: true }).fill("Print bracket")
  await save.getByRole("textbox", { name: "Tags", exact: true }).fill("Print, Fixture")
  await save.getByRole("button", { name: "Save library item", exact: true }).dblclick()
  await expect(dialog.getByText("Saved Print bracket, version 1.", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await closeLibrary(dialog)
  const unchanged = await saveProject(page)
  expect(unchanged.project.snapshot.revision).toBe(before.project.snapshot.revision)
  expect(unchanged.project.snapshot.features).toEqual(before.project.snapshot.features)
  dialog = await openLibrary(page, "Print bracket")
  await insert(page, dialog, false)
  await insert(page, dialog, true)
  await closeLibrary(dialog)
  const inserted = await saveProject(page)
  const copy = requireDefinition(inserted, "Copy definition")
  const reference = requireDefinition(inserted, "Reference definition")
  const occurrences = assembly(inserted).instances
  expect(occurrences).toHaveLength(2)
  expect(copy.libraryBinding).toBeUndefined()
  expect(reference.libraryBinding?.version).toBe(1)
  expectFrozenWidth(inserted, "Copy definition", 20)
  expectFrozenWidth(inserted, "Reference definition", 20)
  await commands.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect(assembly(await saveProject(page)).instances).toHaveLength(1)
  await commands.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  expect(assembly(await saveProject(page)).instances).toEqual(occurrences)

  await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit box", exact: true })
  await edit.getByRole("combobox", { name: "Width", exact: true }).fill("40 mm")
  await edit.getByRole("button", { name: "Update box", exact: true }).click()
  await expect(edit).not.toBeVisible()
  await saved(page)
  dialog = await openLibrary(page, "Print bracket")
  await dialog
    .getByRole("radio", { name: "Publish a version of the selected item", exact: true })
    .check()
  await dialog.getByRole("button", { name: "Publish new version", exact: true }).click()
  await expect(dialog.getByText("Saved Print bracket, version 2.", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await closeLibrary(dialog)
  const noAutomaticUpdate = await saveProject(page)
  expect(requireDefinition(noAutomaticUpdate, "Reference definition")).toEqual(reference)
  expect(requireDefinition(noAutomaticUpdate, "Copy definition")).toEqual(copy)
  expect(assembly(noAutomaticUpdate).instances).toEqual(occurrences)

  dialog = await openLibrary(page, "Print bracket")
  await choose(page, dialog, "Library version", "Version 1")
  await expect(
    dialog.getByRole("combobox", { name: "Library version", exact: true }),
  ).toContainText("Version 1")
  await choose(page, dialog, "Library version", "Version 2")
  await dialog
    .getByRole("button", { name: "Update reference to selected version", exact: true })
    .click()
  await expect(
    dialog.getByText("The reference was updated as one CAD transaction.", { exact: true }),
  ).toBeVisible({ timeout: 60_000 })
  await closeLibrary(dialog)
  const updated = await saveProject(page)
  expect(requireDefinition(updated, "Reference definition")).toMatchObject({
    id: reference.id,
    pinRevision: 2,
    libraryBinding: { ...reference.libraryBinding, version: 2 },
  })
  expectFrozenWidth(updated, "Reference definition", 40)
  expectFrozenWidth(updated, "Copy definition", 20)
  expect(assembly(updated).instances).toEqual(occurrences)
  await commands.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect(requireDefinition(await saveProject(page), "Reference definition")).toEqual(reference)
  await commands.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await openProject(page, updated)
  const reopened = await saveProject(page)
  expect(assembly(reopened)).toEqual(assembly(updated))

  dialog = await openLibrary(page, "Print bracket")
  const metadata = dialog.getByRole("form", { name: "Library item metadata", exact: true })
  await metadata
    .getByRole("textbox", { name: "Component name", exact: true })
    .fill("Reusable print bracket")
  await metadata.getByRole("textbox", { name: "Tags", exact: true }).fill("Mount, Fixture")
  await metadata.getByRole("button", { name: "Save name and tags", exact: true }).click()
  await expect(
    dialog.getByText("Library item metadata saved. Immutable versions were preserved.", {
      exact: true,
    }),
  ).toBeVisible()
  await closeLibrary(dialog)
  expect((await saveProject(page)).project.snapshot.revision).toBe(
    reopened.project.snapshot.revision,
  )
  dialog = await openLibrary(page, "Reusable print bracket")
  await dialog.getByRole("button", { name: "Detach library reference", exact: true }).click()
  await expect(
    dialog.getByText("The library binding was detached as one CAD transaction.", { exact: true }),
  ).toBeVisible({ timeout: 60_000 })
  await closeLibrary(dialog)
  const detached = await saveProject(page)
  const final = requireDefinition(detached, "Reference definition")
  expect(final.libraryBinding).toBeUndefined()
  expect(final.pinnedModels).toEqual(
    requireDefinition(updated, "Reference definition").pinnedModels,
  )
  expect(assembly(detached).instances).toEqual(occurrences)
  await commands.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect(
    requireDefinition(await saveProject(page), "Reference definition").libraryBinding?.version,
  ).toBe(2)
  await commands.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await expect(page.getByRole("region", { name: "Assembly task" })).toBeVisible()
  await expect(page.locator(`[data-assembly-instance-id="${occurrences[0]?.id}"]`)).toBeVisible()
  await expect(page.locator(`[data-assembly-instance-id="${occurrences[1]?.id}"]`)).toBeVisible()
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
  await page.reload()
  await saved(page)
  dialog = await openLibrary(page, "Reusable print bracket")
  await dialog
    .getByRole("searchbox", { name: "Search names and tags", exact: true })
    .fill("Fixture")
  await expect(
    dialog.getByRole("button", { name: "Select library item Reusable print bracket", exact: true }),
  ).toBeVisible()
  await closeLibrary(dialog)
  expect(assembly(await saveProject(page))).toEqual(assembly(detached))
})
