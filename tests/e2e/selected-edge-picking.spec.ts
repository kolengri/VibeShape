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

async function pickIdleEdge(page: Page) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("Expected the ordinary edge picking canvas.")
  const status = viewport.getByRole("status").filter({ hasText: /^Box 1 · Edge \d+$/ })
  for (let radius = 4; radius <= 168; radius += 4) {
    for (const [dx, dy] of [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius, radius],
      [-radius, radius],
      [radius, -radius],
      [-radius, -radius],
    ]) {
      const x = bounds.x + bounds.width / 2 + (dx ?? 0)
      const y = bounds.y + bounds.height / 2 + (dy ?? 0)
      await page.mouse.move(x, y)
      await page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
      if (!(await status.isVisible())) continue
      await page.mouse.click(x, y)
      return
    }
  }
  throw new Error("No visible ordinary CAD edge was available to pointer selection.")
}

for (const operation of ["fillet", "chamfer"] as const) {
  test(`picks a circular rim with the pointer for ${operation}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Cylinder")
    const cylinder = page.getByRole("form", { name: "Create cylinder" })
    await cylinder.getByRole("combobox", { name: "Radius", exact: true }).fill("20 mm")
    await cylinder.getByRole("combobox", { name: "Height", exact: true }).fill("0.5 mm")
    await cylinder.getByRole("button", { name: "Create cylinder", exact: true }).click()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await invokeModelCommand(page, "Modify", operation === "fillet" ? "Fillet" : "Chamfer")
    const form = page.getByRole("form", { name: `Create ${operation}` })
    await form
      .getByRole("combobox", { name: operation === "fillet" ? "Radius" : "Distance", exact: true })
      .fill("0.05 mm")
    const keyboardPicker = form.getByText("Keyboard choices", { exact: true })
    expect(await keyboardPicker.evaluate((element) => Boolean(element.closest(".sr-only")))).toBe(
      true,
    )
    await pickSourceEdge(page)
    await expect(form.getByRole("status")).toHaveText("1 edge selected")
    await expect(form.getByText("Ambiguous edge", { exact: false })).toHaveCount(0)
    await form.getByRole("button", { name: `Create ${operation}`, exact: true }).click()
    await expect(
      page.getByRole("treeitem", {
        name: operation === "fillet" ? "Fillet 1" : "Chamfer 1",
        exact: true,
      }),
    ).toBeVisible()
  })

  test(`uses an ordinary viewport edge as the initial ${operation} selection`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await addBox(page)
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    if (operation === "fillet") {
      await pickIdleEdge(page)
    } else {
      const picker = viewport.getByRole("combobox", { name: "Model edge", exact: true })
      await picker.focus()
      await picker.selectOption({ index: 1 })
    }
    await expect(
      page.getByRole("status").filter({ hasText: /^Selection: Box 1 · 1 edge$/ }),
    ).toBeVisible()
    const title = operation === "fillet" ? "Fillet" : "Chamfer"
    await invokeModelCommand(page, "Modify", title)
    const form = page.getByRole("form", { name: `Create ${operation}` })
    await expect(form.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
    const submit = form.getByRole("button", { name: `Create ${operation}`, exact: true })
    await expect(submit).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath(`ordinary-edge-${operation}.png`) })
    await submit.click()
    await expect(page.getByRole("treeitem", { name: `${title} 1`, exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  })
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
  await form.getByText("Keyboard choices", { exact: true }).focus()
  await form.getByText("Keyboard choices", { exact: true }).click()
  await form.getByRole("button", { name: "Box 2 · Edge 1", exact: true }).click()
  await expect(form.locator("[data-edge-treatment-body]")).toHaveText("Box 2")
  await expect(form.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByRole("treeitem", { name: "Fillet 1", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
})
