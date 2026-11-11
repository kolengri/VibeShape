import type { Locator, Page } from "@playwright/test"
import { expect } from "./fixtures"

export async function fitIsometricView(page: Page) {
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await page.getByRole("button", { name: "Standard views", exact: true }).click()
  await page.getByRole("menuitem", { name: "Isometric", exact: true }).click()
}

export async function drawRectangle(page: Page) {
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const [first, second] = await uncoveredRectangleCorners(page, drawing)
  await page.mouse.click(first.x, first.y)
  await page.mouse.click(second.x, second.y)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  return drawing
}

/** Picks rectangle corners inside the free canvas whose corners all reach the drawing. */
async function uncoveredRectangleCorners(page: Page, drawing: Locator) {
  const bounds = await unobscuredDrawingBounds(page, drawing)
  for (const [left, top, right, bottom] of [
    [0.35, 0.38, 0.65, 0.62],
    [0.2, 0.45, 0.45, 0.8],
    [0.15, 0.25, 0.4, 0.6],
    [0.55, 0.45, 0.8, 0.8],
  ] as const) {
    const point = (horizontal: number, vertical: number) => ({
      x: bounds.x + bounds.width * horizontal,
      y: bounds.y + bounds.height * vertical,
    })
    const corners = [point(left, top), point(right, top), point(right, bottom), point(left, bottom)]
    const reachable = await drawing.evaluate(
      (element, points) =>
        points.every(({ x, y }) => {
          const hit = element.ownerDocument.elementFromPoint(x, y)
          return hit !== null && element.contains(hit)
        }),
      corners,
    )
    if (reachable) return [point(left, bottom), point(right, top)] as const
  }
  throw new Error("No uncovered rectangle fits in the free sketch canvas.")
}

export async function selectSketchTool(page: Page, family: string, tool: string | RegExp) {
  await page.getByRole("button", { name: family, exact: true }).click()
  await page.getByRole("menuitemradio", { name: tool, exact: typeof tool === "string" }).click()
}

export async function confirmSketchPlane(page: Page, plane: "xy" | "xz" | "yz" = "xy") {
  const planeLabels = {
    xy: "XY plane",
    xz: "XZ plane",
    yz: "YZ plane",
  } as const
  await page
    .getByRole("complementary", { name: "Sketch task panel" })
    .getByRole("button", { name: planeLabels[plane], exact: true })
    .click()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
  // Coordinate-based authoring fixtures deliberately use the plane-normal drawing view.
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await expect(page.getByRole("img", { name: "Editable sketch geometry" })).not.toHaveAttribute(
    "data-sketch-spatial",
    "true",
  )
}

export async function openConstraintManager(page: Page) {
  const trigger = page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Open constraint manager", exact: true })
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
  const manager = page.getByRole("dialog", { name: /^Constraint manager \(\d+\)$/ })
  await expect(manager).toBeVisible()
  return manager
}

export async function selectOriginPlaneInViewport(page: Page, plane: "xy" | "xz" | "yz") {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-origin-plane-selection", /xy|xz|yz/)
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The 3D viewport canvas is not visible.")

  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      const x = bounds.x + (bounds.width * column) / 12
      const y = bounds.y + (bounds.height * row) / 12
      await page.mouse.move(x, y)
      await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
      if ((await viewport.getAttribute("data-origin-plane-preselection")) === plane) {
        await page.mouse.click(x, y)
        await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
        return
      }
    }
  }
  throw new Error(`The ${plane.toUpperCase()} origin plane was not pickable in the 3D viewport.`)
}

export async function selectIdleOriginPlaneInViewport(page: Page, plane: "xy" | "xz" | "yz") {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The 3D viewport canvas is not visible.")

  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      const x = bounds.x + (bounds.width * column) / 12
      const y = bounds.y + (bounds.height * row) / 12
      await page.mouse.move(x, y)
      await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
      if ((await viewport.getAttribute("data-origin-plane-preselection")) === plane) {
        await page.mouse.click(x, y)
        await expect(viewport).toHaveAttribute("data-origin-plane-selection", plane)
        return { x, y }
      }
    }
  }
  throw new Error(`The ${plane.toUpperCase()} origin plane was not pickable while idle.`)
}

export async function unobscuredDrawingBounds(page: Page, drawing: Locator) {
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
  const bounds = await drawing.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (!style) throw new Error("The drawing has no browser style context.")
    const inset = (edge: string) =>
      Math.max(0, Number.parseFloat(style.getPropertyValue(`--workspace-chrome-${edge}`)) || 0)
    return {
      x: rect.x + inset("left"),
      y: rect.y + inset("top"),
      width: rect.width - inset("left") - inset("right"),
      height: rect.height - inset("top") - inset("bottom"),
    }
  })
  if (bounds.width <= 0 || bounds.height <= 0)
    throw new Error("The unobscured drawing area is empty.")
  return bounds
}

