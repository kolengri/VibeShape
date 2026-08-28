import type { Locator, Page } from "@playwright/test"
import { expect } from "./fixtures"

export async function drawRectangle(page: Page) {
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  await page.mouse.click(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.62)
  await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.38)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  return drawing
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
  if (additive) await page.keyboard.down("Control")
  try {
    await page.mouse.click(position.x, position.y)
  } finally {
    if (additive) await page.keyboard.up("Control")
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
  await page.getByRole("combobox", { name: "Dimension type" }).selectOption({ label: type })
  const input = page.getByRole("combobox", { name: "Driving expression" })
  await input.fill(expression)
  await page.getByRole("button", { name: "Add constraint" }).click()
}
