import type { Locator, Page } from "@playwright/test"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

async function assemblyMode(page: Page) {
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await expect(page.getByRole("region", { name: "Assembly task" })).toBeVisible()
}
function panel(page: Page) {
  return page.getByRole("region", { name: "Assembly task" })
}
async function choose(page: Page, label: string, option: string) {
  await panel(page).getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function apply(page: Page) {
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await expect(panel(page).getByRole("button", { name: "Apply", exact: true })).not.toBeVisible()
  await saved(page)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
  await expect(panel(page).getByRole("alert")).toHaveCount(0)
}
async function currentAssembly(page: Page) {
  const archive = await saveProject(page)
  if (archive.project.snapshot.schemaVersion !== 4)
    throw new Error("The assembly must persist in V3 authority.")
  return archive.project.snapshot
}
async function pickOccurrence(page: Page, canvas: Locator) {
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The assembly viewport must have a visible canvas.")
  for (const y of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    for (const x of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
      const selected = await canvas.getAttribute("data-assembly-selected-instance")
      if (selected) return selected
    }
  }
  throw new Error("A rendered occurrence must be selectable through the assembly canvas.")
}
async function addSecondInstance(page: Page) {
  await panel(page).getByRole("button", { name: "Add instance", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Second bracket")
  await panel(page).getByRole("spinbutton", { name: "X (mm)", exact: true }).fill("40")
  await apply(page)
}
async function addRevoluteChild(page: Page, parentId: string) {
  await page.locator(`[data-assembly-instance-id="${parentId}"]`).click()
  await panel(page).getByRole("button", { name: "Add joint", exact: true }).click()
  await choose(page, "Joint type", "Revolute")
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Joint arm")
  await panel(page).getByRole("spinbutton", { name: "Minimum drive", exact: true }).fill("-45")
  await panel(page).getByRole("spinbutton", { name: "Maximum drive", exact: true }).fill("45")
  await panel(page).getByRole("spinbutton", { name: "Drive (deg)", exact: true }).fill("45")
  await apply(page)
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

test("authors independent assembly instances and an atomic joint, inspects interference, preserves pins and restores identities through Undo and reload", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  const before = await saveProject(page)
  await assemblyMode(page)
  await panel(page).getByRole("button", { name: "Create definition", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Bracket")
  await apply(page)
  let authored = await currentAssembly(page)
  const definition = required(
    authored.assembly.definitions[0],
    "The first definition must be captured.",
  )
  const first = required(authored.assembly.instances[0], "The first occurrence must be captured.")
  expect(authored.parts).toEqual(before.project.snapshot.parts)
  expect(definition.sources[0]).toMatchObject({
    kind: "part",
    partId: before.project.snapshot.parts.find(({ name }) => name === "Box 1")?.id,
  })
  expect(first.id).not.toBe(definition.id)
  await addSecondInstance(page)
  authored = await currentAssembly(page)
  const independent = authored.assembly.instances.find(({ name }) => name === "Second bracket")
  if (!independent?.grounded)
    throw new Error("The repeated grounded instance must remain independent.")
  expect(independent.id).not.toBe(first.id)
  expect(independent.definitionId).toBe(first.definitionId)
  expect(independent.worldFrame.translation).toEqual([40, 0, 0])
  await page.locator(`[data-assembly-definition-id="${definition.id}"]`).click()
  const canvas = page.getByRole("img", { name: "Selectable assembly instances" })
  const picked = await pickOccurrence(page, canvas)
  expect([first.id, independent.id]).toContain(picked)
  await page.locator(`[data-assembly-instance-id="${first.id}"]`).click()
  await choose(page, "Compare selected instance with", "Second bracket")
  await panel(page).getByRole("button", { name: "Inspect pair", exact: true }).click()
  await expect(panel(page).getByText(/no positive-volume interference/)).toBeVisible({
    timeout: 60_000,
  })

  await addRevoluteChild(page, first.id)
  authored = await currentAssembly(page)
  const child = required(
    authored.assembly.instances.find(({ name }) => name === "Joint arm"),
    "The joint child must be captured.",
  )
  const joint = required(
    authored.assembly.joints[0],
    "The child's joint must be saved in the same transaction.",
  )
  expect(child.grounded).toBe(false)
  expect(joint).toMatchObject({
    kind: "revolute",
    childInstanceId: child.id,
    parentInstanceId: first.id,
    value: Math.PI / 4,
  })
  const capturedIds = authored.assembly.instances.map(({ id }) => id)
  await page.locator(`[data-assembly-instance-id="${child.id}"]`).click()
  await panel(page).getByRole("button", { name: "Edit joint and drive", exact: true }).click()
  await panel(page).getByRole("spinbutton", { name: "Drive (deg)", exact: true }).fill("46")
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await expect(panel(page).getByRole("alert")).toBeVisible()
  await panel(page).getByRole("spinbutton", { name: "Drive (deg)", exact: true }).fill("0")
  await apply(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await currentAssembly(page)).assembly.joints[0]).toMatchObject({
    id: joint.id,
    value: Math.PI / 4,
  })
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  expect((await currentAssembly(page)).assembly.joints[0]).toMatchObject({ id: joint.id, value: 0 })
  await page.locator(`[data-assembly-instance-id="${child.id}"]`).click()
  await panel(page).getByRole("button", { name: "Ground in current pose", exact: true }).click()
  await saved(page)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
  authored = await currentAssembly(page)
  expect(authored.assembly.joints).toEqual([])
  expect(authored.assembly.instances.find(({ id }) => id === child.id)?.grounded).toBe(true)
  expect(authored.assembly.definitions[0]?.sources).toEqual(definition.sources)
  expect(authored.parts).toEqual(before.project.snapshot.parts)
  await page.reload()
  await saved(page)
  await assemblyMode(page)
  expect((await currentAssembly(page)).assembly.instances.map(({ id }) => id)).toEqual(capturedIds)
  await page.locator(`[data-assembly-instance-id="${child.id}"]`).click()
  await expect(canvas).toHaveAttribute("data-assembly-selected-instance", child.id)
})
