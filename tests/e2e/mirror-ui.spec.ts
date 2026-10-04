import { readMirrorFeatureParameters } from "../../packages/domain/src/part-design-mirror"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

test("previews, cancels, replaces a part, edits, undoes and reopens Mirror intent", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)
  const parts = page.locator("[data-part-id]")
  const partIds = await parts.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-part-id")),
  )
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Mirror", exact: true }).click()
  let form = page.getByRole("form", { name: "Mirror part", exact: true })
  await expect(form.getByText(/result replaces the current part/)).toBeVisible()
  await form.getByRole("radio", { name: "XZ", exact: true }).check()
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Mirror 1", exact: true })).toHaveCount(0)
  const canceled = await saveProject(page)
  expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Mirror", exact: true }).click()
  form = page.getByRole("form", { name: "Mirror part", exact: true })
  await form.getByRole("radio", { name: "XY", exact: true }).check()
  await expect(form.getByRole("button", { name: "Create mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create mirror", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Mirror 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const applied = await saveProject(page)
  const mirror = applied.project.snapshot.features.find((feature) =>
    readMirrorFeatureParameters(feature),
  )
  if (!mirror) throw new Error("An authored Mirror must be saved.")
  expect(readMirrorFeatureParameters(mirror)?.plane).toBe("XY")
  expect(applied.project.snapshot.parts.map(({ id }) => id)).toEqual(partIds)
  expect(applied.project.snapshot.parts[0]?.bodyHistory).toEqual([
    ...(before.project.snapshot.parts[0]?.bodyHistory ?? []),
    { schemaVersion: 0, featureId: mirror.id, outputRole: "result" },
  ])
  expect(applied.project.snapshot.features.filter(({ id }) => id !== mirror.id)).toEqual(
    before.project.snapshot.features,
  )
  await page.getByRole("treeitem", { name: "Mirror 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit mirror", exact: true })
  await expect(form.getByRole("radio", { name: "XY", exact: true })).toBeChecked()
  await form.getByRole("radio", { name: "YZ", exact: true }).check()
  await expect(form.getByRole("button", { name: "Update mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update mirror", exact: true }).click()
  await saved(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(applied.project.snapshot.features)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  const edited = reloaded.project.snapshot.features.find(({ id }) => id === mirror.id)
  if (!edited) throw new Error("The Mirror must survive local reopen.")
  expect(readMirrorFeatureParameters(edited)?.plane).toBe("YZ")
  expect(reloaded.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  await openProject(page, reloaded)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.features).toEqual(reloaded.project.snapshot.features)
  expect(imported.project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
})

test("creates and reopens an offset reflected copy with independent authored ownership", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Mirror", exact: true }).click()
  let form = page.getByRole("form", { name: "Mirror part", exact: true })
  await form.getByRole("combobox", { name: "Plane offset", exact: true }).fill("-1 cm")
  await form.getByRole("checkbox", { name: "Preserve source part", exact: true }).check()
  await expect(form.getByRole("button", { name: "Create mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create mirror", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Mirror 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const applied = await saveProject(page)
  const mirror = applied.project.snapshot.features.find((feature) =>
    readMirrorFeatureParameters(feature),
  )
  if (!mirror) throw new Error("A reflected copy must retain its authored feature.")
  expect(mirror.type.schemaVersion).toBe(2)
  expect(readMirrorFeatureParameters(mirror)).toMatchObject({
    plane: "XY",
    preserveSource: true,
    offset: { value: -10, source: { expression: "-1 cm" } },
  })
  expect(applied.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 1)
  for (const source of before.project.snapshot.parts)
    expect(applied.project.snapshot.parts.find(({ id }) => id === source.id)).toEqual(source)
  const reflectedPart = applied.project.snapshot.parts.find(
    ({ id }) => !before.project.snapshot.parts.some((source) => source.id === id),
  )
  expect(reflectedPart).toMatchObject({
    consumedBy: null,
    origin: "independent",
    bodyHistory: [{ schemaVersion: 0, featureId: mirror.id, outputRole: "result" }],
  })
  await page.getByRole("treeitem", { name: "Mirror 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit mirror", exact: true })
  await expect(form.getByRole("combobox", { name: "Plane offset", exact: true })).toHaveValue(
    "-1 cm",
  )
  await expect(
    form.getByRole("checkbox", { name: "Preserve source part", exact: true }),
  ).toBeChecked()
  await form.getByRole("radio", { name: "XZ", exact: true }).check()
  await expect(form.getByRole("button", { name: "Update mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update mirror", exact: true }).click()
  await saved(page)
  const edited = await saveProject(page)
  expect(edited.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    applied.project.snapshot.features,
  )
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.features).toEqual(edited.project.snapshot.features)
  expect(reloaded.project.snapshot.parts).toEqual(edited.project.snapshot.parts)
  await openProject(page, reloaded)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.features).toEqual(reloaded.project.snapshot.features)
  expect(imported.project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
})
