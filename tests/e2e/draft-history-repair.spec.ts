import type { Locator, Page } from "@playwright/test"
import { boxFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { readDraftFeatureParameters } from "../../packages/domain/src/part-design-draft"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { expandHistoryDetails, invokeModelCommand } from "./model-command-support"

async function createBox(page: Page, number: number) {
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: `Part Box ${number}`, exact: true })).toBeVisible(
    { timeout: 30_000 },
  )
  await saved(page)
}

/** Checks the catalogue rows whose center lies at half the box height: the four side faces. */
async function checkSideFaces(form: Locator, height: number) {
  await form.locator("summary").click()
  const sideCenter = `, ${(height / 2).toFixed(2)}) mm`
  let checked = 0
  for (const face of await form.locator('input[type="checkbox"][name="draft-faces"]').all()) {
    const name = await face.evaluate(
      (element) => element.closest("label")?.textContent ?? element.getAttribute("aria-label"),
    )
    if (!name?.endsWith(sideCenter)) continue
    await face.check()
    checked += 1
  }
  expect(checked).toBe(4)
}

async function deleteFeature(page: Page, name: string) {
  await expandHistoryDetails(page)
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole("menuitem", { name: `Delete ${name}…`, exact: true }).click()
  const confirmation = page.getByRole("alertdialog", { name: `Delete ${name}?`, exact: true })
  await confirmation.getByRole("button", { name: "Delete feature", exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  await expect(page.getByRole("treeitem", { name, exact: true })).toHaveCount(0)
  await saved(page)
}

test("repairs a Draft whose target body and neutral face were deleted onto another body", async ({
  page,
}) => {
  test.setTimeout(240_000)
  page.setDefaultTimeout(15_000)
  await page.goto("/")
  await saved(page)
  await createBox(page, 1)
  await createBox(page, 2)
  const before = (await saveProject(page)).project.snapshot.features
  const box1 = before.find(({ label }) => label === "Box 1")
  const box2 = before.find(({ label }) => label === "Box 2")
  if (!box1 || !box2) throw new Error("Both boxes must be authored.")
  const height = boxFeatureParametersSchema.parse(box2.parameters).height.value

  // The saved neutral plane is a face of Box 2, so it cannot move to the replacement body.
  await page.getByRole("treeitem", { name: "Part Box 2", exact: true }).click()
  await page.getByRole("button", { name: "Draft", exact: true }).click()
  const create = page.getByRole("form", { name: "Draft", exact: true })
  await checkSideFaces(create, height)
  await create
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption({ label: "Box 2 · result · primitive.box.cap.start" })
  const apply = create.getByRole("button", { name: "Apply draft", exact: true })
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.click()
  await expect(page.getByRole("treeitem", { name: "Draft 1", exact: true })).toBeVisible()
  await saved(page)

  await deleteFeature(page, "Box 2")
  await page.getByRole("treeitem", { name: "Draft 1", exact: true }).click()
  await page
    .getByRole("combobox", { name: "Replacement body", exact: true })
    .selectOption({ label: "Box 1" })
  const form = page.getByRole("form", { name: "Edit draft", exact: true })
  const update = form.getByRole("button", { name: "Update draft", exact: true })
  const source = form.getByRole("combobox", { name: "Reference source", exact: true })
  await expect(source).toHaveValue("")
  await expect(source.locator("option:checked")).toHaveText("Choose a plane")
  await expect(update).toBeDisabled()

  await checkSideFaces(form, height)
  await expect(form.getByText("4 / 6 faces selected", { exact: true })).toBeVisible()
  // Each neutral-plane source in turn yields a valid preview on the replacement body.
  await source.selectOption({ label: "Origin reference" })
  await expect(form.getByRole("combobox", { name: "Reference plane", exact: true })).toHaveValue(
    "XY",
  )
  await expect(update).toBeEnabled({ timeout: 30_000 })
  await source.selectOption({ label: "Box 1 · result · primitive.box.cap.start" })
  await expect(update).toBeEnabled({ timeout: 30_000 })
  await source.selectOption({ label: "Explicit reference" })
  await expect(form.getByRole("spinbutton", { name: "Direction Z", exact: true })).toHaveValue("1")
  await expect(update).toBeEnabled({ timeout: 30_000 })
  await update.click()
  await saved(page)

  const repaired = (await saveProject(page)).project.snapshot
  const draft = repaired.features.find((feature) => readDraftFeatureParameters(feature))
  const parameters = draft ? readDraftFeatureParameters(draft) : null
  expect(parameters?.targetBody).toMatchObject({ featureId: box1.id, outputRole: "result" })
  expect(parameters?.faces).toHaveLength(4)
  expect(parameters?.neutralPlane).toEqual({
    kind: "explicit-plane",
    origin: [0, 0, 0],
    normal: [0, 0, 1],
  })
  expect("repairIntents" in repaired ? repaired.repairIntents : []).toEqual([])
})
