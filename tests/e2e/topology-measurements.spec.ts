import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

test("measures revision-bound analytical edges, faces and explicit point pairs", async ({
  page,
}) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Measure", exact: true }).click()
  const topology = page.getByRole("region", { name: "Topology measurements", exact: true })
  await expect(topology.getByLabel("Element", { exact: true })).toBeVisible()
  const element = topology.getByLabel("Element", { exact: true })
  const faces = element.locator("option").filter({ hasText: /^Face \d+ · PLANE$/ })
  const face = await faces.first().getAttribute("value")
  if (!face) throw new Error("Box must expose analytical planar faces.")
  await element.selectOption(face)
  await expect(topology.getByText("Face area", { exact: true })).toBeVisible()
  await topology.getByLabel("Compare with another element").check()
  await topology.getByLabel("Second element").selectOption(face)
  await expect(topology.getByText("Selected point distance", { exact: true })).toBeVisible()
  await expect(
    topology.getByText("Parallel supporting plane separation", { exact: true }),
  ).toBeVisible()
  await expect(topology.locator("dd").filter({ hasText: /^0 mm$/ })).toHaveCount(2)
  const edge = await element
    .locator("option")
    .filter({ hasText: /^Edge \d+ · LINE$/ })
    .first()
    .getAttribute("value")
  if (!edge) throw new Error("Box must expose analytical straight edges.")
  await element.selectOption(edge)
  await expect(topology.getByText("Edge length", { exact: true })).toBeVisible()
  await topology.getByLabel("Measurement point").first().selectOption("start")
  await topology.getByLabel("Second element").selectOption(edge)
  await topology.getByLabel("Measurement point").nth(1).selectOption("end")
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
  const circle = await element
    .locator("option")
    .filter({ hasText: /^Edge \d+ · CIRCLE$/ })
    .first()
    .getAttribute("value")
  if (!circle) throw new Error("Cylinder must expose analytical circular edges.")
  await element.selectOption(circle)
  await expect(topology.getByText("Diameter", { exact: true })).toBeVisible()
  await expect(topology.getByLabel("Measurement point", { exact: true })).toHaveValue("centroid")
})
