import { saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { expandHistoryDetails, invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("previews a hidden source region and opens its sketch from History", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()

  const hideSketch = page
    .getByRole("complementary", { name: "Model tree", exact: true })
    .getByRole("button", { name: "Hide Sketch 1", exact: true })
  if (await hideSketch.count()) await hideSketch.click()
  const showSketch = page
    .getByRole("complementary", { name: "Model tree", exact: true })
    .getByRole("button", { name: "Show Sketch 1", exact: true })
  await expect(showSketch).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await expandHistoryDetails(page)
  const source = page.getByRole("button", { name: "Source region 1 from Sketch 1", exact: true })
  await expect(source).toHaveText("Sketch 1")
  await expect(page.getByText("Profile from Sketch 1", { exact: true })).toHaveCount(0)
  const selectedProfiles = await viewport.getAttribute("data-selected-sketch-profile-count")
  await source.hover()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "1")
  await expect(viewport).toHaveAttribute("data-source-profile-preview", /.+/)
  await expect(viewport.getByRole("combobox", { name: "Select saved profile" })).toHaveCount(0)
  await expect(page.locator('[data-history-kind="sketch"]')).toHaveAttribute(
    "data-history-source-highlighted",
    "true",
  )
  await expect(showSketch).toBeVisible()
  await expect(viewport).toHaveAttribute(
    "data-selected-sketch-profile-count",
    selectedProfiles ?? "0",
  )
  await page.screenshot({ path: testInfo.outputPath("source-preview.png") })
  await toolbar.getByRole("button", { name: "Primitives", exact: true }).hover()
  await expect(viewport).not.toHaveAttribute("data-source-profile-preview", /.+/)
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")

  await source.focus()
  await expect(viewport).toHaveAttribute("data-source-profile-preview", /.+/)
  await source.hover()
  await page.waitForTimeout(250)
  await page.mouse.wheel(0, 100)
  await toolbar.getByRole("button", { name: "Primitives", exact: true }).hover()
  await expect(source).toBeFocused()
  await expect(viewport).toHaveAttribute("data-source-profile-preview", /.+/)
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "1")
  const otherHistoryRow = page.getByRole("treeitem", { name: "Extrusion 1", exact: true })
  await page.waitForTimeout(150)
  await otherHistoryRow.hover()
  await expect(viewport).not.toHaveAttribute("data-source-profile-preview", /.+/)
  await toolbar.getByRole("button", { name: "Primitives", exact: true }).hover()
  await expect(source).toBeFocused()
  await expect(viewport).toHaveAttribute("data-source-profile-preview", /.+/)
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "1")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeFocused()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await source.click()
  await expect(page.getByRole("treeitem", { name: "Edit Sketch 1", exact: true })).toBeFocused()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Edit Sketch 1", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(showSketch).toBeVisible()
  await page.reload()
  await expandHistoryDetails(page)
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await expect(source).toHaveText("Sketch 1")
  await page.setViewportSize({ width: 1024, height: 768 })
  await page
    .getByRole("region", { name: "Feature history", exact: true })
    .getByRole("button", { name: "Actions for Sketch 1", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Rename Sketch 1…", exact: true }).click()
  const rename = page.getByRole("dialog", { name: "Rename sketch", exact: true })
  const longName = "Mounting bracket base with four clearance holes and alignment references"
  await rename.getByRole("textbox", { name: "Sketch name", exact: true }).fill(longName)
  await rename.getByRole("button", { name: "Rename sketch", exact: true }).click()
  const renamedSource = page.getByRole("button", {
    name: `Source region 1 from ${longName}`,
    exact: true,
  })
  await expect(renamedSource).toHaveText(longName)
  await renamedSource.hover()
  const sourceBounds = await renamedSource.boundingBox()
  const rowBounds = await renamedSource.locator("xpath=ancestor::*[@data-history-id]").boundingBox()
  const treeBounds = await page
    .getByRole("region", { name: "Feature history", exact: true })
    .boundingBox()
  if (!sourceBounds || !treeBounds) throw new Error("Expected visible source and feature history")
  if (!rowBounds) throw new Error("Expected the source inside a History operation")
  expect(rowBounds.width).toBeLessThanOrEqual(192)
  expect(rowBounds.height).toBeLessThanOrEqual(48)
  expect(sourceBounds.x + sourceBounds.width).toBeLessThanOrEqual(rowBounds.x + rowBounds.width)
  expect(sourceBounds.x + sourceBounds.width).toBeLessThanOrEqual(treeBounds.x + treeBounds.width)
  await page.screenshot({
    path: testInfo.outputPath("source-preview-compact-dark.png"),
    animations: "disabled",
  })
  await page.evaluate("document.documentElement.classList.remove('dark')")
  await page.screenshot({
    path: testInfo.outputPath("source-preview-compact-light.png"),
    animations: "disabled",
  })
  await invokeModelCommand(page, "Primitives", "Box")
  const boxForm = page.getByRole("form", { name: "Create box", exact: true })
  await expect(boxForm).toBeVisible()
  const width = boxForm.getByRole("combobox", { name: "Width", exact: true })
  const createBox = boxForm.getByRole("button", { name: "Create box", exact: true })
  await width.fill("-5 mm")
  await width.blur()
  await expect(createBox).toBeDisabled()
  await renamedSource.hover()
  await expect(viewport).not.toHaveAttribute("data-source-profile-preview", /.+/)
  await renamedSource.click()
  await expect(page.getByRole("alert")).toHaveText(
    "The current edit could not be saved. Resolve its errors before opening this source sketch.",
  )
  await expect(boxForm).toBeVisible()
  await expect(width).toHaveValue("-5 mm")
  await width.fill("20 mm")
  await width.blur()
  await expect(createBox).toBeEnabled()
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await renamedSource.click()
  await expect(boxForm).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
  await expect(
    page.getByRole("treeitem", { name: `Edit ${longName}`, exact: true }),
  ).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await page.setViewportSize({ width: 2048, height: 1536 })
  await page.evaluate("document.documentElement.style.zoom = '2'")
  await renamedSource.focus()
  await expect(renamedSource).toBeFocused()
  const zoomedSource = await renamedSource.boundingBox()
  const zoomedTree = await page
    .getByRole("region", { name: "Feature history", exact: true })
    .boundingBox()
  if (!zoomedSource || !zoomedTree) throw new Error("Expected the source at 200% CSS zoom")
  expect(zoomedSource.x + zoomedSource.width).toBeLessThanOrEqual(zoomedTree.x + zoomedTree.width)
  await page.screenshot({
    path: testInfo.outputPath("source-zoom-200.png"),
    animations: "disabled",
  })
})

