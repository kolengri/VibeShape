import type { Locator } from "@playwright/test"
import { expect, test } from "./fixtures"
import {
  confirmSketchPlane,
  drawRectangle,
  openConstraintManager,
  selectSketchTool,
} from "./sketch-helpers"

async function orientationInset(viewport: Locator) {
  const canvas = viewport.locator("canvas").first()
  await expect(canvas).toHaveAttribute(
    "data-orientation-inset",
    /^\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+(?:\.\d+)?$/,
  )
  return canvas.evaluate((element) => {
    const [x, y, size] = (element.dataset.orientationInset ?? "").split(",").map(Number)
    if (x === undefined || y === undefined || size === undefined || size <= 0) {
      throw new Error("Expected the rendered orientation inset placement.")
    }
    const rect = element.getBoundingClientRect()
    const scaleX = rect.width / element.clientWidth
    const scaleY = rect.height / element.clientHeight
    const inset = {
      x: rect.x + x * scaleX,
      y: rect.y + (element.clientHeight - y - size) * scaleY,
      width: size * scaleX,
      height: size * scaleY,
    }
    const hitAt = (clientX: number, clientY: number) =>
      element.ownerDocument
        .elementsFromPoint(clientX, clientY)
        .slice(0, 6)
        .map((hit: { tagName: string; getAttribute: (name: string) => string | null }) => ({
          tag: hit.tagName,
          role: hit.getAttribute("role"),
          label: hit.getAttribute("aria-label"),
          className: hit.getAttribute("class"),
        }))
    return {
      ...inset,
      canvas: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
      },
      placement: { x, y, size },
      reservedLeft: element.parentElement?.querySelector("[data-viewport-orientation-offset]")
        ?.clientWidth,
      oldFixtureHit: hitAt(rect.x + 12, rect.y + rect.height - 84),
      insetHit: hitAt(inset.x + 4, inset.y + 4),
    }
  })
}

function screenGeometry(lines: Locator) {
  return lines.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect()
      return { x, y, width, height }
    }),
  )
}

test("locates a manager constraint and orbits through the inset while a sketch drawing tool is active", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await page
    .getByRole("toolbar", { name: "Model commands", exact: true })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page, "xy")
  const drawing = await drawRectangle(page)
  await page.mouse.move(0, 0)
  await openConstraintManager(page)
  const manager = page.getByRole("dialog", { name: /^Constraint manager \(\d+\)$/ })
  const horizontal = manager.getByRole("button", { name: /^Horizontal/ }).first()
  await horizontal.click()
  await expect(horizontal).toHaveAttribute("aria-pressed", "true")
  await expect(
    drawing.locator("[data-sketch-constraint-related-entity] rect").first(),
  ).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("selected-constraint-geometry.png") })
  await manager.getByRole("button", { name: "Close constraint manager", exact: true }).click()
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-sketch-context-mode", "normal")
  const lines = drawing.locator('[data-sketch-entity-type="line"]')
  const ids = await lines.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-sketch-entity-id")),
  )
  const inset = await orientationInset(viewport)
  await test.info().attach("orientation-input-geometry", {
    body: JSON.stringify(inset, null, 2),
    contentType: "application/json",
  })
  const beforeDrag = await screenGeometry(lines)
  await page.mouse.move(inset.x + 4, inset.y + 4)
  await page.mouse.down()
  await page.mouse.move(inset.x + 18, inset.y + 12, { steps: 3 })
  await expect(viewport).toHaveAttribute("data-sketch-context-mode", "orbit")
  const firstProjection = await screenGeometry(lines)
  await page.mouse.move(inset.x + 52, inset.y + 35, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => screenGeometry(lines)).not.toEqual(firstProjection)
  expect(
    await lines.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-sketch-entity-id")),
    ),
  ).toEqual(ids)
  await expect(
    page
      .getByRole("toolbar", { name: "Model commands", exact: true })
      .getByRole("button", { name: "Rectangle", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: test.info().outputPath("orientation-drag-active-rectangle.png") })
  await test.info().attach("orientation-drag-projections", {
    body: JSON.stringify(
      { beforeDrag, firstProjection, afterDrag: await screenGeometry(lines) },
      null,
      2,
    ),
    contentType: "application/json",
  })

  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-sketch-context-mode", "normal")
  const normalInset = await orientationInset(viewport)
  // On the XY normal view, the positive Z endpoint faces the camera at the inset center.
  await page.mouse.click(
    normalInset.x + normalInset.width / 2,
    normalInset.y + normalInset.height / 2,
  )
  await expect(viewport).toHaveAttribute("data-sketch-context-mode", "orbit")
  expect(
    await lines.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-sketch-entity-id")),
    ),
  ).toEqual(ids)
  await expect(
    page
      .getByRole("toolbar", { name: "Model commands", exact: true })
      .getByRole("button", { name: "Rectangle", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({
    path: test.info().outputPath("orientation-axis-click-active-rectangle.png"),
  })
})
