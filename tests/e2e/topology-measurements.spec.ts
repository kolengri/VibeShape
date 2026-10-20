import type { Locator, Page } from "@playwright/test"
import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function selectElement(page: Page, trigger: Locator, search: string, name: string | RegExp) {
  await trigger.click()
  await page.getByRole("combobox", { name: "Search options…", exact: true }).fill(search)
  const option = page.getByRole("option", { name, exact: typeof name === "string" }).first()
  const label = await option.innerText()
  await option.click()
  return label
}

test("measures revision-bound analytical edges, faces and explicit point pairs", async ({
  page,
}) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await invokeModelCommand(page, "Inspect", "Measure")
  const topology = page.getByRole("region", { name: "Topology measurements", exact: true })
  await expect(topology.getByLabel("Element", { exact: true })).toBeVisible()
  const element = topology.getByLabel("Element", { exact: true })
  const face = await selectElement(page, element, "PLANE", /^Face \d+ · PLANE$/)
  await expect(topology.getByText("Face area", { exact: true })).toBeVisible()
  await topology.getByLabel("Compare with another element").check()
  await selectElement(
    page,
    topology.getByRole("combobox", { name: "Second element", exact: true }),
    face,
    face,
  )
  await expect(topology.getByText("Selected point distance", { exact: true })).toBeVisible()
  await expect(
    topology.getByText("Parallel supporting plane separation", { exact: true }),
  ).toBeVisible()
  await expect(topology.locator("dd").filter({ hasText: /^0 mm$/ })).toHaveCount(2)
  const edge = await selectElement(page, element, "LINE", /^Edge \d+ · LINE$/)
  await expect(topology.getByText("Edge length", { exact: true })).toBeVisible()
  const pointGroups = topology.getByRole("group", { name: "Measurement point", exact: true })
  await pointGroups.first().getByRole("radio", { name: "Start point", exact: true }).check()
  await selectElement(
    page,
    topology.getByRole("combobox", { name: "Second element", exact: true }),
    edge,
    edge,
  )
  await pointGroups.nth(1).getByRole("radio", { name: "End point", exact: true }).check()
  const length = topology
    .locator("dt")
    .filter({ hasText: /^Edge length$/ })
    .locator("..")
    .locator("dd")
  const distance = topology
    .locator("dt")
    .filter({ hasText: /^Selected point distance$/ })
    .locator("..")
    .locator("dd")
  await expect(distance).toHaveText(await length.innerText())
  await page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }).click()
  await expect(topology.getByLabel("Element", { exact: true })).toBeVisible()
  await selectElement(page, element, "CIRCLE", /^Edge \d+ · CIRCLE$/)
  await expect(topology.getByText("Diameter", { exact: true })).toBeVisible()
  await expect(pointGroups.getByRole("radio", { name: "Centroid", exact: true })).toBeChecked()
})
