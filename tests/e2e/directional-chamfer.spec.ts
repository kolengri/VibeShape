import { saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { pickSourceEdge } from "./source-edge-picking-support"

test("creates an actual two-distance Chamfer with an explicitly picked side face", async ({
  page,
}) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  for (const dimension of ["Width", "Depth", "Height"])
    await box.getByRole("combobox", { name: dimension, exact: true }).fill("20 mm")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Top", exact: true }).click()
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await invokeModelCommand(page, "Modify", "Chamfer")
  const form = page.getByRole("form", { name: "Create chamfer", exact: true })
  await pickSourceEdge(page)
  await form
    .getByRole("combobox", { name: "Chamfer mode", exact: true })
    .selectOption("two-distances")
  await form.getByRole("combobox", { name: "Distance", exact: true }).fill("3 mm")
  await form.getByRole("combobox", { name: "Second distance", exact: true }).fill("1 mm")
  await expect(form.getByRole("button", { name: "Create chamfer", exact: true })).toBeDisabled()
  await form.getByRole("button", { name: /^Pick side face for Edge \d+$/ }).click()
  await expect(form.getByRole("button", { name: /^Pick side face for Edge \d+$/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The body must have a visible picking canvas.")
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(form.getByRole("button", { name: "Clear side face", exact: true })).toBeVisible()
  await form.getByRole("button", { name: /^Pick side face for Edge \d+$/ }).click()
  await expect(viewport.getByText("Unsaved edge treatment preview", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await form.getByRole("checkbox", { name: "Flip direction", exact: true }).check()
  await expect(form.getByRole("button", { name: "Create chamfer", exact: true })).toBeEnabled()
  for (const theme of ["light", "dark"]) {
    await page
      .locator("html")
      .evaluate((element, value) => element.classList.toggle("dark", value === "dark"), theme)
    const headerBackground = await form
      .locator('[data-slot="task-panel-header"]')
      .evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor,
      )
    expect(headerBackground).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/)
  }
  await page.screenshot({ path: test.info().outputPath("two-distance-chamfer.png") })
  await form.getByRole("button", { name: "Create chamfer", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Chamfer 1", exact: true })).toBeVisible()
  const saved = await saveProject(page)
  const feature = saved.project.snapshot.features.find(({ label }) => label === "Chamfer 1")
  expect(feature?.type.schemaVersion).toBe(3)
  expect(feature?.references).toEqual([])
  expect(feature?.parameters).toMatchObject({
    mode: "two-distances",
    distance: { value: 3 },
    secondDistance: { value: 1 },
    flip: true,
    targets: [{ kind: "edge", sideFace: { kind: "face" } }],
  })
})