test("autosaves an unsaved sketch and preserves local undo when reactivating the same History source", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-preview-status",
    "ready",
    { timeout: 30_000 },
  )
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expandHistoryDetails(page)
  const source = page.getByRole("button", { name: "Source region 1 from Sketch 1", exact: true })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const lines = drawing.locator('[data-sketch-entity-type="line"]')
  const addLine = async () => {
    await page.getByRole("button", { name: "Line", exact: true }).click()
    const [drawingBounds, treeBounds, taskBounds] = await Promise.all([
      drawing.boundingBox(),
      page.getByRole("complementary", { name: "Model tree", exact: true }).boundingBox(),
      page.getByRole("complementary", { name: "Sketch task panel", exact: true }).boundingBox(),
    ])
    if (!drawingBounds || !treeBounds || !taskBounds)
      throw new Error("Missing visible sketch modeling area.")
    const left = Math.max(drawingBounds.x, treeBounds.x + treeBounds.width)
    const top = drawingBounds.y
    const width = Math.min(drawingBounds.x + drawingBounds.width, taskBounds.x) - left
    const height = drawingBounds.height
    if (width <= 0 || height <= 0) throw new Error("The sketch modeling area is obscured.")
    await page.mouse.click(left + width * 0.75, top + height * 0.75)
    await page.mouse.click(left + width * 0.85, top + height * 0.85)
    await page.keyboard.press("Escape")
  }
  await addLine()
  await expect(lines).toHaveCount(1)
  const draftLineIds = await lines.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-sketch-entity-id")),
  )
  const undo = toolbar.getByRole("button", { name: "Undo", exact: true })
  const redo = toolbar.getByRole("button", { name: "Redo", exact: true })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(lines).toHaveCount(0)
  await expect(redo).toBeEnabled()
  await redo.click()
  await expect(lines).toHaveCount(1)
  expect(
    await lines.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-sketch-entity-id")),
    ),
  ).toEqual(draftLineIds)
  await source.click()
  await expect(lines).toHaveCount(4)
  await expect(page.getByRole("treeitem", { name: "Edit Sketch 1", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await addLine()
  await expect(lines).toHaveCount(5)
  await source.click()
  await expect(lines).toHaveCount(5)
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(lines).toHaveCount(4)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  const saved = await saveProject(page)
  const secondSketch = saved.project.snapshot.sketches.find(({ label }) => label === "Sketch 2")
  expect(secondSketch?.entities.filter(({ type }) => type === "line").map(({ id }) => id)).toEqual(
    draftLineIds,
  )
  expect(
    saved.project.snapshot.sketches
      .find(({ label }) => label === "Sketch 1")
      ?.entities.filter(({ type }) => type === "line"),
  ).toHaveLength(4)
})
