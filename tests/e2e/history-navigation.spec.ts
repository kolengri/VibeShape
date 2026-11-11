import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle, unobscuredDrawingBounds } from "./sketch-helpers"

test("navigates the true History prefix without changing full authority and guards invalid edits", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const baseline = await saveProject(page)
  expect(baseline.project.snapshot.features.map(({ label }) => label)).toEqual([
    "Box 1",
    "Cylinder 1",
  ])
  expect(baseline.project.snapshot.history).toHaveLength(2)
  const transport = page.getByRole("group", { name: "History navigation", exact: true })
  // The status shows "n / total"; its button names the position and current item.
  const position = transport
    .getByRole("status", { name: "History position", exact: true })
    .getByRole("button")
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const rows = page.locator('[data-history-kind="feature"] [role="treeitem"]')
  const previous = transport.getByRole("button", { name: "Step back one item", exact: true })
  const next = transport.getByRole("button", { name: "Step forward one item", exact: true })
  const assertPosition = async (count: number) => {
    await expect(position).toHaveAccessibleName(new RegExp(`^${count} of 2: `))
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", String(count))
    await expect(rows).toHaveText(["Box 1", "Cylinder 1"])
    await expect(transport).toHaveAttribute("aria-busy", "false")
  }
  await assertPosition(2)
  await previous.click()
  await assertPosition(1)
  await previous.click()
  await assertPosition(0)
  await expect(previous).toBeDisabled()
  const rolledBack = await saveProject(page)
  expect(rolledBack.project.snapshot).toEqual(baseline.project.snapshot)
  await next.click()
  await assertPosition(1)
  await next.click()
  await assertPosition(2)

  await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit box", exact: true })
  const width = edit.getByRole("combobox", { name: "Width", exact: true })
  await width.fill("-5 mm")
  await width.blur()
  await expect(edit.getByRole("button", { name: "Update box", exact: true })).toBeDisabled()
  await previous.click()
  await expect(transport.getByRole("alert")).toHaveText(
    "Could not move through History. Resolve the active edit and try again.",
  )
  await assertPosition(2)
  await expect(edit).toBeVisible()
  await expect(width).toHaveValue("-5 mm")
  await edit.getByRole("button", { name: "Cancel", exact: true }).click()
  await previous.click()
  await assertPosition(1)
  await transport.getByRole("button", { name: "Return to the full model", exact: true }).click()
  await assertPosition(2)
  const after = await saveProject(page)
  expect(after.project.snapshot.revision).toBe(baseline.project.snapshot.revision)
  expect(after.project.snapshot).toEqual(baseline.project.snapshot)
})

test("tracks early sketch rollback and saves its draft through guarded forward and full-model navigation", async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto("/")
  await saved(page)
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const extrusion = page.getByRole("form", { name: "Extrude profile", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await extrusion.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(extrusion).not.toBeVisible()
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(box).not.toBeVisible()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  const transport = page.getByRole("group", { name: "History navigation", exact: true })
  // The status shows "n / total"; its button names the position and current item.
  const position = transport
    .getByRole("status", { name: "History position", exact: true })
    .getByRole("button")
  const next = transport.getByRole("button", { name: "Step forward one item", exact: true })
  const last = transport.getByRole("button", { name: "Return to the full model", exact: true })
  const historyRows = page.locator("[data-history-id]")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const lines = drawing.locator('[data-sketch-entity-type="line"]')
  const editProfile = async () => {
    await page.getByRole("treeitem", { name: "Edit Sketch 1", exact: true }).click()
    await expect(position).toHaveAccessibleName("1 of 3: Sketch 1")
    await expect(page.locator("section[data-sketch-context-mode]")).toHaveAttribute(
      "data-rendered-feature-count",
      "0",
    )
    await expect(historyRows).toHaveCount(3)
    await expect(next).toBeEnabled()
    await expect(last).toBeEnabled()
  }
  const addLine = async (offset: number) => {
    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await page.getByRole("button", { name: "Line", exact: true }).click()
    // The workspace publishes the canvas region left free by floating windows.
    const { x: left, y: top, width, height } = await unobscuredDrawingBounds(page, drawing)
    // Stay above the bottom-centered "Final result" display bar.
    await page.mouse.click(left + width * offset, top + height * 0.6)
    await page.mouse.click(left + width * (offset + 0.1), top + height * 0.68)
    await page.keyboard.press("Escape")
  }

  await editProfile()
  await expect(lines).toHaveCount(4)
  await addLine(0.75)
  await expect(lines).toHaveCount(5)
  await last.click()
  await expect(drawing).toHaveCount(0)
  await expect(position).toHaveAccessibleName("3 of 3: Full model")
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  const returned = await saveProject(page)
  expect(
    returned.project.snapshot.sketches[0]?.entities.filter(({ type }) => type === "line"),
  ).toHaveLength(5)

  await editProfile()
  await addLine(0.55)
  await expect(lines).toHaveCount(6)
  await next.click()
  await expect(drawing).toHaveCount(0)
  await expect(position).toHaveAccessibleName("2 of 3: Extrusion 1")
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await expect(historyRows).toHaveCount(3)
  const stepped = await saveProject(page)
  expect(
    stepped.project.snapshot.sketches[0]?.entities.filter(({ type }) => type === "line"),
  ).toHaveLength(6)
  expect(stepped.project.snapshot.features).toHaveLength(2)
  expect(stepped.project.snapshot.history).toEqual(returned.project.snapshot.history)
  await last.click()
  await expect(position).toHaveAccessibleName("3 of 3: Full model")
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
})
