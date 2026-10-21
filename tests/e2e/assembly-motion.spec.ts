import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

function panel(page: Page) {
  return page.getByRole("region", { name: "Assembly task", exact: true })
}
async function assembly(page: Page) {
  const archive = await saveProject(page)
  const snapshot = archive.project.snapshot
  if (snapshot.schemaVersion !== 4 && snapshot.schemaVersion !== 5)
    throw new Error("The motion fixture requires assembly authority.")
  return snapshot
}
async function apply(page: Page) {
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await expect(panel(page).getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
  await saved(page)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
  await expect(panel(page).getByRole("alert")).toHaveCount(0)
}
async function openDrive(page: Page) {
  await page.getByRole("button", { name: /^Drive .* → Motion arm$/ }).click()
  await expect(
    panel(page).getByRole("heading", { name: "Joint motion", exact: true }),
  ).toBeVisible()
}

test("previews real assembly drives without saving, pauses and resets, applies once and restores with Undo", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  const modes = page.getByRole("group", { name: "Geometry workspace" })
  await modes.getByRole("button", { name: "Assembly", exact: true }).click()
  await panel(page).getByRole("button", { name: "Create definition", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Motion bracket")
  await apply(page)
  const parent = (await assembly(page)).assembly.instances[0]
  if (!parent) throw new Error("The motion fixture requires a grounded occurrence.")
  await page.locator(`[data-assembly-instance-id="${parent.id}"]`).click()
  await panel(page).getByRole("button", { name: "Add joint", exact: true }).click()
  await panel(page).getByRole("combobox", { name: "Joint type", exact: true }).click()
  await page.getByRole("option", { name: "Revolute", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Motion arm")
  await panel(page).getByRole("spinbutton", { name: "Minimum drive", exact: true }).fill("-45")
  await panel(page).getByRole("spinbutton", { name: "Maximum drive", exact: true }).fill("45")
  await apply(page)
  const baseline = await assembly(page)
  expect(baseline.assembly.joints[0]).toMatchObject({ kind: "revolute", value: 0 })

  await openDrive(page)
  await panel(page).getByRole("spinbutton", { name: "Coordinate (deg)", exact: true }).fill("30")
  await panel(page).getByRole("button", { name: "Preview coordinate", exact: true }).click()
  await expect(panel(page).getByText("Preview: 30 deg", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toBeVisible()
  const unsaved = await assembly(page)
  expect(unsaved.assembly).toEqual(baseline.assembly)
  expect(unsaved.revision).toBe(baseline.revision)

  await panel(page).getByRole("spinbutton", { name: "Sweep start (deg)", exact: true }).fill("-10")
  await panel(page).getByRole("spinbutton", { name: "Sweep end (deg)", exact: true }).fill("10")
  await panel(page).getByRole("button", { name: "Play animation", exact: true }).click()
  await expect(panel(page).getByText("Preview: -10 deg", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await panel(page).getByRole("button", { name: "Pause", exact: true }).click()
  await expect(panel(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(0)
  expect((await assembly(page)).assembly).toEqual(baseline.assembly)
  await panel(page).getByRole("button", { name: "Reset preview", exact: true }).click()
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toHaveCount(0)
  await expect(panel(page).getByRole("button", { name: "Apply", exact: true })).toBeDisabled()
  await panel(page).getByRole("spinbutton", { name: "Sweep start (deg)", exact: true }).fill("46")
  await panel(page).getByRole("button", { name: "Play animation", exact: true }).click()
  await expect(panel(page).getByRole("alert")).toContainText("Check track coordinates")
  await expect(panel(page).getByRole("button", { name: "Apply", exact: true })).toBeDisabled()

  await panel(page).getByRole("spinbutton", { name: "Sweep start (deg)", exact: true }).fill("-10")
  await panel(page).getByRole("spinbutton", { name: "Coordinate (deg)", exact: true }).fill("20")
  await panel(page).getByRole("button", { name: "Preview coordinate", exact: true }).click()
  await expect(panel(page).getByText("Preview: 20 deg", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await apply(page)
  const applied = await assembly(page)
  expect(applied.revision).toBe(baseline.revision + 1)
  expect(applied.assembly.joints[0]).toMatchObject({ kind: "revolute", value: Math.PI / 9 })
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await assembly(page)).assembly).toEqual(baseline.assembly)

  await openDrive(page)
  await panel(page).getByRole("spinbutton", { name: "Coordinate (deg)", exact: true }).fill("10")
  await panel(page).getByRole("button", { name: "Preview coordinate", exact: true }).click()
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await modes.getByRole("button", { name: "Model", exact: true }).click()
  await modes.getByRole("button", { name: "Assembly", exact: true }).click()
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toHaveCount(0)
  await expect(panel(page).getByRole("heading", { name: "Joint motion", exact: true })).toHaveCount(
    0,
  )
  expect((await assembly(page)).assembly).toEqual(baseline.assembly)

  await openDrive(page)
  await panel(page).getByRole("spinbutton", { name: "Coordinate (deg)", exact: true }).fill("-10")
  await panel(page).getByRole("button", { name: "Preview coordinate", exact: true }).click()
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const firstUrl = page.url()
  await openApplicationMenuItem(page, "Projects")
  await page.getByRole("main").getByRole("button", { name: "New project", exact: true }).click()
  await saved(page)
  await expect(page).not.toHaveURL(firstUrl)
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(firstUrl)
  await saved(page)
  await expect(panel(page).getByRole("heading", { name: "Joint motion", exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toHaveCount(0)
  expect((await assembly(page)).assembly).toEqual(baseline.assembly)
})
