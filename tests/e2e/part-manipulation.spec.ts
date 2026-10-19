import type { Locator, Page } from "@playwright/test"
import { boxFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { readPlacementFeatureParameters } from "../../packages/domain/src/part-design-placement"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function projectedGizmo(canvas: Locator, attribute: string) {
  const bounds = await canvas.boundingBox()
  const raw = await canvas.getAttribute(attribute)
  if (!bounds || !raw) throw new Error("The tool handle has no projected position.")
  const [x, y] = raw.split(",").map(Number)
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
    throw new Error("Invalid projected handle.")
  return { x: bounds.x + x, y: bounds.y + y }
}

async function sourceBox(page: Page, translated = false) {
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  if (translated)
    for (const [axis, value] of [
      ["X", 10],
      ["Y", 20],
      ["Z", 30],
    ] as const)
      await form.getByRole("combobox", { name: `Origin ${axis}`, exact: true }).fill(`${value} mm`)
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await saved(page)
}

async function centeredSourceBox(page: Page) {
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("combobox", { name: "Height", exact: true }).fill("40 mm")
  await form
    .getByRole("checkbox", { name: "Center height about placement origin", exact: true })
    .check()
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await saved(page)
}

async function dragSplitTowardNegative(page: Page, form: Locator, pixels: number) {
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const canvas = viewport.locator("canvas")
  const offset = form.getByRole("combobox", { name: "Plane offset", exact: true })
  const before = Number.parseFloat(await offset.inputValue())
  const origin = await projectedGizmo(canvas, "data-translation-gizmo-origin")
  await dragHandle(page, { x: origin.x, y: origin.y - 82 }, { x: 0, y: pixels })
  const distance = Number.parseFloat(await offset.inputValue())
  expect(distance).toBeLessThan(0)
  expect(distance).toBeLessThan(before)
  await expect(viewport).toHaveAttribute("data-axial-gizmo-distance", String(distance))
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(viewport).toHaveAttribute("data-preview-feature-count", "2")
  await expect(form.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled()
  const plane = await viewport.getAttribute("data-tool-plane-origin")
  if (!plane) throw new Error("The signed cut plane is unavailable.")
  expect(Number(plane.split(",")[2])).toBeCloseTo(distance)
}

type Backup = Awaited<ReturnType<typeof saveProject>>

async function openPlacement(page: Page) {
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Place / align faces", exact: true }).click()
  return page.getByRole("form", { name: "Place part", exact: true })
}

async function expectRotatedSourceCenter(viewport: Locator, before: Backup) {
  const box = before.project.snapshot.features[0]
  if (!box) throw new Error("Missing source box.")
  const p = boxFeatureParametersSchema.parse(box.parameters)
  const center = [
    p.origin.x.value,
    p.origin.y.value,
    p.origin.z.value + p.height.value / 2,
  ] as const
  const raw = await viewport.getAttribute("data-translation-gizmo-position")
  if (!raw) throw new Error("The placement center is unavailable.")
  const position = raw.split(",").map(Number)
  expect(position).toHaveLength(3)
  expect(position.every(Number.isFinite)).toBe(true)
  expect(position[0]).toBeCloseTo(-center[1] + 5)
  expect(position[1]).toBeCloseTo(center[0])
  expect(position[2]).toBeCloseTo(center[2])
}

async function dragHandle(
  page: Page,
  start: { x: number; y: number },
  delta: { x: number; y: number },
) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 6 })
  await page.mouse.up()
}

async function dragPlacementTranslation(page: Page, form: Locator, canvas: Locator) {
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  const origin = await projectedGizmo(canvas, "data-translation-gizmo-origin")
  await dragHandle(page, { x: origin.x + 82, y: origin.y + 40 }, { x: 30, y: 0 })
  await expect(form.getByRole("combobox", { name: "Translate X", exact: true })).not.toHaveValue(
    "5 mm",
  )
}

async function dragPlacementRotation(page: Page, form: Locator, canvas: Locator) {
  await form.getByRole("button", { name: "Rotate Z", exact: true }).click()
  await expect(canvas).toHaveAttribute("data-angular-gizmo-handle", /.+/)
  // Fit frames the body. Its world-origin rotation pivot can be outside that fitted span.
  const previousHandle = await canvas.getAttribute("data-angular-gizmo-handle")
  const bounds = await canvas.boundingBox()
  if (!bounds || !previousHandle) throw new Error("The angular viewport is unavailable.")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, 1800)
  await expect(canvas).not.toHaveAttribute("data-angular-gizmo-handle", previousHandle)
  const ring = await projectedGizmo(canvas, "data-angular-gizmo-handle")
  const panelBounds = await form.boundingBox()
  if (!panelBounds) throw new Error("The placement panel is unavailable.")
  expect(ring.x).toBeLessThan(panelBounds.x - 20)
  expect(ring.y).toBeGreaterThan(bounds.y + 20)
  expect(ring.y).toBeLessThan(bounds.y + bounds.height - 40)
  await dragHandle(page, ring, { x: -30, y: 30 })
  await expect(form.getByRole("combobox", { name: "Rotate Z", exact: true })).not.toHaveValue(
    "90 deg",
  )
}

