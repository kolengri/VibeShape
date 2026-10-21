import { readFile } from "node:fs/promises"
import type { Locator, Page } from "@playwright/test"
import { transformPoint } from "../../packages/formats/src/import/affine"
import { DEFAULT_IMPORT_LIMITS } from "../../packages/formats/src/import/contracts"
import { parseThreeMfGeometry } from "../../packages/formats/src/import/three-mf"
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
  if (archive.project.snapshot.schemaVersion !== 4 && archive.project.snapshot.schemaVersion !== 5)
    throw new Error("Expected persisted assembly authority.")
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
  const definition = panel(page).getByRole("combobox", { name: "Definition", exact: true })
  await definition.click()
  await page.getByRole("combobox", { name: "Search options…", exact: true }).fill("Bracket")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).not.toBeVisible()
  await expect(definition).toBeFocused()
  await expect(panel(page).getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Second bracket",
  )
  await expect(panel(page).getByRole("spinbutton", { name: "X (mm)", exact: true })).toHaveValue(
    "40",
  )
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
  await assemblyAction(page, `Edit Revolute joint with ${first.name}`)
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
  await assemblyAction(page, "Ground in current pose")
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

async function assemblyAction(page: Page, name: string) {
  await panel(page).getByRole("button", { name: "More assembly actions", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}
async function placedMeshVertices(page: Page) {
  await panel(page).getByRole("button", { name: "Export assembly…", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Export assembly…", exact: true })
  await dialog.getByRole("combobox", { name: "Instances to export", exact: true }).click()
  await page.getByRole("option", { name: "All assembly instances", exact: true }).click()
  const downloading = page.waitForEvent("download", { timeout: 60_000 })
  await dialog.getByRole("button", { name: "Save 3MF file", exact: true }).click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("Expected an actual placed assembly mesh download.")
  const parsed = await parseThreeMfGeometry(await readFile(path), DEFAULT_IMPORT_LIMITS)
  if (parsed.kind !== "triangle-mesh") throw new Error("Expected placed assembly meshes.")
  const result = parsed.nodes
    .map((node) => {
      const mesh = required(
        parsed.meshes.find(({ id }) => id === node.meshId),
        "Missing occurrence mesh.",
      )
      return {
        name: mesh.label,
        vertices: mesh.vertices
          .map((vertex) =>
            transformPoint(node.transform, vertex)
              .map((value) => Math.round(value * 1e5) / 1e5)
              .join(","),
          )
          .sort(),
      }
    })
    .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""))
  await dialog.getByRole("button", { name: "Close export", exact: true }).click()
  return result
}
async function placedInstance(
  page: Page,
  name: string,
  translation: readonly number[],
  rotation: readonly number[],
) {
  await panel(page).getByRole("button", { name: "Add instance", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill(name)
  for (const [index, axis] of ["X", "Y", "Z"].entries()) {
    await panel(page)
      .getByRole("spinbutton", { name: `${axis} (mm)`, exact: true })
      .fill(String(translation[index] ?? 0))
    await panel(page)
      .getByRole("spinbutton", { name: `${axis} (deg)`, exact: true })
      .fill(String(rotation[index] ?? 0))
  }
  await apply(page)
}

test("preserves actual placements through as-built joints and one-Undo rigid groups, rejecting an unanchored batch atomically", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await assemblyMode(page)
  await panel(page).getByRole("button", { name: "Create definition", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Pose bracket")
  await apply(page)
  await placedInstance(page, "Pose arm", [40, 10, 5], [0, 0, 90])
  await placedInstance(page, "Pose cap", [10, 50, 15], [90, 0, 0])
  await assemblyAction(page, "Enable general mates")
  await saved(page)
  await expect(panel(page).getByText(/Fully constrained · 0 degrees of freedom/)).toBeVisible({
    timeout: 60_000,
  })
  const before = await currentAssembly(page)
  const anchor = required(before.assembly.instances[0], "Missing group anchor.")
  const arm = required(
    before.assembly.instances.find(({ name }) => name === "Pose arm"),
    "Missing existing arm.",
  )
  const cap = required(
    before.assembly.instances.find(({ name }) => name === "Pose cap"),
    "Missing existing cap.",
  )
  const vertices = await placedMeshVertices(page)
  expect(vertices).toHaveLength(3)
  await page.locator(`[data-assembly-instance-id="${anchor.id}"]`).click()
  await assemblyAction(page, "As-built joint")
  await panel(page)
    .getByRole("combobox", { name: "Child instance", exact: true })
    .selectOption(arm.id)
  await panel(page)
    .getByRole("combobox", { name: "Joint type", exact: true })
    .selectOption("revolute")
  await apply(page)
  const joined = await currentAssembly(page)
  expect(joined.revision).toBe(before.revision + 1)
  expect(joined.assembly.instances.map(({ id }) => id)).toEqual(
    before.assembly.instances.map(({ id }) => id),
  )
  expect(joined.assembly.joints[0]).toMatchObject({
    kind: "revolute",
    parentInstanceId: anchor.id,
    childInstanceId: arm.id,
    value: 0,
  })
  expect(await placedMeshVertices(page)).toEqual(vertices)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await currentAssembly(page)).assembly).toEqual(before.assembly)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
  const groupRevision = (await currentAssembly(page)).revision
  await assemblyAction(page, "Rigid group")
  await panel(page).getByRole("checkbox", { name: arm.name, exact: true }).check()
  await panel(page).getByRole("checkbox", { name: cap.name, exact: true }).check()
  await apply(page)
  const grouped = await currentAssembly(page)
  expect(grouped.revision).toBe(groupRevision + 1)
  expect(grouped.assembly.joints).toHaveLength(2)
  expect(
    grouped.assembly.joints.every(
      (joint) => joint.kind === "fixed" && joint.parentInstanceId === anchor.id,
    ),
  ).toBe(true)
  expect(grouped.assembly.instances.filter(({ grounded }) => grounded).map(({ id }) => id)).toEqual(
    [anchor.id],
  )
  expect(await placedMeshVertices(page)).toEqual(vertices)
  await assemblyAction(page, "As-built joint")
  await panel(page)
    .getByRole("combobox", { name: "Parent instance", exact: true })
    .selectOption(arm.id)
  await panel(page)
    .getByRole("combobox", { name: "Child instance", exact: true })
    .selectOption(anchor.id)
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "The assembled placement could not be connected." }),
  ).toBeVisible()
  await expect(
    panel(page).getByRole("heading", { name: "As-built joint", exact: true }),
  ).toBeVisible()
  await panel(page).getByRole("button", { name: "Cancel", exact: true }).click()
  const rejected = await currentAssembly(page)
  expect(rejected.revision).toBe(grouped.revision)
  expect(rejected.assembly).toEqual(grouped.assembly)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await currentAssembly(page)).assembly).toEqual(before.assembly)
  await page.reload()
  await saved(page)
  expect((await currentAssembly(page)).assembly).toEqual(before.assembly)
})
