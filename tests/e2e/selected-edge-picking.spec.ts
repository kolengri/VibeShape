import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { pickSourceEdge } from "./source-edge-picking-support"

async function addBox(page: Page) {
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box" })
  for (const name of ["Width", "Depth", "Height"])
    await form.getByRole("combobox", { name, exact: true }).fill("20 mm")
  await form.getByRole("button", { name: "Create box", exact: true }).click()
}

test("picks a source edge graphically and clears incompatible selection when switching bodies", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await addBox(page)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await addBox(page)
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await invokeModelCommand(page, "Modify", "Fillet")
  const form = page.getByRole("form", { name: "Create fillet" })
  await expect(form.getByRole("radio", { name: "Selected edges", exact: true })).toBeChecked()
  await expect(form.getByRole("status")).toHaveText("No edges selected")
  await pickSourceEdge(page)
  await expect(form.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
  const submit = form.getByRole("button", { name: "Create fillet", exact: true })
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath("graphical-selected-edge.png") })
  await expect(form.getByRole("combobox", { name: "Target body", exact: true })).toHaveCount(0)
  await form.getByText("Keyboard choices", { exact: true }).click()
  await form.getByRole("button", { name: "Box 2 · Edge 1", exact: true }).click()
  await expect(form.locator("[data-edge-treatment-body]")).toHaveText("Box 2")
  await expect(form.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByRole("treeitem", { name: "Fillet 1", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
})
