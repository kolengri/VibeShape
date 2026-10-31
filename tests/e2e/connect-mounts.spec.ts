import { readConnectMountsFeatureParameters } from "../../packages/domain/src/part-design-connect-mounts"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("creates and edits a connector from model centers with preview, Cancel, Undo, and reload", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await saved(page)
  await invokeModelCommand(page, "Create", "Connect Mounts")
  let form = page.getByRole("form", { name: "Connect Mounts", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(form).toBeVisible()
  await expect(form.getByText(/Point coordinates are snapshots/)).toBeVisible()
  for (const [point, face] of [
    [1, 1],
    [2, 2],
  ] as const) {
    await form
      .getByRole("combobox", { name: `Copy model center to point ${point}`, exact: true })
      .click()
    await page.getByRole("option", { name: new RegExp(`Face ${face} center$`) }).click()
  }
  const firstX = await form.getByRole("combobox", { name: "Point 1 X", exact: true }).inputValue()
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(page.getByRole("treeitem", { name: "Connect Mounts 1", exact: true })).toHaveCount(0)
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")

  await invokeModelCommand(page, "Create", "Connect Mounts")
  form = page.getByRole("form", { name: "Connect Mounts", exact: true })
  await form.getByRole("combobox", { name: "Point 1 X", exact: true }).fill(firstX)
  await form.getByRole("button", { name: "Add point", exact: true }).click()
  await form.getByRole("combobox", { name: "Point 3 Y", exact: true }).fill("20 mm")
  await form.getByRole("radio", { name: "All pairs", exact: true }).check()
  await form.getByRole("combobox", { name: "Strut radius", exact: true }).fill("4 mm")
  await expect(form.getByRole("button", { name: "Create connector", exact: true })).toBeDisabled()
  await form.getByRole("combobox", { name: "Strut radius", exact: true }).fill("1.5 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Create connector", exact: true }).dblclick()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Connect Mounts 1", exact: true })).toBeVisible()
  const created = await saveProject(page)
  const connector = created.project.snapshot.features.find((feature) =>
    readConnectMountsFeatureParameters(feature),
  )
  if (!connector) throw new Error("The connector must be saved as one authored feature.")
  expect(readConnectMountsFeatureParameters(connector)?.connectionMode).toBe("complete")
  expect(readConnectMountsFeatureParameters(connector)?.points).toHaveLength(3)
  expect(created.project.snapshot.features).toHaveLength(2)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Connect Mounts 1", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Connect Mounts 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit Connect Mounts", exact: true })
  await form.getByRole("combobox", { name: "Node radius", exact: true }).fill("4 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Update connector", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  const edited = reloaded.project.snapshot.features.find(({ id }) => id === connector.id)
  expect(edited && readConnectMountsFeatureParameters(edited)?.nodeRadius).toBe(4)
  await page.getByRole("treeitem", { name: "Connect Mounts 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit Connect Mounts", exact: true })
  await expect(form.getByRole("combobox", { name: "Node radius", exact: true })).toHaveValue("4 mm")
  await expect(form.getByRole("radio", { name: "All pairs", exact: true })).toBeChecked()
  await page.emulateMedia({ colorScheme: "light" })
  await page.setViewportSize({ width: 512, height: 384 })
  await expect(form.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
  await expect(form.getByRole("button", { name: "Update connector", exact: true })).toBeInViewport()
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})
