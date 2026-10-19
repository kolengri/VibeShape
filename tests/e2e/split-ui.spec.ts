import { boxFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { readPlacementFeatureParameters } from "../../packages/domain/src/part-design-placement"
import { readSplitFeatureParameters } from "../../packages/domain/src/part-design-split"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

test("previews, cancels, rejects missed and tangent planes, splits independent parts, edits, undoes, reopens and exports one side", async ({
  page,
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)
  const box = required(
    before.project.snapshot.features.find(({ label }) => label === "Box 1"),
    "The source box must exist.",
  )
  const height = boxFeatureParametersSchema.parse(box.parameters).height.value
  const source = required(
    before.project.snapshot.parts.find(({ name }) => name === "Box 1"),
    "The source authored part must exist.",
  )
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Split", exact: true }).click()
  let form = page.getByRole("form", { name: "Split part", exact: true })
  await expect(form.getByRole("combobox", { name: "Plane offset", exact: true })).toHaveValue(
    `${height / 2} mm`,
  )
  await expect(form.getByText(/two independently owned parts/)).toBeVisible()
  await expect(form.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  const canceled = await saveProject(page)
  expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Split", exact: true }).click()
  form = page.getByRole("form", { name: "Split part", exact: true })
  const offset = form.getByRole("combobox", { name: "Plane offset", exact: true })
  for (const invalid of [`${height + 1} mm`, `${height} mm`]) {
    await offset.fill(invalid)
    await expect(
      page.getByText(
        "The unsaved feature could not be previewed. Adjust its parameters or target.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30_000 })
    await expect(form.getByRole("button", { name: "Apply split", exact: true })).toBeDisabled()
  }
  await form.getByRole("button", { name: "Use body midpoint", exact: true }).click()
  await expect(form.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply split", exact: true }).click()
  await saved(page)
  const applied = await saveProject(page)
  const split = required(
    applied.project.snapshot.features.find((feature) => readSplitFeatureParameters(feature)),
    "Split must persist through the ordinary command path.",
  )
  const negative = required(
    applied.project.snapshot.parts.find(({ id }) => id === source.id),
    "The source continuation must exist.",
  )
  const positive = required(
    applied.project.snapshot.parts.find(
      ({ id }) => !before.project.snapshot.parts.some((part) => part.id === id),
    ),
    "Split must own an independent positive side.",
  )
  expect(applied.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 1)
  expect(negative).toEqual({
    ...source,
    bodyHistory: [
      ...source.bodyHistory,
      { schemaVersion: 0, featureId: split.id, outputRole: "split.negative" },
    ],
  })
  expect(positive.bodyHistory).toEqual([
    { schemaVersion: 0, featureId: split.id, outputRole: "split.positive" },
  ])
  expect(positive.id).not.toBe(source.id)
  for (const part of [negative, positive])
    await expect(page.locator(`[data-part-id="${part.id}"]`)).toHaveAttribute(
      "data-part-status",
      "available",
    )
  await page.getByRole("treeitem", { name: "Split 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit split", exact: true })
  await form.getByRole("combobox", { name: "Plane offset", exact: true }).fill(`${height / 3} mm`)
  await expect(form.getByRole("button", { name: "Update split", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update split", exact: true }).click()
  await saved(page)
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
  const edited = required(
    reloaded.project.snapshot.features.find(({ id }) => id === split.id),
    "The same Split must survive reload.",
  )
  expect(readSplitFeatureParameters(edited)?.offset.value).toBeCloseTo(height / 3)
  expect(reloaded.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  await openProject(page, reloaded)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.features).toEqual(reloaded.project.snapshot.features)
  expect(imported.project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
  // Modify just the positive side through its exact current BodyReference.
  await page.locator(`[data-part-id="${positive.id}"]`).getByRole("treeitem").click()
  await page.getByRole("button", { name: "Place / align faces", exact: true }).click()
  const placement = page.getByRole("form", { name: "Place part", exact: true })
  await placement.getByRole("combobox", { name: "Translate Z", exact: true }).fill("5 mm")
  await expect(
    placement.getByRole("button", { name: "Create placement", exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
  await placement.getByRole("button", { name: "Create placement", exact: true }).click()
  await saved(page)
  const placed = await saveProject(page)
  const operation = required(
    placed.project.snapshot.features.find((feature) => readPlacementFeatureParameters(feature)),
    "The side placement must persist.",
  )
  expect(readPlacementFeatureParameters(operation)?.targetBody).toEqual({
    schemaVersion: 0,
    featureId: split.id,
    outputRole: "split.positive",
  })
  expect(placed.project.snapshot.parts.find(({ id }) => id === negative.id)).toEqual(negative)
  expect(placed.project.snapshot.parts.find(({ id }) => id === positive.id)?.bodyHistory).toEqual([
    ...positive.bodyHistory,
    { schemaVersion: 0, featureId: operation.id, outputRole: "result" },
  ])
  await page.locator(`[data-part-id="${negative.id}"]`).getByRole("treeitem").click()
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await dialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
  await page.getByRole("option", { name: negative.name, exact: true }).click()
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("combobox", { name: "File format" }).selectOption("step")
  await dialog.getByRole("button", { name: "Save STEP file", exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/\.step$/)
  expect(await download.path()).toBeTruthy()
  await expect(dialog).not.toBeVisible()
  expect((await saveProject(page)).project.snapshot.parts).toEqual(placed.project.snapshot.parts)
})
