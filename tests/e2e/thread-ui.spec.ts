import type { Page } from "@playwright/test"
import { readThreadFeatureParameters } from "../../packages/domain/src/part-design-thread"
import { openApplicationMenuItem } from "./application-menu-support"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function startThread(page: Page) {
  await page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }).click()
  await page.getByRole("button", { name: "Thread", exact: true }).click()
  return page.getByRole("form", { name: "Thread body", exact: true })
}

test("models a variable-pitch thread, blocks invalid and missed bands, cancels, edits, undoes, reopens and exports the exact part", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto("/")
  await saved(page)
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Add variable", exact: true }).click()
  await page.getByRole("textbox", { name: "Variable name", exact: true }).fill("pitch")
  await page.getByRole("combobox", { name: "Variable expression", exact: true }).fill("2 mm")
  await page.getByRole("button", { name: "Apply variables", exact: true }).click()
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Model", exact: true }).click()
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const cylinder = page.getByRole("form", { name: "Create cylinder", exact: true })
  await cylinder.getByRole("combobox", { name: "Radius", exact: true }).fill("5 mm")
  await cylinder.getByRole("combobox", { name: "Height", exact: true }).fill("8 mm")
  await cylinder.getByRole("button", { name: "Create cylinder", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const before = await saveProject(page)
  const source = before.project.snapshot.parts.find(({ name }) => name === "Cylinder 1")
  if (!source) throw new Error("The exact cylindrical source part must exist.")
  const targetBody = source.bodyHistory.at(-1)
  if (!targetBody) throw new Error("The source must retain its exact body binding.")

  let form = await startThread(page)
  await form.getByText("Axis, origin and thread options", { exact: true }).click()
  await form.getByRole("combobox", { name: "Starts", exact: true }).fill("2 mm")
  await expect(
    form.getByText("Starts requires a scalar expression without length or angle units.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await form.getByRole("combobox", { name: "Starts", exact: true }).fill("1")
  await form.getByRole("combobox", { name: "Run-in allowance", exact: true }).fill("6 mm")
  await expect(
    form.getByText(
      "Reduce the axial allowances or increase length so the threaded band stays positive.",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await form.getByRole("combobox", { name: "Run-in allowance", exact: true }).fill("0 mm")
  await form.getByRole("combobox", { name: "Origin Z", exact: true }).fill("100 mm")
  await expect(
    form.getByText(
      "The exact modeled thread could not be built. Check the source solid, explicit axis/origin, diameter and threaded band. Adjust the parameters; Apply requires a successful native preview.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30_000 })
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await form.getByRole("combobox", { name: "Origin Z", exact: true }).fill("0 mm")
  await form.getByRole("combobox", { name: "Pitch", exact: true }).fill("#pitch")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  const canceled = await saveProject(page)
  expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)

  form = await startThread(page)
  await form.getByRole("combobox", { name: "Pitch", exact: true }).fill("#pitch")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).dblclick()
  await saved(page)
  const applied = await saveProject(page)
  const feature = applied.project.snapshot.features.find((item) =>
    readThreadFeatureParameters(item),
  )
  if (!feature) throw new Error("The ordinary modeled Thread feature must persist.")
  expect(
    applied.project.snapshot.features.filter((item) => readThreadFeatureParameters(item)),
  ).toHaveLength(1)
  expect(readThreadFeatureParameters(feature)).toMatchObject({
    targetBody,
    kind: "external",
    axis: "Z",
    handedness: "right",
    nominalDiameter: { value: 10 },
    pitch: { value: 2, source: { expression: "#pitch" } },
    length: { value: 6 },
    depth: { value: 0.8 },
    clearance: { value: 0.1 },
    starts: { value: 1 },
  })
  expect(feature.dependencies).toEqual([targetBody.featureId])
  expect(feature.references).toEqual([])
  expect(applied.project.snapshot.parts).toEqual([
    {
      ...source,
      bodyHistory: [
        ...source.bodyHistory,
        { schemaVersion: 0, featureId: feature.id, outputRole: "result" },
      ],
    },
  ])
  await expect(page.locator(`[data-part-id="${source.id}"]`)).toHaveAttribute(
    "data-part-status",
    "available",
  )

  await page.getByRole("treeitem", { name: "Thread 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit modeled thread", exact: true })
  await expect(form.getByRole("combobox", { name: "Pitch", exact: true })).toHaveValue("#pitch")
  await form.getByRole("combobox", { name: "Groove depth", exact: true }).fill("0.6 mm")
  await expect(form.getByRole("button", { name: "Update feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await saved(page)
  const edited = await saveProject(page)
  expect(edited.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  const editedFeature = edited.project.snapshot.features.find(({ id }) => id === feature.id)
  if (!editedFeature) throw new Error("Editing must preserve the Thread feature identity.")
  expect(readThreadFeatureParameters(editedFeature)).toMatchObject({
    depth: { value: 0.6 },
    targetBody,
  })
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
  await page.getByRole("treeitem", { name: "Thread 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit modeled thread", exact: true })
  await expect(form.getByRole("combobox", { name: "Pitch", exact: true })).toHaveValue("#pitch")
  await expect(form.getByRole("combobox", { name: "Groove depth", exact: true })).toHaveValue(
    "0.6 mm",
  )
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }).click()
  await openApplicationMenuItem(page, "Export geometry…")
  const exportDialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await exportDialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
  await page.getByRole("option", { name: "Cylinder 1", exact: true }).click()
  const downloading = page.waitForEvent("download")
  await exportDialog.getByRole("button", { name: "Export STEP", exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.step$/)
  await expect(exportDialog).not.toBeVisible()
  const exported = await saveProject(page)
  expect(exported.project.snapshot.features).toEqual(edited.project.snapshot.features)
  expect(exported.project.snapshot.parts).toEqual(edited.project.snapshot.parts)
})
