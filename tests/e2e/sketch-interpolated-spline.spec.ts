import type { Locator, Page } from "@playwright/test"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { confirmSketchPlane } from "./sketch-helpers"

async function clickPoint(page: Page, drawing: Locator, x: number, y: number) {
  const point = await drawing.locator("[data-sketch-plane-projection]").evaluate(
    (element, target) => {
      const projection = element as unknown as {
        getScreenCTM: () => { a: number; b: number; c: number; d: number; e: number; f: number }
      }
      const matrix = projection.getScreenCTM()
      // Integer CSS pixels make a repeated pick land on exactly the same sketch coordinates.
      return {
        x: Math.round(matrix.a * target.x - matrix.c * target.y + matrix.e),
        y: Math.round(matrix.b * target.x - matrix.d * target.y + matrix.f),
      }
    },
    { x, y },
  )
  await page.mouse.click(point.x, point.y)
}

test("draws a closed interpolating spline, extrudes it, reopens it and uses a spline model edge", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  await saved(page)
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page)
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await toolbar.getByRole("button", { name: "Spline", exact: true }).click()
  const instruction = page.locator("[data-sketch-interpolated-spline-instruction]")
  await expect(instruction).toContainText("Click the first through-point")

  // Escape discards pending through-points without touching the draft.
  await clickPoint(page, drawing, 20, 0)
  await clickPoint(page, drawing, 0, 20)
  await expect(drawing.locator("[data-sketch-interpolated-spline-preview]")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(drawing.locator("[data-sketch-spline-through-point]")).toHaveCount(0)
  await expect(drawing.locator('[data-sketch-entity-type="cubic-bezier"]')).toHaveCount(0)

  for (const [x, y] of [
    [20, 0],
    [0, 20],
    [-20, 0],
    [0, -20],
  ] as const) {
    await clickPoint(page, drawing, x, y)
  }
  await expect(drawing.locator("[data-sketch-spline-close-target]")).toBeVisible()
  await clickPoint(page, drawing, 20, 0)
  const cubics = drawing.locator('[data-sketch-entity-type="cubic-bezier"]')
  await expect(cubics).toHaveCount(4)
  await expect(drawing.locator("[data-sketch-spline-through-point]")).toHaveCount(0)
  await expect(instruction).toContainText("Click the first through-point")
  const curveIds = await cubics.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-sketch-entity-id")).sort(),
  )

  // One gesture is one local undo entry.
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(cubics).toHaveCount(0)
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(cubics).toHaveCount(4)

  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1", {
    timeout: 60_000,
  })
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const extrusion = page.getByRole("form", { name: "Extrude profile", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 60_000 })
  await extrusion.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(extrusion).toHaveCount(0, { timeout: 30_000 })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", { timeout: 120_000 })
  await saved(page)

  const extruded = await saveProject(page)
  const authored = extruded.project.snapshot.sketches[0]
  expect(authored?.entities.filter(({ type }) => type === "cubic-bezier")).toHaveLength(4)
  expect(authored?.constraints.map(({ type }) => type)).toEqual([
    "tangent-join",
    "tangent-join",
    "tangent-join",
    "tangent-join",
  ])

  await page.reload()
  await saved(page)
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expect(drawing).toBeVisible()
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await expect(cubics).toHaveCount(4)
  expect(
    await cubics.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-sketch-entity-id")).sort(),
    ),
  ).toEqual(curveIds)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)

  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page)
  await page.getByRole("button", { name: "Use external geometry", exact: true }).click()
  const splineEdge = drawing
    .locator(
      '[data-sketch-available-external-geometry-id][aria-label^="Extrusion 1 · Spline edge"]',
    )
    .first()
  await expect(splineEdge).toBeAttached({ timeout: 60_000 })
  await splineEdge.focus()
  await page.keyboard.press("Enter")
  await expect(drawing.locator("[data-sketch-external-curve-count]")).toHaveAttribute(
    "data-sketch-external-curve-count",
    "1",
    { timeout: 30_000 },
  )
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)

  const used = await saveProject(page)
  const reference = used.project.snapshot.sketches[1]?.externalReferences?.[0]
  expect(reference).toMatchObject({
    kind: "model-spline",
    reference: { kind: "edge", signature: { geometryClass: "BEZIER_CURVE" } },
  })
  if (reference?.kind !== "model-spline") throw new Error("Expected a model spline reference.")
  expect(reference.projectedCurveIds).toHaveLength(1)
  expect(reference.projectedPointIds).toHaveLength(4)
})
