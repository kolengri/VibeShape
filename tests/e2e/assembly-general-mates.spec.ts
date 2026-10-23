import type { Page } from "@playwright/test"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

const panel = (page: Page) => page.getByRole("region", { name: "Assembly task" })
async function settle(page: Page) {
  await saved(page)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
  await expect(panel(page).getByRole("alert")).toHaveCount(0)
}
async function apply(page: Page) {
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await Promise.race([
    panel(page)
      .getByRole("button", { name: "Apply", exact: true })
      .waitFor({ state: "hidden", timeout: 60_000 }),
    panel(page).getByRole("alert").first().waitFor({ state: "visible", timeout: 60_000 }),
  ])
  expect(await panel(page).getByRole("alert").allTextContents()).toEqual([])
  await settle(page)
}
async function choose(page: Page, label: string, value: string) {
  await panel(page).getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: value, exact: true }).click()
}
async function planeBinding(page: Page) {
  await panel(page).getByRole("combobox", { name: "Parent frame geometry", exact: true }).click()
  await page
    .getByRole("option", { name: /^PLANE / })
    .first()
    .click()
}
async function authority(page: Page) {
  const { project } = await saveProject(page)
  if (project.snapshot.schemaVersion !== 4)
    throw new Error("General mates require authored V4 authority.")
  return project.snapshot
}

test("solves topology-bound ball and cylindrical mates in the real worker and preserves versioned Undo and reload", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
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
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Frozen link")
  await apply(page)
  const legacy = await authority(page),
    anchor = required(legacy.assembly.instances[0])
  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "More assembly actions", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Enable general mates", exact: true }).click()
  await expect(panel(page).getByText(/Fully constrained · 0 degrees of freedom/)).toBeVisible({
    timeout: 60_000,
  })
  expect((await authority(page)).assembly.schemaVersion).toBe(2)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await settle(page)
  expect((await authority(page)).assembly).toEqual(legacy.assembly)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await settle(page)
  await page.locator(`[data-assembly-instance-id="${anchor.id}"]`).click()
  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "Add joint", exact: true })
    .click()
  await choose(page, "Joint type", "Ball")
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Ball link")
  await planeBinding(page)
  await apply(page)
  await expect(panel(page).getByText(/Under constrained · 3 degrees of freedom/)).toBeVisible()
  const ball = await authority(page),
    child = required(ball.assembly.instances.find((i) => i.name === "Ball link"))
  expect(ball.assembly.joints[0]).toMatchObject({
    schemaVersion: 2,
    kind: "ball",
    parentBinding: { pinRevision: 1, geometry: "planar-face" },
  })
  expect(JSON.stringify(ball.assembly.joints)).not.toContain("candidateId")
  await page.locator(`[data-assembly-instance-id="${anchor.id}"]`).click()
  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "Add joint", exact: true })
    .click()
  await choose(page, "Joint type", "Cylindrical")
  await panel(page)
    .getByRole("checkbox", { name: "Create a new child instance with this joint", exact: true })
    .uncheck()
  await choose(page, "Existing child instance", "Ball link")
  await planeBinding(page)
  await apply(page)
  await expect(panel(page).getByText(/Under constrained · 1 degree of freedom/)).toBeVisible()
  const mated = await authority(page)
  expect(mated.assembly.joints).toHaveLength(2)
  expect(mated.assembly.instances.map((i) => i.id)).toEqual(
    ball.assembly.instances.map((i) => i.id),
  )
  expect(mated.assembly.joints[1]).toMatchObject({
    kind: "cylindrical",
    rotationDriven: false,
    translationDriven: false,
    childInstanceId: child.id,
  })
  await page.reload()
  await saved(page)
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await settle(page)
  await expect(panel(page).getByText(/Under constrained · 1 degree of freedom/)).toBeVisible()
  expect((await authority(page)).assembly).toEqual(mated.assembly)
  // A conflicting fixed mate must fail in preflight without changing authority.
  await page.locator(`[data-assembly-instance-id="${anchor.id}"]`).click()
  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "Add joint", exact: true })
    .click()
  await panel(page)
    .getByRole("checkbox", { name: "Create a new child instance with this joint", exact: true })
    .uncheck()
  await choose(page, "Existing child instance", "Ball link")
  await planeBinding(page)
  await panel(page)
    .getByRole("group", { name: "Parent local joint frame", exact: true })
    .getByRole("spinbutton", { name: "X (mm)", exact: true })
    .fill("1")
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("alert"),
  ).toContainText(/inconsistent|conflict/i, {
    timeout: 60_000,
  })
  await panel(page).getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await authority(page)).revision).toBe(mated.revision)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture evidence is missing.")
  return value
}
