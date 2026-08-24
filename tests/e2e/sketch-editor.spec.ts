import { expect, test } from "./fixtures"
import {
  addDimension,
  confirmSketchPlane,
  drawRectangle,
  selectOriginPlaneInViewport,
  selectSketchEntities,
  selectSketchTool,
} from "./sketch-helpers"

test.describe("full sketch editor", () => {
  test("keeps one 3D canvas while switching between normal sketch edit and orbit context", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    const canvas = viewport.locator("canvas")
    await canvas.evaluate((element) => {
      element.dataset.testViewportIdentity = "persistent"
    })

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)

    const passiveViewport = page.locator("section[data-passive='true']")
    await expect(passiveViewport).toHaveAttribute("aria-hidden", "true")
    await expect(passiveViewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(passiveViewport.locator("canvas")).toHaveAttribute(
      "data-test-viewport-identity",
      "persistent",
    )

    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await page.mouse.click(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.55)
    await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.45)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)

    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
    const orbitViewport = page.locator("section[data-sketch-context-mode='orbit']")
    await expect(orbitViewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(orbitViewport).toHaveAttribute("data-rendered-sketch-count", "1")
    await expect(orbitViewport.locator("canvas")).toHaveAttribute(
      "data-test-viewport-identity",
      "persistent",
    )
    const hiddenDrawing = page.locator("section[data-interactive='false']")
    await expect(hiddenDrawing).toHaveAttribute("aria-hidden", "true")
    await expect(hiddenDrawing).toHaveAttribute("inert", "")
    await expect(hiddenDrawing).toHaveClass(/opacity-0/)
    const orbitBounds = await orbitViewport.locator("canvas").boundingBox()
    if (!orbitBounds) throw new Error("The orbit context canvas is not visible.")
    await page.mouse.move(
      orbitBounds.x + orbitBounds.width / 2,
      orbitBounds.y + orbitBounds.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      orbitBounds.x + orbitBounds.width / 2 + 80,
      orbitBounds.y + orbitBounds.height / 2 - 40,
      { steps: 8 },
    )
    await page.mouse.up()

    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await expect(passiveViewport).toHaveAttribute("data-sketch-context-mode", "normal")
    await expect(drawing).toBeVisible()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)

    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    const restoredViewport = page.getByRole("region", { name: "3D viewport" })
    await expect(restoredViewport.locator("canvas")).toHaveAttribute(
      "data-test-viewport-identity",
      "persistent",
    )
    await expect(restoredViewport).toHaveAttribute("data-rendered-sketch-count", "1")
  })

  test("selects an earlier sketch line graphically in 3D across support frames", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const taskPanel = page.getByRole("complementary", { name: "Task panel" })
    await taskPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xy")

    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const drawingBounds = await drawing.boundingBox()
    if (!drawingBounds) throw new Error("The source sketch canvas is not visible.")
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await page.mouse.click(
      drawingBounds.x + drawingBounds.width * 0.48,
      drawingBounds.y + drawingBounds.height * 0.46,
    )
    await page.mouse.click(
      drawingBounds.x + drawingBounds.width * 0.64,
      drawingBounds.y + drawingBounds.height * 0.46,
    )
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xz")
    await page.getByRole("button", { name: "Use external geometry", exact: true }).click()
    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-sketch-reference-candidate-count", "3")
    const canvasBounds = await viewport.locator("canvas").boundingBox()
    if (!canvasBounds) throw new Error("The 3D reference-selection canvas is not visible.")
    const referenceStatus = page.getByRole("status").filter({ hasText: "· Line" })
    let selected = false
    const centerX = canvasBounds.x + canvasBounds.width / 2
    const centerY = canvasBounds.y + canvasBounds.height / 2
    for (let offsetY = -48; offsetY <= 48 && !selected; offsetY += 8) {
      for (let offsetX = -320; offsetX <= 320; offsetX += 8) {
        const x = centerX + offsetX
        const y = centerY + offsetY
        await page.mouse.move(x, y)
        await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
        if (await referenceStatus.isVisible()) {
          await page.mouse.click(x, y)
          selected = true
          break
        }
      }
    }
    expect(selected).toBe(true)

    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await expect(drawing.locator("[data-sketch-external-line-count='1']")).toHaveCount(1)
  })

  test("keeps sketch completion actions anchored to the task panel bottom", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)

    const taskPanel = page.getByRole("complementary", { name: "Sketch task panel" })
    const cancel = taskPanel.getByRole("button", { name: "Cancel", exact: true })
    const finish = taskPanel.getByRole("button", { name: "Finish sketch", exact: true })
    const [panelBounds, cancelBounds, finishBounds] = await Promise.all([
      taskPanel.boundingBox(),
      cancel.boundingBox(),
      finish.boundingBox(),
    ])
    if (!panelBounds || !cancelBounds || !finishBounds) {
      throw new Error("Sketch task-panel actions are not visible.")
    }

    expect(cancelBounds.y + cancelBounds.height).toBeLessThanOrEqual(finishBounds.y)
    expect(cancelBounds.x).toBeGreaterThanOrEqual(panelBounds.x)
    expect(finishBounds.x + finishBounds.width).toBeLessThanOrEqual(
      panelBounds.x + panelBounds.width,
    )
    expect(
      panelBounds.y + panelBounds.height - (finishBounds.y + finishBounds.height),
    ).toBeLessThanOrEqual(20)
  })

  test("adds and edits a driving dimension from a selected line", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = await drawRectangle(page)

    await selectSketchEntities(page, drawing, "line", [0])
    const precisionTools = page.getByRole("toolbar", { name: "Sketch precision tools" })
    await expect(precisionTools).toBeVisible()
    await precisionTools.getByRole("button", { name: "Add drawing dimension" }).click()
    await expect(page.getByRole("combobox", { name: "Driving expression" })).toBeFocused()
    await addDimension(page, "Distance", "30 mm")
    const distanceConstraint = page.getByRole("listitem").filter({ hasText: "Distance · 30 mm" })
    await expect(distanceConstraint).toBeVisible()

    await page
      .getByRole("region", { name: "2D sketch workspace" })
      .getByRole("button", { name: "Edit dimension 30 mm" })
      .click()
    await distanceConstraint.getByRole("combobox", { name: "Driving expression" }).fill("35 mm")
    await distanceConstraint.getByRole("button", { name: "Save dimension" }).click()

    await expect(page.getByText("Distance · 35 mm", { exact: true })).toBeVisible()
  })

  test("keeps a dragged endpoint responsive while sketch solves are coalesced", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = await drawRectangle(page)
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    await selectSketchTool(page, "Rectangle tools", "Rectangle G")
    for (let index = 0; index < 24; index += 1) {
      const column = index % 6
      const row = Math.floor(index / 6)
      const left = 0.1 + column * 0.13
      const top = 0.12 + row * 0.17
      await page.mouse.click(bounds.x + bounds.width * left, bounds.y + bounds.height * top)
      await page.mouse.click(
        bounds.x + bounds.width * (left + 0.08),
        bounds.y + bounds.height * (top + 0.1),
      )
    }
    await expect
      .poll(() => drawing.locator('[data-sketch-entity-type="line"]').count())
      .toBeGreaterThanOrEqual(96)
    await page.getByRole("button", { name: "Select", exact: true }).click()
    const points = drawing.locator('[data-sketch-entity-type="point"]')
    const endpoint = points.last()
    const dependentPoint = points.nth((await points.count()) - 2)
    const endpointBounds = await endpoint.boundingBox()
    if (!endpointBounds) throw new Error("The sketch endpoint is not visible.")
    const initialX = await endpoint.getAttribute("cx")
    const initialY = await endpoint.getAttribute("cy")
    const dependentInitialX = await dependentPoint.getAttribute("cx")
    const dependentInitialY = await dependentPoint.getAttribute("cy")
    const startX = endpointBounds.x + endpointBounds.width / 2
    const startY = endpointBounds.y + endpointBounds.height / 2
    const retainedBounds = await drawing.boundingBox()
    if (!retainedBounds) throw new Error("The heavy sketch canvas is not visible.")
    expect(retainedBounds.height).toBeCloseTo(bounds.height, 0)
    expect(startY).toBeGreaterThanOrEqual(retainedBounds.y)
    expect(startY).toBeLessThanOrEqual(retainedBounds.y + retainedBounds.height)

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await expect(drawing).toHaveAttribute("data-sketch-dragging-point-id", /.+/)
    await page.mouse.move(startX + 90, startY - 60, { steps: 12 })
    await expect
      .poll(async () => [await endpoint.getAttribute("cx"), await endpoint.getAttribute("cy")], {
        timeout: 1_000,
      })
      .not.toEqual([initialX, initialY])
    await expect
      .poll(
        async () => [
          await dependentPoint.getAttribute("cx"),
          await dependentPoint.getAttribute("cy"),
        ],
        { timeout: 1_000 },
      )
      .not.toEqual([dependentInitialX, dependentInitialY])
    await page.mouse.up()

    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("authors every alpha analytical primitive on the canvas", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await selectOriginPlaneInViewport(page, "yz")
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const clickAt = (horizontal: number, vertical: number) =>
      page.mouse.click(bounds.x + bounds.width * horizontal, bounds.y + bounds.height * vertical)

    await page.getByRole("button", { name: "Point", exact: true }).click()
    await clickAt(0.2, 0.25)
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await clickAt(0.25, 0.7)
    await clickAt(0.45, 0.6)
    const construction = page.getByRole("button", { name: "Construction geometry" })
    await construction.click()
    await expect(construction).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Center-point circle", exact: true }).click()
    await clickAt(0.65, 0.3)
    await clickAt(0.75, 0.3)
    await construction.click()
    await expect(construction).toHaveAttribute("aria-pressed", "false")
    await selectSketchTool(page, "Arc tools", "Center-point arc")
    await clickAt(0.7, 0.7)
    await clickAt(0.8, 0.7)
    await clickAt(0.7, 0.6)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(7)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(1)
    await expect(
      drawing.locator('[data-sketch-entity-type="circle"][stroke-dasharray="6 4"]'),
    ).toHaveCount(1)
  })

  test("authors a symmetric center rectangle with preview and local history", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Rectangle tools", "Center rectangle R")
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.35)
    await expect(drawing.locator('[data-sketch-preview-tool="center-rectangle"]')).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.35)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(5)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(8)
    await expect(
      drawing.locator('[data-sketch-entity-type="line"][stroke-dasharray="6 4"]'),
    ).toHaveCount(4)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(8)
  })

  test("authors a three-point arc with exact preview and local history", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Arc tools", "Three-point arc A")
    await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.55)
    await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.55)
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.3)
    await expect(
      drawing.locator('[data-sketch-preview-tool="three-point-arc-point"]'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.3)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(3)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(0)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(1)
  })

  test("authors an elliptical arc with construction-ellipse preview and local history", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Arc tools", "Elliptical arc")
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.55)
    await page.mouse.click(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.55)
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.35)
    await expect(
      drawing.locator('[data-sketch-preview-tool="elliptical-arc-start"] ellipse'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.35)
    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.55)
    const preview = drawing.locator('[data-sketch-preview-tool="elliptical-arc-end"]')
    await expect(preview.locator("ellipse")).toBeVisible()
    await expect(preview.locator("polyline")).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.55)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(5)
    await expect(drawing.locator('[data-sketch-entity-type="elliptical-arc"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="elliptical-arc"]')).toHaveCount(0)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="elliptical-arc"]')).toHaveCount(1)
  })

  test("drives both stable axes of a selected ellipse by diameter", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Circle tools", "Center-point ellipse")
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.55)
    await page.mouse.click(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.55)
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.35)
    await expect(drawing.locator('[data-sketch-entity-type="ellipse"]')).toHaveCount(1)

    await selectSketchEntities(page, drawing, "ellipse", [0])
    const precisionTools = page.getByRole("toolbar", { name: "Sketch precision tools" })
    await precisionTools.getByRole("button", { name: "Add drawing dimension" }).click()
    await addDimension(page, "Primary axis diameter", "40 mm")
    await expect(
      page.getByRole("listitem").filter({ hasText: "Primary axis diameter · 40 mm" }),
    ).toBeVisible()

    await precisionTools.getByRole("button", { name: "Add drawing dimension" }).click()
    await addDimension(page, "Secondary axis diameter", "18 mm")
    await expect(
      page.getByRole("listitem").filter({ hasText: "Secondary axis diameter · 18 mm" }),
    ).toBeVisible()
    await expect(
      page.locator('[data-sketch-constraint-kind="dimension"]').filter({ hasText: "40 mm" }),
    ).toBeVisible()
    await expect(
      page.locator('[data-sketch-constraint-kind="dimension"]').filter({ hasText: "18 mm" }),
    ).toBeVisible()
  })

  test("authors midpoint-line and three-point-circle family variants", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Line tools", "Midpoint line")
    await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.65)
    await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.55)
    await expect(drawing.locator('[data-sketch-preview-tool="midpoint-line"]')).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.55)

    await selectSketchTool(page, "Circle tools", "Three-point circle")
    await page.mouse.click(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.62)
    await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.62)
    await page.mouse.move(bounds.x + bounds.width * 0.69, bounds.y + bounds.height * 0.38)
    await expect(
      drawing.locator('[data-sketch-preview-tool="three-point-circle-third"]'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.69, bounds.y + bounds.height * 0.38)

    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("authors both regular polygon variants with an explicit side count", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const clickAt = (horizontal: number, vertical: number) =>
      page.mouse.click(bounds.x + bounds.width * horizontal, bounds.y + bounds.height * vertical)

    await selectSketchTool(page, "Polygon tools", "Circumscribed polygon")
    await clickAt(0.35, 0.5)
    await page.mouse.move(bounds.x + bounds.width * 0.52, bounds.y + bounds.height * 0.5)
    await expect(
      drawing.locator('[data-sketch-preview-tool="regular-polygon-radius"]'),
    ).toBeVisible()
    await clickAt(0.52, 0.5)
    await expect(drawing.locator('[data-sketch-polygon-preview="circumscribed"]')).toBeVisible()
    await page.keyboard.press("8")
    await expect(drawing.locator('[data-sketch-polygon-side-count="8"]')).toHaveText("8")
    await page.keyboard.press("Enter")

    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(8)
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
    await selectSketchTool(page, "Polygon tools", "Inscribed polygon")
    await clickAt(0.65, 0.5)
    await page.mouse.move(bounds.x + bounds.width * 0.78, bounds.y + bounds.height * 0.5)
    await clickAt(0.78, 0.5)
    await expect(drawing.locator('[data-sketch-polygon-preview="inscribed"]')).toBeVisible()
    await page.keyboard.press("4")
    await page.keyboard.press("Enter")

    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await expect(drawing.locator("[data-sketch-profile-index]")).toHaveCount(1)
  })

  test("authors aligned rectangle and tangent arc design intent", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Rectangle tools", "Aligned rectangle")
    await page.mouse.click(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.62)
    await page.mouse.move(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.5)
    await expect(
      drawing.locator('[data-sketch-preview-tool="aligned-rectangle-end"]'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.5)
    await page.mouse.move(bounds.x + bounds.width * 0.64, bounds.y + bounds.height * 0.3)
    await expect(
      drawing.locator('[data-sketch-preview-tool="aligned-rectangle-width"] polygon'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.64, bounds.y + bounds.height * 0.3)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(4)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await expect(page.getByText("Perpendicular", { exact: true })).toBeVisible()
    await expect(page.getByText("Parallel", { exact: true })).toHaveCount(2)

    await selectSketchTool(page, "Arc tools", /^Tangent arc (?:Shift\+A|⇧A)$/)
    const tangentStart = drawing.locator('[data-sketch-entity-type="point"]').last()
    await tangentStart.dispatchEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
    await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.5)
    await expect(drawing.locator('[data-sketch-preview-tool="tangent-arc"]')).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.5)

    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(1)
    await expect(page.getByText("Tangent", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Line", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(0)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  })

  test("authors a centered aligned rectangle from its center axis", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Rectangle tools", "Centered aligned rectangle")
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.55)
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.48)
    await expect(
      drawing.locator('[data-sketch-preview-tool="centered-aligned-rectangle-side"]'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.48)
    await page.mouse.move(bounds.x + bounds.width * 0.64, bounds.y + bounds.height * 0.3)
    await expect(
      drawing.locator('[data-sketch-preview-tool="centered-aligned-rectangle-width"] polygon'),
    ).toBeVisible()
    await page.mouse.click(bounds.x + bounds.width * 0.64, bounds.y + bounds.height * 0.3)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(7)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(5)
    await expect(page.getByText("Perpendicular", { exact: true })).toBeVisible()
    await expect(page.getByText("Parallel", { exact: true })).toHaveCount(2)
    await expect(page.getByText("Midpoint", { exact: true })).toHaveCount(3)

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
  })

  test("authors exact straight and centered slots with analytical end caps", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await selectSketchTool(page, "Slot tools", "Centered slot")
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
    await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5)
    await expect(
      drawing.locator('[data-sketch-preview-tool="centered-slot-end"] line'),
    ).toHaveAttribute("x2", "30")
    await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5)
    await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.38)
    await expect(
      drawing.locator('[data-sketch-preview-tool="centered-slot-width"] polyline'),
    ).toHaveCount(2)
    await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.38)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(7)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(3)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(2)
    await expect(drawing.locator("[data-sketch-profile-index]")).toHaveCount(1)
    await expect(
      drawing.locator('[data-sketch-entity-type="line"][stroke-dasharray="6 4"]'),
    ).toHaveCount(1)
    await expect(page.getByText("Midpoint", { exact: true })).toBeVisible()
    await expect(page.getByText("Parallel", { exact: true })).toBeVisible()
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)

    await selectSketchTool(page, "Slot tools", "Straight slot")
    await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.65)
    await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.65)
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5)
    await expect(drawing.locator('[data-sketch-preview-tool="slot-width"] polyline')).toHaveCount(2)
    await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(6)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(3)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(2)
    await expect(drawing.locator("[data-sketch-profile-index]")).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await page.mouse.click(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.5)
    await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5)
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Select", exact: true }).click()
    await selectSketchEntities(page, drawing, "line", [0])
    await selectSketchTool(page, "Slot tools", "Slot from selected line")
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.35)
    await expect(
      drawing.locator('[data-sketch-preview-tool="slot-from-selection-width"] polyline'),
    ).toHaveCount(2)
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.35)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(6)
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(3)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(2)
    await expect(drawing.locator("[data-sketch-profile-index]")).toHaveCount(1)
    await expect(
      drawing.locator('[data-sketch-entity-type="line"][stroke-dasharray="6 4"]'),
    ).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("mirrors selected or subsequently picked geometry across a sketch line", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const clickAt = (horizontal: number, vertical: number) =>
      page.mouse.click(bounds.x + bounds.width * horizontal, bounds.y + bounds.height * vertical)
    const construction = page.getByRole("button", { name: "Construction geometry" })

    await construction.click()
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await clickAt(0.5, 0.3)
    await clickAt(0.5, 0.7)
    await page.keyboard.press("Escape")
    await construction.click()
    await page.getByRole("button", { name: "Line", exact: true }).click()
    await clickAt(0.65, 0.42)
    await clickAt(0.78, 0.58)
    await page.keyboard.press("Escape")
    const lines = drawing.locator('[data-sketch-entity-type="line"]')
    await expect(lines).toHaveCount(2)

    await selectSketchEntities(page, drawing, "line", [1])
    await page.getByRole("button", { name: "Mirror", exact: true }).click()
    await expect(page.getByText("Select a mirror line for the selected geometry.")).toBeVisible()
    await lines.first().click()
    await expect(lines).toHaveCount(3)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(lines).toHaveCount(2)
    await page.getByRole("button", { name: "Mirror", exact: true }).click()
    await lines.first().click()
    await expect(
      page.getByText("Select geometry to mirror. Press Escape when finished."),
    ).toBeVisible()
    await lines.nth(1).click()
    await expect(lines).toHaveCount(3)
    await expect(page.getByRole("button", { name: "Mirror", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await drawing.press("Escape")
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  test("transforms selected sketch geometry with one preview and undo entry", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = await drawRectangle(page)
    const lines = drawing.locator('[data-sketch-entity-type="line"]')
    const initialFirstLine = await lines.first().evaluate((line) => ({
      x1: line.getAttribute("x1"),
      x2: line.getAttribute("x2"),
      y1: line.getAttribute("y1"),
      y2: line.getAttribute("y2"),
    }))

    await selectSketchEntities(page, drawing, "line", [0, 1, 2, 3])
    await page.getByRole("button", { name: "Transform", exact: true }).click()
    await expect(drawing.locator("[data-sketch-transform-manipulator]")).toBeVisible()
    await expect(page.getByText(/Arrow keys move/)).toBeVisible()

    await drawing.press("ArrowRight")
    await expect(drawing.locator("[data-sketch-transform-preview]")).toBeVisible()
    await expect(drawing.locator("[data-sketch-transform-preview] > g")).toHaveAttribute(
      "transform",
      /translate\(1 0\)/,
    )
    const exactTransform = page.getByRole("form", { name: "Precise transform" })
    await exactTransform.getByRole("combobox", { name: "Translation X" }).fill("5 mm")
    await exactTransform.getByRole("combobox", { name: "Rotation" }).fill("15 deg")
    await exactTransform.getByRole("combobox", { name: "Scale" }).fill("1.1")
    await exactTransform.getByRole("button", { name: "Apply transform" }).click()

    await expect(drawing.locator("[data-sketch-transform-manipulator]")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect
      .poll(() =>
        lines.first().evaluate((line) => ({
          x1: line.getAttribute("x1"),
          x2: line.getAttribute("x2"),
          y1: line.getAttribute("y1"),
          y2: line.getAttribute("y2"),
        })),
      )
      .not.toEqual(initialFirstLine)

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect
      .poll(() =>
        lines.first().evaluate((line) => ({
          x1: line.getAttribute("x1"),
          x2: line.getAttribute("x2"),
          y1: line.getAttribute("y1"),
          y2: line.getAttribute("y2"),
        })),
      )
      .toEqual(initialFirstLine)
  })

  test("creates a two-direction linear sketch pattern with one undo entry", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = await drawRectangle(page)
    const lines = drawing.locator('[data-sketch-entity-type="line"]')

    await selectSketchEntities(page, drawing, "line", [0])
    await page.getByRole("button", { name: "Linear pattern", exact: true }).click()
    const pattern = page.getByRole("form", { name: "Linear pattern" })
    await expect(pattern).toBeVisible()
    await expect(drawing.locator("[data-sketch-linear-pattern-preview] > g")).toHaveCount(2)

    await pattern.getByRole("combobox", { name: "First spacing" }).fill("15 mm")
    await pattern.getByRole("checkbox", { name: "Add second direction" }).check()
    await pattern.getByRole("combobox", { name: "Second spacing" }).fill("10 mm")
    await expect(drawing.locator("[data-sketch-linear-pattern-preview] > g")).toHaveCount(5)
    await pattern.getByRole("button", { name: "Apply linear pattern" }).click()

    await expect(lines).toHaveCount(9)
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(lines).toHaveCount(4)
  })

  test("creates a center-based circular sketch pattern with one undo entry", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = await drawRectangle(page)
    const lines = drawing.locator('[data-sketch-entity-type="line"]')

    await selectSketchEntities(page, drawing, "line", [0])
    await page.getByRole("button", { name: "Circular pattern", exact: true }).click()
    const pattern = page.getByRole("form", { name: "Circular pattern" })
    await expect(pattern).toBeVisible()
    await expect(drawing.locator("[data-sketch-circular-pattern-preview] > g")).toHaveCount(3)

    await pattern.getByRole("combobox", { name: "Center X" }).fill("10 mm")
    await pattern.getByRole("combobox", { name: "Instance count" }).fill("4")
    await expect(drawing.locator("[data-sketch-circular-pattern-preview] > g")).toHaveCount(4)
    await pattern.getByRole("button", { name: "Apply circular pattern" }).click()

    await expect(lines).toHaveCount(7)
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(lines).toHaveCount(4)
  })

  test("offsets a connected line loop with one editable signed dimension", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = await drawRectangle(page)
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const lines = drawing.locator('[data-sketch-entity-type="line"]')

    await selectSketchEntities(page, drawing, "line", [0, 1, 2, 3])
    await page.getByRole("button", { name: "Offset", exact: true }).click()
    await expect(
      page.getByText("Move the pointer to set the signed offset, then click."),
    ).toBeVisible()
    await page.mouse.move(bounds.x + bounds.width * 0.82, bounds.y + bounds.height * 0.52)
    const preview = drawing.locator('[data-sketch-preview-tool="offset-distance"]')
    await expect(preview).toBeVisible()
    await expect(preview.locator("line")).toHaveCount(4)
    const previewDistance = Number(await preview.getAttribute("data-sketch-offset-distance"))
    expect(Math.abs(previewDistance)).toBeGreaterThan(0.01)
    await page.mouse.click(bounds.x + bounds.width * 0.82, bounds.y + bounds.height * 0.52)

    await expect(lines).toHaveCount(8)
    const offsetConstraint = page.getByRole("listitem").filter({ hasText: /Offset ·/ })
    await expect(offsetConstraint).toBeVisible()
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(lines).toHaveCount(4)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(lines).toHaveCount(8)

    const signedDistance = async () => {
      const values = await lines.evaluateAll((elements) =>
        [elements[0], elements[4]].map((element) => ({
          x1: Number(element.getAttribute("x1")),
          y1: Number(element.getAttribute("y1")),
          x2: Number(element.getAttribute("x2")),
          y2: Number(element.getAttribute("y2")),
        })),
      )
      const [source, offset] = values
      if (!source || !offset) throw new Error("The offset line pair is not rendered.")
      const directionX = source.x2 - source.x1
      const directionY = source.y2 - source.y1
      const length = Math.hypot(directionX, directionY)
      return (
        (directionX * ((offset.y1 + offset.y2) / 2 - source.y1) -
          directionY * ((offset.x1 + offset.x2) / 2 - source.x1)) /
        length
      )
    }
    const initialDistance = await signedDistance()
    expect(Math.sign(initialDistance)).toBe(Math.sign(previewDistance))
    const oppositeExpression = initialDistance > 0 ? "-8 mm" : "8 mm"
    await offsetConstraint.getByRole("button", { name: "Edit dimension" }).click()
    await offsetConstraint
      .getByRole("combobox", { name: "Driving expression" })
      .fill(oppositeExpression)
    await offsetConstraint.getByRole("button", { name: "Save dimension" }).click()

    await expect(offsetConstraint).toContainText(`Offset · ${oppositeExpression}`)
    await expect
      .poll(async () => {
        const distance = await signedDistance()
        return Math.sign(distance) === -Math.sign(initialDistance) && Math.abs(distance) > 7.99
      })
      .toBe(true)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("trims, splits, and extends lines as atomic sketch edits", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const canvasPoint = (horizontal: number, vertical: number) => ({
      x: bounds.x + bounds.width * horizontal,
      y: bounds.y + bounds.height * vertical,
    })
    const drawLine = async (
      start: Readonly<{ x: number; y: number }>,
      end: Readonly<{ x: number; y: number }>,
    ) => {
      await page.getByRole("button", { name: "Line", exact: true }).click()
      await page.mouse.click(start.x, start.y)
      await page.mouse.click(end.x, end.y)
      await page.keyboard.press("Escape")
    }
    const activateLine = async (
      tool: "Trim" | "Extend" | "Split",
      point: Readonly<{ x: number; y: number }>,
    ) => {
      await page.getByRole("button", { name: tool, exact: true }).click()
      await page.mouse.click(point.x, point.y)
    }

    await drawLine(canvasPoint(0.25, 0.5), canvasPoint(0.75, 0.5))
    await drawLine(canvasPoint(0.4, 0.35), canvasPoint(0.4, 0.65))
    await drawLine(canvasPoint(0.6, 0.35), canvasPoint(0.6, 0.65))
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(3)

    const trimPoint = canvasPoint(0.5, 0.5)
    await activateLine("Trim", { ...trimPoint, y: trimPoint.y + 6 })
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(3)

    await activateLine("Split", canvasPoint(0.5, 0.5))
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(3)

    await drawLine(canvasPoint(0.25, 0.75), canvasPoint(0.4, 0.75))
    await drawLine(canvasPoint(0.6, 0.65), canvasPoint(0.6, 0.85))
    const extendTarget = drawing.locator('[data-sketch-entity-type="line"]').nth(3)
    const originalEnd = await extendTarget.getAttribute("x2")
    await activateLine("Extend", canvasPoint(0.33, 0.75))
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(5)
    await expect(extendTarget).not.toHaveAttribute("x2", originalEnd ?? "")
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("trims and splits circles and extends arcs with exact solver feedback", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const canvasPoint = (horizontal: number, vertical: number) => ({
      x: bounds.x + bounds.width * horizontal,
      y: bounds.y + bounds.height * vertical,
    })
    const clickPoint = (point: Readonly<{ x: number; y: number }>) =>
      page.mouse.click(point.x, point.y)
    const drawLine = async (
      start: Readonly<{ x: number; y: number }>,
      end: Readonly<{ x: number; y: number }>,
    ) => {
      await page.getByRole("button", { name: "Line", exact: true }).click()
      await page.mouse.click(start.x, start.y)
      await page.mouse.click(end.x, end.y)
      await page.keyboard.press("Escape")
    }
    const activateCurveAt = (point: Readonly<{ x: number; y: number }>) =>
      page.mouse.click(point.x, point.y)

    await page.getByRole("button", { name: "Center-point circle", exact: true }).click()
    await clickPoint(canvasPoint(0.65, 0.4))
    await clickPoint(canvasPoint(0.77, 0.4))
    await drawLine(canvasPoint(0.6, 0.2), canvasPoint(0.6, 0.4))
    await drawLine(canvasPoint(0.7, 0.2), canvasPoint(0.7, 0.4))
    const circle = drawing.locator('[data-sketch-entity-type="circle"]')
    await expect(circle).toHaveCount(1)

    await page.getByRole("button", { name: "Trim", exact: true }).click()
    await activateCurveAt(canvasPoint(0.65, 0.24))
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(0)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(1)

    await page.getByRole("button", { name: "Split", exact: true }).click()
    await activateCurveAt(canvasPoint(0.77, 0.4))
    await expect(drawing.locator('[data-sketch-preview-tool="split-circle-second"]')).toBeVisible()
    await activateCurveAt(canvasPoint(0.65, 0.24))
    await expect(drawing.locator('[data-sketch-entity-type="circle"]')).toHaveCount(0)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(2)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()

    await selectSketchTool(page, "Arc tools", "Center-point arc")
    await clickPoint(canvasPoint(0.3, 0.72))
    await clickPoint(canvasPoint(0.4, 0.72))
    await clickPoint(canvasPoint(0.3, 0.59))
    await drawLine(canvasPoint(0.2, 0.66), canvasPoint(0.2, 0.78))
    const arc = drawing.locator('[data-sketch-entity-type="arc"]')
    await expect(arc).toHaveCount(1)
    const originalArcPoints = await arc.getAttribute("points")

    await page.getByRole("button", { name: "Extend", exact: true }).click()
    await activateCurveAt(canvasPoint(0.3, 0.59))
    await expect(arc).not.toHaveAttribute("points", originalArcPoints ?? "")
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("trims and splits ellipses and extends elliptical arcs analytically", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")
    const canvasPoint = (horizontal: number, vertical: number) => ({
      x: bounds.x + bounds.width * horizontal,
      y: bounds.y + bounds.height * vertical,
    })
    const clickPoint = (point: Readonly<{ x: number; y: number }>) =>
      page.mouse.click(point.x, point.y)
    const drawLine = async (
      start: Readonly<{ x: number; y: number }>,
      end: Readonly<{ x: number; y: number }>,
    ) => {
      await page.getByRole("button", { name: "Line", exact: true }).click()
      await clickPoint(start)
      await clickPoint(end)
      await page.keyboard.press("Escape")
    }
    const activateCurveAt = (point: Readonly<{ x: number; y: number }>) =>
      page.mouse.click(point.x, point.y)

    await selectSketchTool(page, "Circle tools", "Center-point ellipse")
    await clickPoint(canvasPoint(0.65, 0.4))
    await clickPoint(canvasPoint(0.77, 0.4))
    await clickPoint(canvasPoint(0.65, 0.24))
    await drawLine(canvasPoint(0.6, 0.18), canvasPoint(0.6, 0.4))
    await drawLine(canvasPoint(0.7, 0.18), canvasPoint(0.7, 0.4))
    const ellipse = drawing.locator('[data-sketch-entity-type="ellipse"]')
    await expect(ellipse).toHaveCount(1)

    await page.getByRole("button", { name: "Trim", exact: true }).click()
    await activateCurveAt(canvasPoint(0.65, 0.24))
    await expect(drawing.locator('[data-sketch-entity-type="ellipse"]')).toHaveCount(0)
    await expect(drawing.locator('[data-sketch-entity-type="elliptical-arc"]')).toHaveCount(1)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="ellipse"]')).toHaveCount(1)

    await page.getByRole("button", { name: "Split", exact: true }).click()
    await activateCurveAt(canvasPoint(0.77, 0.4))
    await expect(drawing.locator('[data-sketch-preview-tool="split-ellipse-second"]')).toBeVisible()
    await activateCurveAt(canvasPoint(0.65, 0.24))
    await expect(drawing.locator('[data-sketch-entity-type="ellipse"]')).toHaveCount(0)
    await expect(drawing.locator('[data-sketch-entity-type="elliptical-arc"]')).toHaveCount(2)
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()

    await selectSketchTool(page, "Arc tools", "Elliptical arc")
    await clickPoint(canvasPoint(0.3, 0.72))
    await clickPoint(canvasPoint(0.4, 0.72))
    await clickPoint(canvasPoint(0.3, 0.59))
    await clickPoint(canvasPoint(0.2, 0.72))
    await drawLine(canvasPoint(0.25, 0.74), canvasPoint(0.25, 0.88))
    const ellipticalArc = drawing.locator('[data-sketch-entity-type="elliptical-arc"]')
    await expect(ellipticalArc).toHaveCount(1)
    const originalArcPoints = await ellipticalArc.getAttribute("points")

    await page.getByRole("button", { name: "Extend", exact: true }).click()
    await activateCurveAt(canvasPoint(0.2, 0.72))
    await expect(ellipticalArc).not.toHaveAttribute("points", originalArcPoints ?? "")
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("persists automatic perpendicular and midpoint inference with Shift suppression", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    const bounds = await drawing.boundingBox()
    if (!bounds) throw new Error("The editable sketch canvas is not visible.")

    await page.getByRole("button", { name: "Line", exact: true }).click()
    const firstStart = {
      x: bounds.x + bounds.width * 0.3,
      y: bounds.y + bounds.height * 0.65,
    }
    const sharedEndpoint = {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.y + bounds.height * 0.5,
    }
    const perpendicularEnd = {
      x: bounds.x + bounds.width * 0.3875,
      y: bounds.y + bounds.height * 0.2333,
    }
    await page.mouse.click(firstStart.x, firstStart.y)
    await page.mouse.click(sharedEndpoint.x, sharedEndpoint.y)
    await page.mouse.move(perpendicularEnd.x, perpendicularEnd.y)
    await expect(drawing.locator('[data-sketch-direction-inference="perpendicular"]')).toBeVisible()
    await page.mouse.click(perpendicularEnd.x, perpendicularEnd.y)

    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(2)
    await expect(page.getByText("Perpendicular", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Point", exact: true }).click()
    const firstLine = drawing.locator('[data-sketch-entity-type="line"]').first()
    const firstLineBounds = await firstLine.boundingBox()
    if (!firstLineBounds) throw new Error("The inferred reference line is not visible.")
    const midpointProbe = {
      x: firstLineBounds.x + firstLineBounds.width / 2,
      y: firstLineBounds.y + firstLineBounds.height / 2 + 7,
    }
    await page.keyboard.down("Shift")
    await page.mouse.move(midpointProbe.x, midpointProbe.y)
    await expect(drawing.locator('[data-sketch-inference="midpoint"]')).toHaveCount(0)
    await page.keyboard.up("Shift")
    await page.mouse.move(midpointProbe.x + 1, midpointProbe.y)
    await expect(drawing.locator('[data-sketch-inference="midpoint"]')).toBeVisible()
    await page.mouse.click(midpointProbe.x + 1, midpointProbe.y)

    await expect(drawing.locator('[data-sketch-entity-type="point"]')).toHaveCount(4)
    await expect(page.getByText("Midpoint", { exact: true })).toBeVisible()
    await expect(page.getByText("Under-constrained", { exact: true })).toBeVisible()
  })

  test("draws, constrains, dimensions, edits, persists, and reopens a profile", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("48 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xz")
    const drawing = await drawRectangle(page)
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(0)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)

    await selectSketchEntities(page, drawing, "point", [0])
    await page
      .getByRole("toolbar", { name: "Sketch precision tools" })
      .getByRole("button", { name: "Fix point" })
      .click()
    await selectSketchEntities(page, drawing, "point", [0, 1])
    await addDimension(page, "Horizontal distance", "#width")
    await selectSketchEntities(page, drawing, "point", [1, 2])
    await addDimension(page, "Vertical distance", "20 mm")

    await expect(page.getByText("Fully constrained", { exact: true })).toBeVisible()
    await expect(page.getByText("Profile: 960 mm² · 136 mm perimeter")).toBeVisible()
    await page.getByRole("button", { name: "Extrude selected profile" }).dblclick()
    await expect(page.getByRole("form", { name: "Extrude profile" })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()

    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Rename", exact: true }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("span")
    await page.getByRole("button", { name: "Rename variable" }).dblclick()

    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByText("Horizontal distance · #span", { exact: true })).toBeVisible()
    const verticalConstraint = page
      .getByRole("listitem")
      .filter({ hasText: "Vertical distance · 20 mm" })
    await verticalConstraint.getByRole("button", { name: "Edit dimension" }).click()
    await verticalConstraint.getByRole("combobox", { name: "Driving expression" }).fill("25 mm")
    await verticalConstraint.getByRole("button", { name: "Save dimension" }).click()
    await expect(page.getByText("Vertical distance · 25 mm", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Finish sketch" }).dblclick()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-sketch-count",
      "1",
    )
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByText("Profile: 1,200 mm² · 146 mm perimeter")).toBeVisible()

    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByText("Horizontal distance · #span", { exact: true })).toBeVisible()
    await expect(page.getByText("Vertical distance · 25 mm", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("img", { name: "Solved sketch geometry" })).toBeVisible()

    await page.getByRole("button", { name: "Rename Sketch 1" }).click()
    const renameSketch = page.getByRole("dialog", { name: "Rename sketch" })
    await renameSketch.getByRole("textbox", { name: "Sketch name" }).fill("Mounting profile")
    await renameSketch.getByRole("button", { name: "Rename sketch", exact: true }).dblclick()
    await expect(page.getByRole("treeitem", { name: "Mounting profile" })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Mounting profile" })).toBeVisible()
  })
})
