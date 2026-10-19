import type { Locator, Page } from "@playwright/test"
import { readExtrusionFeatureParameters } from "../../packages/domain/src/part-design"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle, selectSketchTool } from "./sketch-helpers"

async function standardView(page: Page, name: "Bottom" | "Top" | "Isometric") {
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

async function projectedDepthEndpoint(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-translation-gizmo-origin", /.+/)
  const bounds = await canvas.boundingBox()
  const value = await canvas.getAttribute("data-translation-gizmo-origin")
  const [x, y] = (value ?? "").split(",").map(Number)
  if (!bounds || x === undefined || y === undefined || !Number.isFinite(x + y))
    throw new Error("The depth endpoint must have a finite projected position.")
  return { x: bounds.x + x, y: bounds.y + y }
}

async function dragProjectedDepthArrow(page: Page, form: Locator, canvas: Locator) {
  const distance = form.getByRole("combobox", { name: "Distance", exact: true })
  const first = await projectedDepthEndpoint(canvas)
  await distance.fill("20 mm")
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-axial-gizmo-distance",
    "20",
  )
  await expect.poll(async () => (await projectedDepthEndpoint(canvas)).y).not.toBe(first.y)
  const second = await projectedDepthEndpoint(canvas)
  const length = Math.hypot(second.x - first.x, second.y - first.y)
  expect(length).toBeGreaterThan(1)
  const direction = { x: (second.x - first.x) / length, y: (second.y - first.y) / length }
  await distance.fill("10 mm")
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-axial-gizmo-distance",
    "10",
  )
  await expect.poll(async () => (await projectedDepthEndpoint(canvas)).y).toBeCloseTo(first.y, 1)
  for (const handleOffset of [70, 85, 55, 100]) {
    const endpoint = await projectedDepthEndpoint(canvas)
    const start = {
      x: endpoint.x + direction.x * handleOffset,
      y: endpoint.y + direction.y * handleOffset,
    }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + direction.x * 35, start.y + direction.y * 35, { steps: 8 })
    const dragging = (await canvas.getAttribute("data-translation-gizmo-dragging")) === "true"
    await page.mouse.up()
    if (!dragging) continue
    await expect(distance).not.toHaveValue("10 mm")
    expect(Number.parseFloat(await distance.inputValue())).toBeGreaterThan(10)
    await expect(canvas).not.toHaveAttribute("data-translation-gizmo-dragging")
    return
  }
  throw new Error("The arrow at the projected offset-profile endpoint did not drag.")
}

async function clickVisibleReference(page: Page, field: Locator) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  const center = await page.getByTestId("workspace-center").boundingBox()
  if (!bounds || !center) throw new Error("The reference viewport must be measurable.")
  const left = Math.max(bounds.x, center.x)
  const top = Math.max(bounds.y, center.y)
  const right = Math.min(bounds.x + bounds.width, center.x + center.width)
  const bottom = Math.min(bounds.y + bounds.height, center.y + center.height)
  for (const [x, y] of [
    [0.5, 0.5],
    [0.4, 0.5],
    [0.6, 0.5],
    [0.5, 0.4],
    [0.5, 0.6],
  ]) {
    if (x === undefined || y === undefined) throw new Error("Missing reference sample.")
    await page.mouse.click(left + (right - left) * x, top + (bottom - top) * y)
    if ((await field.getAttribute("aria-pressed")) === "false") return
  }
  throw new Error("The armed reference field did not accept a visible model face.")
}

test("anchors and drags Extrude at an offset profile on a tilted support", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Create", "Datum plane")
  const plane = page.getByRole("form", { name: "Create datum plane", exact: true })
  await plane.getByRole("combobox", { name: "Rotation axis", exact: true }).selectOption("y")
  await plane.getByRole("combobox", { name: "Angle", exact: true }).fill("45 deg")
  await plane.getByRole("combobox", { name: "Offset", exact: true }).fill("14 mm")
  await plane.getByRole("button", { name: "Create datum plane", exact: true }).click()
  await expect(plane).toHaveCount(0)
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-preview-status", "idle")
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The datum-plane canvas must be measurable.")
  await canvas.click({ position: { x: bounds.width * 0.5, y: bounds.height * 0.5 } })
  await expect(page.locator("main > footer")).toContainText(/Selection: Datum plane 1 · Face \d+/)
  await page
    .getByRole("complementary", { name: "Task panel", exact: true })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await expect(page.getByRole("combobox", { name: "Support plane", exact: true })).toHaveValue(
    "feature-face",
  )
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const drawingBounds = await drawing.boundingBox()
  if (!drawingBounds) throw new Error("The tilted sketch must be visible.")
  await page.mouse.click(
    drawingBounds.x + drawingBounds.width * 0.58,
    drawingBounds.y + drawingBounds.height * 0.62,
  )
  await page.mouse.click(
    drawingBounds.x + drawingBounds.width * 0.74,
    drawingBounds.y + drawingBounds.height * 0.42,
  )
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await invokeModelCommand(page, "Create", "Extrude")
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await form.getByRole("combobox", { name: "Start offset", exact: true }).fill("3 mm")
  await standardView(page, "Isometric")
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await projectedDepthEndpoint(canvas)
  await page.screenshot({ path: testInfo.outputPath("tilted-offset-profile-depth-arrow.png") })
  await dragProjectedDepthArrow(page, form, canvas)
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(form.getByRole("combobox", { name: "Start offset", exact: true })).toHaveValue(
    "3 mm",
  )
  const distance = Number.parseFloat(
    await form.getByRole("combobox", { name: "Distance", exact: true }).inputValue(),
  )
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(form).toHaveCount(0)
  await saved(page)
  const backup = await saveProject(page)
  const sketch = backup.project.snapshot.sketches[0]
  expect(sketch?.support?.kind).toBe("feature-face")
  const points = sketch?.entities.filter((entity) => entity.type === "point") ?? []
  expect(points).toHaveLength(4)
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  expect(Math.abs(meanX)).toBeGreaterThan(5)
  const feature = backup.project.snapshot.features.find((item) =>
    readExtrusionFeatureParameters(item),
  )
  if (!feature) throw new Error("The dragged extrusion must be persisted.")
  expect(readExtrusionFeatureParameters(feature)).toMatchObject({
    distance: { value: distance },
    startOffset: { value: 3 },
  })
})

