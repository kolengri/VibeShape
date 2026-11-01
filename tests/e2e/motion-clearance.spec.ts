import type { Page } from "@playwright/test"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

function task(page: Page) {
  return page.getByRole("region", { name: "Assembly task", exact: true })
}
async function authority(page: Page) {
  const snapshot = (await saveProject(page)).project.snapshot
  if (snapshot.schemaVersion < 4 || !("assembly" in snapshot))
    throw new Error("Clearance requires assembly authority.")
  return snapshot
}
async function apply(page: Page) {
  await task(page).getByRole("button", { name: "Apply", exact: true }).click()
  await expect(task(page).getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
  await saved(page)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
}

test("checks exact sampled clearance, shows the matching disposable pose and saves only on explicit Apply with Undo", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "Create definition", exact: true })
    .click()
  await task(page).getByRole("textbox", { name: "Name", exact: true }).fill("Clearance bracket")
  await apply(page)
  const parent = (await authority(page)).assembly.instances[0]
  if (!parent) throw new Error("A grounded instance is required.")
  await page.locator(`[data-assembly-instance-id="${parent.id}"]`).click()
  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "Add joint", exact: true })
    .click()
  await task(page).getByRole("combobox", { name: "Joint type", exact: true }).click()
  await page.getByRole("option", { name: "Revolute", exact: true }).click()
  await task(page).getByRole("textbox", { name: "Name", exact: true }).fill("Clearance arm")
  await task(page).getByRole("spinbutton", { name: "Minimum drive", exact: true }).fill("-45")
  await task(page).getByRole("spinbutton", { name: "Maximum drive", exact: true }).fill("45")
  await apply(page)
  const baseline = await authority(page)
  await page.getByRole("button", { name: /^Drive .* → Clearance arm$/ }).click()
  await task(page).getByRole("spinbutton", { name: "Sweep start (deg)", exact: true }).fill("-10")
  await task(page).getByRole("spinbutton", { name: "Sweep end (deg)", exact: true }).fill("20")
  const clearance = task(page).getByRole("region", {
    name: "Sampled motion clearance",
    exact: true,
  })
  await expect(
    clearance.getByRole("spinbutton", { name: "Minimum gap (mm)", exact: true }),
  ).toHaveValue("0.2")
  await clearance.getByRole("spinbutton", { name: "Clearance sample count", exact: true }).fill("3")
  await clearance.getByRole("button", { name: "Check clearance", exact: true }).click()
  await expect(clearance.getByText(/Requested sampled positions checked/)).toBeVisible({
    timeout: 120_000,
  })
  await expect(
    clearance.getByText(/3\/3 sampled positions; range -10 to 20 deg; spacing 15 deg/),
  ).toBeVisible()
  await expect(clearance.getByText(/Smallest sampled gap: 0 mm at/)).toBeVisible()
  await expect(clearance.getByText(/positive-volume interference/).first()).toBeVisible()
  const checked = await authority(page)
  expect(checked.revision).toBe(baseline.revision)
  expect(checked.assembly).toEqual(baseline.assembly)
  await clearance.getByRole("button", { name: "Show smallest sampled gap", exact: true }).click()
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const position = task(page).getByText(/^Preview: (-10|5|20) deg$/)
  await expect(position).toBeVisible()
  const shownValue = Number((await position.textContent())?.match(/^Preview: ([-\d.]+)/)?.[1])
  expect(Number.isFinite(shownValue)).toBe(true)
  const preview = await authority(page)
  expect(preview.revision).toBe(baseline.revision)
  expect(preview.assembly).toEqual(baseline.assembly)
  await apply(page)
  const applied = await authority(page)
  expect(applied.revision).toBe(baseline.revision + 1)
  const joint = applied.assembly.joints[0]
  expect(joint?.kind).toBe("revolute")
  if (joint?.kind !== "revolute") throw new Error("Expected the driven revolute joint.")
  expect(joint.value).toBeCloseTo((shownValue * Math.PI) / 180, 10)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await authority(page)).assembly).toEqual(baseline.assembly)
})