function* savedProfileSamplePositions(bounds: {
  x: number
  y: number
  width: number
  height: number
}) {
  for (const divisions of [12, 20]) {
    for (let row = 1; row < divisions; row += 1) {
      for (let column = 1; column < divisions; column += 1) {
        yield {
          x: bounds.x + (bounds.width * column) / divisions,
          y: bounds.y + (bounds.height * row) / divisions,
        }
      }
    }
  }
}

export async function clickSavedProfileInViewport(page: Page, label: string, additive = false) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The saved profile viewport must be measurable.")
  const status = viewport.getByText(`Select profile: ${label}`, { exact: true })
  for (const position of savedProfileSamplePositions(bounds)) {
    const canvasReceivesPointer = await canvas.evaluate((element, point) => {
      const target = element.ownerDocument.elementFromPoint(point.x, point.y)
      return target !== null && element.contains(target)
    }, position)
    if (!canvasReceivesPointer) continue
    await page.mouse.move(position.x, position.y)
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
    if (!(await status.isVisible())) continue
    if (additive) await page.keyboard.down("Shift")
    try {
      await page.mouse.click(position.x, position.y)
    } finally {
      if (additive) await page.keyboard.up("Shift")
    }
    return
  }
  throw new Error(`${label} was not pickable in the 3D viewport.`)
}

export async function selectModelEdgeInViewport(page: Page, featureLabel: string) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvasBounds = await viewport.locator("canvas").boundingBox()
  if (!canvasBounds) throw new Error("The 3D reference-selection canvas is not visible.")

  const escapedFeatureLabel = featureLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const edgeLabel = new RegExp(`^${escapedFeatureLabel} · Edge \\d+$`)
  const hoverStatus = page
    .getByRole("status")
    .filter({ hasText: `Use reference: ${featureLabel} · Edge` })
  const selectOther = page.getByRole("listbox", { name: "Select other reference" })
  const selectedReference = page
    .getByRole("complementary", { name: "Sketch task panel" })
    .getByText(edgeLabel)
  const centerX = canvasBounds.x + canvasBounds.width / 2
  const centerY = canvasBounds.y + canvasBounds.height / 2
  const probeOffsets = Array.from({ length: 38 }, (_, index) => (index + 3) * 4).flatMap(
    (radius) =>
      [
        [radius, 0],
        [-radius, 0],
        [0, radius],
        [0, -radius],
        [radius, radius],
        [-radius, radius],
        [radius, -radius],
        [-radius, -radius],
      ] as const,
  )

  for (const [offsetX, offsetY] of probeOffsets) {
    const x = centerX + offsetX
    const y = centerY + offsetY
    await page.mouse.move(x, y)
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
    if (!(await hoverStatus.isVisible())) continue
    await page.mouse.click(x, y)
    if (await selectOther.isVisible()) {
      await selectOther.getByRole("option", { name: edgeLabel }).first().click()
    }
    if (!(await selectedReference.isVisible())) continue
    const label = await selectedReference.textContent()
    if (label) return label
  }

  throw new Error(`No selectable ${featureLabel} edge was found in the 3D viewport.`)
}

export async function selectSketchEntities(
  page: Page,
  drawing: Locator,
  type: "point" | "line" | "circle" | "arc" | "ellipse" | "elliptical-arc",
  indices: readonly number[],
) {
  await page.getByRole("button", { name: "Select", exact: true }).click()
  const entities = drawing.locator(`[data-sketch-entity-type="${type}"]`)
  for (const [selectionIndex, entityIndex] of indices.entries()) {
    await clickSketchEntity(page, entities.nth(entityIndex), selectionIndex > 0)
  }
}

export async function clickSketchEntity(page: Page, entity: Locator, additive = false) {
  return clickSketchEntityAt(page, entity, 0.37, additive)
}

export async function clickSketchEntityAt(
  page: Page,
  entity: Locator,
  fraction: number,
  additive = false,
  button: "left" | "right" = "left",
) {
  const position = await entity.evaluate(
    (element, normalizedFraction) => {
      type ScreenPoint = Readonly<{
        x: number
        y: number
        matrixTransform: (matrix: unknown) => ScreenPoint
      }>
      const geometry = element as unknown as {
        getPointAtLength?: (length: number) => ScreenPoint
        getScreenCTM?: () => unknown
        getTotalLength?: () => number
      }
      if (!geometry.getPointAtLength || !geometry.getScreenCTM || !geometry.getTotalLength) {
        throw new TypeError("Sketch entity selection requires SVG geometry.")
      }
      const matrix = geometry.getScreenCTM()
      if (!matrix) throw new Error("Sketch entity is detached from the viewport.")
      const point = geometry
        .getPointAtLength(geometry.getTotalLength() * normalizedFraction)
        .matrixTransform(matrix)
      return { x: point.x, y: point.y }
    },
    Math.min(1, Math.max(0, fraction)),
  )
  if (additive) await page.keyboard.down("Shift")
  try {
    await page.mouse.click(position.x, position.y, { button })
  } finally {
    if (additive) await page.keyboard.up("Shift")
  }
}