async function cancelPlacementDraft(page: Page, before: Backup) {
  await expect(page.getByRole("treeitem", { name: "Placement 1", exact: true })).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toHaveCount(1)
  await page
    .getByRole("form", { name: "Place part", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).not.toHaveAttribute(
    "data-angular-gizmo-feature",
  )
  const cancelled = await saveProject(page)
  // Revision is monotonic, so this also proves the preceding drags never committed.
  expect(cancelled.project.snapshot).toEqual(before.project.snapshot)
}

async function applyPlacementAndUndo(page: Page, before: Backup) {
  const form = await openPlacement(page)
  await form.getByRole("combobox", { name: "Translate X", exact: true }).fill("8 mm")
  await form.getByRole("combobox", { name: "Rotate Z", exact: true }).fill("-45 deg")
  await expect(form.getByRole("button", { name: "Create placement", exact: true })).toBeEnabled()
  await form.getByRole("button", { name: "Create placement", exact: true }).click()
  await saved(page)
  const applied = await saveProject(page)
  expect(applied.project.snapshot.features).toHaveLength(
    before.project.snapshot.features.length + 1,
  )
  const placed = applied.project.snapshot.features.at(-1)
  if (!placed) throw new Error("The placement feature was not committed.")
  expect(readPlacementFeatureParameters(placed)?.translation.x.value).toBe(8)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(undone.project.snapshot.parts).toEqual(before.project.snapshot.parts)
}

test.describe("Part spatial editing", () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test("drags a rotated non-origin part draft, cancels, applies once and undoes once", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(10_000)
    await page.goto("/")
    await sourceBox(page, true)
    const before = await saveProject(page)
    const form = await openPlacement(page)
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const canvas = viewport.locator("canvas")
    await form.getByRole("combobox", { name: "Rotate Z", exact: true }).fill("90 deg")
    await form.getByRole("combobox", { name: "Translate X", exact: true }).fill("5 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await expectRotatedSourceCenter(viewport, before)
    await dragPlacementTranslation(page, form, canvas)
    await dragPlacementRotation(page, form, canvas)
    await cancelPlacementDraft(page, before)
    await applyPlacementAndUndo(page, before)
  })

  test("shows the actual offset plane, drags it and cancels without authoring a split", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(10_000)
    await page.goto("/")
    await sourceBox(page)
    const before = await saveProject(page)
    await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
    await page.getByRole("button", { name: "Split", exact: true }).click()
    const form = page.getByRole("form", { name: "Split part", exact: true })
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const canvas = viewport.locator("canvas")
    const offset = form.getByRole("combobox", { name: "Plane offset", exact: true })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await expect(viewport).toHaveAttribute("data-tool-plane-normal", "0,0,1")
    const start = await offset.inputValue()
    const origin = await projectedGizmo(canvas, "data-translation-gizmo-origin")
    await dragHandle(page, { x: origin.x, y: origin.y - 82 }, { x: 0, y: -20 })
    await expect(offset).not.toHaveValue(start)
    await page.screenshot({ path: testInfo.outputPath("split-draft-plane.png") })
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(viewport).not.toHaveAttribute("data-tool-plane-origin")
    expect((await saveProject(page)).project.snapshot).toEqual(before.project.snapshot)
  })

  test("drags Split across zero and from an initially negative plane without changing the committed body", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(10_000)
    await page.goto("/")
    await centeredSourceBox(page)
    const before = await saveProject(page)
    await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
    await page.getByRole("button", { name: "Split", exact: true }).click()
    const form = page.getByRole("form", { name: "Split part", exact: true })
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const offset = form.getByRole("combobox", { name: "Plane offset", exact: true })
    await offset.fill("2 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
    await dragSplitTowardNegative(page, form, 60)
    await offset.fill("-2 mm")
    await expect(viewport).toHaveAttribute("data-axial-gizmo-distance", "-2")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
    await dragSplitTowardNegative(page, form, 20)
    await page.screenshot({ path: testInfo.outputPath("split-negative-plane.png") })
    await expect(page.getByRole("treeitem", { name: "Split 1", exact: true })).toHaveCount(0)
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(viewport).not.toHaveAttribute("data-tool-plane-origin")
    expect((await saveProject(page)).project.snapshot).toEqual(before.project.snapshot)
  })
})
