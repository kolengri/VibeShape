import { readFdmFeatureParameters } from "../../packages/domain/src/part-design-fdm"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("creates an authored FDM coupon, edits, undoes and reopens its native backup", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Modify", "FDM tools")
  let form = page.getByRole("form", { name: "FDM tools", exact: true })
  await form.getByRole("combobox", { name: "Tool", exact: true }).click()
  await page.getByRole("option", { name: "Calibration coupon", exact: true }).click()
  await form.getByRole("combobox", { name: "First hole diameter", exact: true }).fill("4 mm")
  await expect(form.getByRole("button", { name: "Create", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create", exact: true }).click()
  await saved(page)
  await expect(
    page.getByRole("treeitem", { name: "Part FDM feature 1", exact: true }),
  ).toBeVisible()
  const applied = await saveProject(page)
  const feature = applied.project.snapshot.features.find((item) => readFdmFeatureParameters(item))
  if (!feature) throw new Error("The coupon feature must persist")
  expect(readFdmFeatureParameters(feature)).toMatchObject({
    kind: "calibration-coupon",
    diameterStart: { value: 4 },
    holeCount: 5,
  })
  expect(applied.project.snapshot.parts).toHaveLength(1)
  const part = applied.project.snapshot.parts[0]
  expect(part?.bodyHistory).toEqual([
    { schemaVersion: 0, featureId: feature.id, outputRole: "result" },
  ])
  await page.getByRole("treeitem", { name: "FDM feature 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit FDM feature", exact: true })
  await expect(
    form.getByRole("combobox", { name: "First hole diameter", exact: true }),
  ).toHaveValue("4 mm")
  await form.getByRole("combobox", { name: "Center spacing", exact: true }).fill("1 mm")
  await expect(form.getByRole("button", { name: "Update", exact: true })).toBeDisabled()
  await form.getByRole("combobox", { name: "Center spacing", exact: true }).fill("10 mm")
  await expect(form.getByRole("button", { name: "Update", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update", exact: true }).click()
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
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    edited.project.snapshot.features,
  )
  await openProject(page, edited)
  await page.getByRole("treeitem", { name: "FDM feature 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit FDM feature", exact: true })
  await expect(form.getByRole("combobox", { name: "Center spacing", exact: true })).toHaveValue(
    "10 mm",
  )
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  const reopened = await saveProject(page)
  expect(reopened.project.snapshot.features).toEqual(edited.project.snapshot.features)
  expect(reopened.project.snapshot.parts.map(({ bodyHistory }) => bodyHistory)).toEqual(
    edited.project.snapshot.parts.map(({ bodyHistory }) => bodyHistory),
  )
})

test("switches directly between differently typed FDM edits without replacing authored parameters", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto("/")
  await saved(page)
  for (const name of ["Calibration coupon", "Flexible sleeve"]) {
    await invokeModelCommand(page, "Modify", "FDM tools")
    const form = page.getByRole("form", { name: "FDM tools", exact: true })
    await form.getByRole("combobox", { name: "Tool", exact: true }).click()
    await page.getByRole("option", { name, exact: true }).click()
    await expect(form.getByRole("button", { name: "Create", exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await form.getByRole("button", { name: "Create", exact: true }).click()
    await saved(page)
  }
  await page.getByRole("treeitem", { name: "FDM feature 1", exact: true }).click()
  let form = page.getByRole("form", { name: "Edit FDM feature", exact: true })
  await expect(form.getByRole("combobox", { name: "Tool", exact: true })).toContainText(
    "Calibration coupon",
  )
  await page.getByRole("treeitem", { name: "FDM feature 2", exact: true }).click()
  form = page.getByRole("form", { name: "Edit FDM feature", exact: true })
  await expect(form.getByRole("combobox", { name: "Tool", exact: true })).toContainText(
    "Flexible sleeve",
  )
  await expect(form.getByRole("combobox", { name: "Outer diameter", exact: true })).toHaveValue(
    "14 mm",
  )
  await form.getByRole("combobox", { name: "Outer diameter", exact: true }).fill("16 mm")
  await expect(form.getByRole("button", { name: "Update", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update", exact: true }).click()
  await saved(page)
  const project = await saveProject(page)
  expect(project.project.snapshot.features.map(readFdmFeatureParameters)).toMatchObject([
    { kind: "calibration-coupon", diameterStart: { value: 3 } },
    { kind: "flexible-sleeve", outerDiameter: { value: 16 } },
  ])
  expect(project.project.snapshot.parts).toHaveLength(2)
})