export async function addDimension(
  page: Page,
  type:
    | "Distance"
    | "Horizontal distance"
    | "Vertical distance"
    | "Angle"
    | "Radius"
    | "Diameter"
    | "Primary axis diameter"
    | "Secondary axis diameter",
  expression: string,
) {
  const selectionAction = page.getByRole("button", { name: "Add drawing dimension" })
  if (await selectionAction.isVisible()) await selectionAction.click()

  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const drawingBounds = await drawing.boundingBox()
  if (!drawingBounds) throw new Error("The editable sketch canvas is not visible.")
  const bounds = await unobscuredDrawingBounds(page, drawing)
  const placement = {
    Angle: { x: 0.7, y: 0.3 },
    Diameter: { x: 0.7, y: 0.3 },
    Distance: { x: 0.5, y: 0.25 },
    "Horizontal distance": { x: 0.5, y: 0.25 },
    "Primary axis diameter": { x: 0.7, y: 0.3 },
    Radius: { x: 0.7, y: 0.3 },
    "Secondary axis diameter": { x: 0.3, y: 0.7 },
    "Vertical distance": { x: 0.75, y: 0.5 },
  } as const
  const anchor = placement[type]
  await drawing.click({
    position: {
      x: bounds.x - drawingBounds.x + bounds.width * anchor.x,
      y: bounds.y - drawingBounds.y + bounds.height * anchor.y,
    },
  })

  const editor = page.getByRole("form", { name: "Dimension value" })
  await expect(editor).toBeVisible()
  const typeControl = editor.getByRole("combobox", { name: "Dimension type" })
  if (await typeControl.isVisible()) {
    const optionLabels = {
      Angle: "Angle",
      Diameter: "Diameter",
      Distance: "Distance",
      "Horizontal distance": "Horizontal",
      "Primary axis diameter": "Primary axis",
      Radius: "Radius",
      "Secondary axis diameter": "Secondary axis",
      "Vertical distance": "Vertical",
    } as const
    await typeControl.selectOption({ label: optionLabels[type] })
  }
  const input = editor.getByRole("combobox", { name: "Driving dimension expression" })
  await input.fill(expression)
  await editor.getByRole("button", { name: "Apply dimension" }).click()
  await openConstraintManager(page)
}

/** Proves that no other viewport chrome covers the control's center. */
export async function expectUncoveredControl(control: Locator) {
  await expect(control).toBeVisible()
  expect(
    await control.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const hit = element.ownerDocument.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      )
      return hit !== null && element.contains(hit)
    }),
  ).toBe(true)
}

/** The applied-constraint list lives in the Constraint manager dialog, not the task panel. */
export function constraintManager(page: Page) {
  return page.getByRole("dialog", { name: /^Constraint manager \(\d+\)$/ })
}

/** Clicks the first sampled point of a sketch entity that is not covered by floating chrome. */
export async function clickUncoveredSketchEntity(page: Page, entity: Locator) {
  const position = await entity.evaluate((element) => {
    type ScreenPoint = Readonly<{
      x: number
      y: number
      matrixTransform: (matrix: unknown) => ScreenPoint
    }>
    const geometry = element as unknown as {
      getPointAtLength?: (length: number) => ScreenPoint
      getScreenCTM?: () => unknown
      getTotalLength?: () => number
      ownerSVGElement?: { contains: (node: unknown) => boolean } | null
    }
    if (!geometry.getPointAtLength || !geometry.getScreenCTM || !geometry.getTotalLength) {
      throw new TypeError("Sketch entity selection requires SVG geometry.")
    }
    const matrix = geometry.getScreenCTM()
    const drawing = geometry.ownerSVGElement
    if (!matrix || !drawing) throw new Error("Sketch entity is detached from the viewport.")
    const length = geometry.getTotalLength()
    for (const fraction of [0.5, 0.37, 0.63, 0.25, 0.75, 0.15, 0.85]) {
      const point = geometry.getPointAtLength(length * fraction).matrixTransform(matrix)
      const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
      if (hit && drawing.contains(hit)) return { x: point.x, y: point.y }
    }
    throw new Error("Floating chrome covers the whole sketch entity.")
  })
  await page.mouse.click(position.x, position.y)
}
