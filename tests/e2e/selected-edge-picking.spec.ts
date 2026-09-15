import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

async function addBox(page: Page) {
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Box", exact: true })
    .click()
  const form = page.getByRole("form", { name: "Create box" })
  for (const name of ["Width", "Depth", "Height"])
    await form.getByRole("combobox", { name, exact: true }).fill("20 mm")
  await form.getByRole("button", { name: "Create box", exact: true }).click()
}

async function pickSourceEdge(page: Page) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("Expected the source-edge picking canvas.")
  const status = viewport.getByRole("status").filter({ hasText: /^Source edge: Edge \d+$/ })
  const offsets = Array.from({ length: 42 }, (_, i) => (i + 1) * 4).flatMap(
    (radius) =>
      [
        [radius, 0],
        [-radius, 0],
        [0, radius],
        [0, -radius],
        [radius, radius],
        [-radius, radius],
        [radius, -radius],
        [-radius, -radius],
      ] as const,
  )
  for (const [dx, dy] of offsets) {
    const x = bounds.x + bounds.width / 2 + dx
    const y = bounds.y + bounds.height / 2 + dy
    await page.mouse.move(x, y)
    await page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
    if (!(await status.isVisible())) continue
    await page.mouse.click(x, y)
    const overlap = viewport.getByRole("listbox", { name: "Select other reference" })
    if (await overlap.isVisible()) await overlap.getByRole("option").first().click()
    return
  }
  throw new Error("No source edge was available to graphical selection.")
}

test("picks a source edge graphically and explicitly repairs a change to a congruent target", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await addBox(page)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await addBox(page)
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Fillet", exact: true })
    .click()
  const form = page.getByRole("form", { name: "Create fillet" })
  await form.getByRole("radio", { name: "Selected edges", exact: true }).check()
  await pickSourceEdge(page)
  await expect(form.getByRole("button", { name: "Remove edge", exact: true })).toHaveCount(1)
  const submit = form.getByRole("button", { name: "Create fillet", exact: true })
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath("graphical-selected-edge.png") })
  await form.getByRole("combobox", { name: "Target body", exact: true }).selectOption({ index: 1 })
  await expect(
    form.getByText("Missing edge — remove it and select a replacement.", { exact: true }),
  ).toBeVisible()
  await expect(submit).toBeDisabled()
  await form.getByRole("button", { name: "Remove edge", exact: true }).click()
  await form
    .getByRole("combobox", { name: "Choose an edge", exact: true })
    .selectOption({ index: 1 })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByRole("treeitem", { name: "Fillet 1", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
})