type EndpointKind = "up-to-body" | "up-to-face"
type ScreenPoint = { x: number; y: number }

async function createEndpointFixture(page: Page, kind: EndpointKind) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  for (const name of ["Width", "Depth"])
    await box.getByRole("combobox", { name, exact: true }).fill("200 mm")
  await box.getByRole("combobox", { name: "Height", exact: true }).fill("20 mm")
  await box.getByRole("combobox", { name: "Origin Z", exact: true }).fill("30 mm")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(box).toHaveCount(0)
  await page
    .getByRole("toolbar", { name: "Model commands", exact: true })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await invokeModelCommand(page, "Create", "Extrude")
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await form.getByRole("combobox", { name: "End condition", exact: true }).selectOption(kind)
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await standardView(page, kind === "up-to-body" ? "Bottom" : "Top")
  return { form, viewport: page.getByRole("region", { name: "3D viewport" }) }
}

async function foregroundSavedProfileCenter(page: Page, viewport: Locator): Promise<ScreenPoint> {
  const bounds = await viewport.locator("canvas").boundingBox()
  const profile = await viewport.getAttribute("data-selected-sketch-profile")
  if (!bounds || !profile) throw new Error("The foreground saved profile must be available.")
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(center.x, center.y)
  await expect(viewport).toHaveAttribute("data-preselected-sketch-profile", profile)
  return center
}

async function cancelAndPickEndpointBody(
  page: Page,
  form: Locator,
  viewport: Locator,
  foregroundProfileCenter: ScreenPoint | undefined,
) {
  const field = form.getByRole("button", { name: "Select End support body in 3D", exact: true })
  const body = form.getByRole("combobox", { name: "End support body", exact: true })
  const original = await body.inputValue()
  await field.click()
  await expect(field).toHaveAttribute("aria-pressed", "true")
  await expect(field).toBeFocused()
  await expect(viewport).toHaveAttribute("data-preview-feature-count", "0")
  await expect(viewport.locator("canvas")).not.toHaveAttribute("data-translation-gizmo-origin")
  await page.keyboard.press("Escape")
  await expect(field).toHaveAttribute("aria-pressed", "false")
  await expect(field).toBeFocused()
  await expect(form).toBeVisible()
  await expect(body).toHaveValue(original)
  await field.click()
  await expect(field).toHaveAttribute("aria-pressed", "true")
  if (foregroundProfileCenter) {
    await page.mouse.click(foregroundProfileCenter.x, foregroundProfileCenter.y)
    await expect(field).toHaveAttribute("aria-pressed", "false")
  } else await clickVisibleReference(page, field)
  await expect(field).toContainText("Box 1 · result")
}

async function pickExactEndpointFace(page: Page, form: Locator): Promise<unknown> {
  const face = form.getByRole("combobox", { name: "End face", exact: true })
  const expectedFace = await face
    .getByRole("option", { name: "Box 1 · result · primitive.box.cap.end", exact: true })
    .getAttribute("value")
  if (!expectedFace) throw new Error("The exact planar face must be available.")
  const faceReference: unknown = JSON.parse(expectedFace)
  const field = form.getByRole("button", { name: "Select End face in 3D", exact: true })
  await field.click()
  await expect(field).toHaveAttribute("aria-pressed", "true")
  await clickVisibleReference(page, field)
  await expect(face).toHaveValue(expectedFace)
  return faceReference
}

async function commitAndCheckEndpoint(
  page: Page,
  form: Locator,
  viewport: Locator,
  kind: EndpointKind,
  faceReference: unknown,
) {
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(form).toHaveCount(0)
  await saved(page)
  const backup = await saveProject(page)
  const source = backup.project.snapshot.features.find(({ label }) => label === "Box 1")
  const feature = backup.project.snapshot.features.find((item) =>
    readExtrusionFeatureParameters(item),
  )
  if (!source || !feature) throw new Error("Both the source body and extrusion must persist.")
  const end = readExtrusionFeatureParameters(feature)?.endCondition
  expect(end).toMatchObject({
    kind,
    sourceContentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    targetBody: { featureId: source.id, outputRole: "result" },
  })
  if (kind === "up-to-face") expect(end).toHaveProperty("face", faceReference)
  expect(end).not.toHaveProperty("meshFaceId")
  if (end?.kind === "up-to-face") expect(end.face).not.toHaveProperty("meshFaceId")
}

for (const kind of ["up-to-body", "up-to-face"] as const) {
  test(`picks the ${kind} extrusion endpoint in 3D and persists its exact reference`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { form, viewport } = await createEndpointFixture(page, kind)
    const foregroundProfileCenter =
      kind === "up-to-body" ? await foregroundSavedProfileCenter(page, viewport) : undefined
    await cancelAndPickEndpointBody(page, form, viewport, foregroundProfileCenter)
    const faceReference =
      kind === "up-to-face" ? await pickExactEndpointFace(page, form) : undefined
    await commitAndCheckEndpoint(page, form, viewport, kind, faceReference)
  })
}
