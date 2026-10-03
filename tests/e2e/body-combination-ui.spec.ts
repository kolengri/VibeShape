import type { Page, TestInfo } from "@playwright/test"
import {
  readCompoundFeatureParameters,
  readUnionFeatureParameters,
} from "../../packages/domain/src/part-design-body-combination"
import {
  createSolids,
  deleteFeatureAndUndo,
  openProject,
  saved,
  saveProject,
} from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

async function verifyCompoundReorder(page: Page, testInfo: TestInfo) {
  const parts = page.locator("[data-part-id]")
  const ids = await parts.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-part-id")),
  )
  await page.getByRole("button", { name: "Compound", exact: true }).click()
  let form = page.getByRole("form", { name: "Create Compound", exact: true })
  await form.getByRole("button", { name: "Add part Box 1", exact: true }).click()
  await form.getByRole("button", { name: "Add part Cylinder 1", exact: true }).click()
  await form.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Compound 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const compound = await saveProject(page)
  const feature = compound.project.snapshot.features.find((feature) =>
    readCompoundFeatureParameters(feature),
  )
  if (!feature) throw new Error("Compound must be an authored feature.")
  const slots = readCompoundFeatureParameters(feature)?.slots
  expect(slots).toHaveLength(2)
  expect(compound.project.snapshot.parts.map(({ id }) => id)).toEqual(ids)
  expect(compound.project.snapshot.parts.every(({ consumedBy }) => consumedBy === null)).toBe(true)
  expect(
    compound.project.snapshot.parts.map(({ bodyHistory }) => bodyHistory.at(-1)?.outputRole),
  ).toEqual(slots?.map(({ slotId }) => `body.${slotId}`))
  await expect(page.getByRole("button", { name: "Union", exact: true })).toBeEnabled()
  await page.getByRole("treeitem", { name: "Compound 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit Compound", exact: true })
  await expect(form.getByText(/Sibling outputs from the same feature are supported/)).toBeVisible()
  await form.getByRole("button", { name: "Move Cylinder 1 earlier", exact: true }).click()
  await form.getByRole("button", { name: "Update", exact: true }).click()
  await expect(form).not.toBeVisible()
  await saved(page)
  const reordered = await saveProject(page)
  const changed = reordered.project.snapshot.features.find(({ id }) => id === feature.id)
  if (!changed) throw new Error("Editing must preserve the Compound feature ID.")
  expect(readCompoundFeatureParameters(changed)?.slots).toEqual(slots?.slice().reverse())
  const restored = await deleteFeatureAndUndo(page, "Compound 1")
  expect(restored.project.snapshot.features).toEqual(reordered.project.snapshot.features)
  expect(restored.project.snapshot.parts).toEqual(reordered.project.snapshot.parts)
  await page.screenshot({ path: testInfo.outputPath("compound-independent-parts.png") })
  for (let index = 0; index < 2; index++) {
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await saved(page)
  }
  await expect(page.getByRole("treeitem", { name: "Compound 1", exact: true })).toHaveCount(0)
}

async function createUnion(page: Page) {
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Box", exact: true })
    .click()
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Box 2", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const allIds = await page
    .locator("[data-part-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-part-id")))
  await page.getByRole("button", { name: "Union", exact: true }).click()
  const form = page.getByRole("form", { name: "Create Union", exact: true })
  await form.getByRole("button", { name: "Add part Cylinder 1", exact: true }).click()
  await form.getByRole("button", { name: "Add part Box 1", exact: true }).click()
  await expect(form.getByRole("status")).toContainText("Cylinder 1 keeps its name and identity")
  await form.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Union 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const unionArchive = await saveProject(page)
  const union = unionArchive.project.snapshot.features.find((feature) =>
    readUnionFeatureParameters(feature),
  )
  if (!union) throw new Error("Union must be an authored feature.")
  expect(unionArchive.project.snapshot.parts[0]?.consumedBy).toBe(union.id)
  expect(unionArchive.project.snapshot.parts[1]?.bodyHistory.at(-1)?.featureId).toBe(union.id)
  return { unionId: union.id, allIds }
}

async function repairSuppressedUnionSource(page: Page, unionId: string) {
  await page.getByRole("button", { name: "Suppress Box 1", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Union 1", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit Union", exact: true })
  await expect(form.getByRole("button", { name: "Remove part Box 1", exact: true })).toBeVisible()
  await form.getByRole("button", { name: "Remove part Box 1", exact: true }).click()
  await form.getByRole("button", { name: "Add part Box 2", exact: true }).click()
  await form.getByRole("button", { name: "Update", exact: true }).click()
  await expect(form).not.toBeVisible()
  await saved(page)
  const repaired = await saveProject(page)
  const repairedUnion = repaired.project.snapshot.features.find(({ id }) => id === unionId)
  if (!repairedUnion) throw new Error("Repair must preserve the Union feature identity.")
  expect(repairedUnion.suppressed).toBe(false)
  expect(repaired.project.snapshot.parts[0]?.consumedBy).toBeNull()
  expect(repaired.project.snapshot.parts[2]?.consumedBy).toBe(unionId)
  expect(readUnionFeatureParameters(repairedUnion)?.bodies).toEqual([
    {
      schemaVersion: 0,
      featureId: repaired.project.snapshot.features.find(({ label }) => label === "Cylinder 1")?.id,
      outputRole: "result",
    },
    {
      schemaVersion: 0,
      featureId: repaired.project.snapshot.features.find(({ label }) => label === "Box 2")?.id,
      outputRole: "result",
    },
  ])
}

async function verifyUnionSurvivorAndArchive(
  page: Page,
  testInfo: TestInfo,
  unionId: string,
  allIds: (string | null)[],
) {
  await page.getByRole("treeitem", { name: "Union 1", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit Union", exact: true })
  await form.getByRole("button", { name: "Move Box 2 earlier", exact: true }).click()
  await expect(form.getByRole("status")).toContainText("Box 2 keeps its name and identity")
  await form.getByRole("button", { name: "Update", exact: true }).click()
  await expect(form).not.toBeVisible()
  await saved(page)
  await page.reload()
  await saved(page)
  const final = await saveProject(page)
  expect(final.project.snapshot.parts.map(({ id }) => id)).toEqual(allIds)
  expect(final.project.snapshot.parts[2]?.bodyHistory.at(-1)?.featureId).toBe(unionId)
  expect(final.project.snapshot.parts[1]?.consumedBy).toBe(unionId)
  await openProject(page, final)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.id).not.toBe(final.project.snapshot.id)
  expect(imported.project.snapshot.parts).toEqual(final.project.snapshot.parts)
  expect(imported.project.snapshot.features).toEqual(final.project.snapshot.features)
  const restored = await deleteFeatureAndUndo(page, "Union 1")
  expect(restored.project.snapshot.features).toEqual(imported.project.snapshot.features)
  expect(restored.project.snapshot.parts).toEqual(imported.project.snapshot.parts)
  await page.screenshot({ path: testInfo.outputPath("union-surviving-part.png") })
}

test("keeps Compound solids and slot identities distinct, then explicitly fuses a chosen Union survivor", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await verifyCompoundReorder(page, testInfo)
  const { unionId, allIds } = await createUnion(page)
  await repairSuppressedUnionSource(page, unionId)
  await verifyUnionSurvivorAndArchive(page, testInfo, unionId, allIds)
})
