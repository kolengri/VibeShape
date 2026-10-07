import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("previews a hidden source region and opens its sketch from History", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
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

  const hideSketch = page.getByRole("button", { name: "Hide Sketch 1", exact: true })
  if (await hideSketch.count()) await hideSketch.click()
  const showSketch = page.getByRole("button", { name: "Show Sketch 1", exact: true })
  await expect(showSketch).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
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
  await toolbar.getByRole("button", { name: "Box", exact: true }).hover()
  await expect(viewport).not.toHaveAttribute("data-source-profile-preview", /.+/)
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")

  await source.focus()
  await expect(viewport).toHaveAttribute("data-source-profile-preview", /.+/)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeFocused()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await source.click()
  await expect(page.getByRole("treeitem", { name: "Sketch 1", exact: true })).toBeFocused()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Sketch 1", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await expect(showSketch).toBeVisible()
  await page.reload()
  await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
  await expect(source).toHaveText("Sketch 1")
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole("button", { name: "Actions for Sketch 1", exact: true }).click()
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
  const treeBounds = await page
    .getByRole("complementary", { name: "Model tree", exact: true })
    .boundingBox()
  if (!sourceBounds || !treeBounds) throw new Error("Expected visible source and model tree")
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
  await toolbar.getByRole("button", { name: "Box", exact: true }).click()
  const boxForm = page.getByRole("form", { name: "Create box", exact: true })
  await expect(boxForm).toBeVisible()
  await renamedSource.hover()
  await expect(viewport).not.toHaveAttribute("data-source-profile-preview", /.+/)
  await renamedSource.click()
  await expect(boxForm).toHaveCount(0)
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: longName, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await page.setViewportSize({ width: 2048, height: 1536 })
  await page.evaluate("document.documentElement.style.zoom = '2'")
  await renamedSource.focus()
  await expect(renamedSource).toBeFocused()
  const zoomedSource = await renamedSource.boundingBox()
  const zoomedTree = await page
    .getByRole("complementary", { name: "Model tree", exact: true })
    .boundingBox()
  if (!zoomedSource || !zoomedTree) throw new Error("Expected the source at 200% CSS zoom")
  expect(zoomedSource.x + zoomedSource.width).toBeLessThanOrEqual(zoomedTree.x + zoomedTree.width)
  await page.screenshot({
    path: testInfo.outputPath("source-zoom-200.png"),
    animations: "disabled",
  })
})

test("preserves an unsaved sketch and its undo history when activating a History source", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
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
  const source = page.getByRole("button", { name: "Source region 1 from Sketch 1", exact: true })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const lines = drawing.locator('[data-sketch-entity-type="line"]')
  const addLine = async () => {
    await page.getByRole("button", { name: "Line", exact: true }).click()
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("Missing editable sketch geometry.")
    await page.mouse.click(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.75)
    await page.mouse.click(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.85)
    await page.keyboard.press("Escape")
  }
  await addLine()
  await expect(lines).toHaveCount(1)
  await source.click()
  await expect(page.getByRole("alert")).toHaveText(
    "Finish or cancel the current sketch before opening another source sketch.",
  )
  await expect(lines).toHaveCount(1)
  const undo = toolbar.getByRole("button", { name: "Undo", exact: true })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(lines).toHaveCount(0)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await source.click()
  await expect(lines).toHaveCount(4)
  await addLine()
  await expect(lines).toHaveCount(5)
  await source.click()
  await expect(lines).toHaveCount(5)
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(lines).toHaveCount(4)
})
