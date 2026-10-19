import type { Locator, Page } from "@playwright/test"
import { writeVShape } from "../../packages/formats/src/vshape"
import { createCoordinateSketchProject } from "../support/sketch-coordinate-fixture"
import { openApplicationMenuItem } from "./application-menu-support"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

type AnnotationBrowser = { document: { querySelector(selector: string): AnnotationElement | null } }
type AnnotationElement = {
  closest(selector: string): AnnotationElement | null
  getAttribute(name: string): string | null
  getBoundingClientRect(): { x: number; y: number; width: number; height: number }
}

async function expectPointLeaders(page: Page) {
  const { sketch } = createCoordinateSketchProject()
  const pairs = sketch.constraints.flatMap((constraint) =>
    "firstPointId" in constraint
      ? [
          {
            id: constraint.id,
            pointId: constraint.firstPointId,
            label: "value" in constraint ? constraint.value.source.expression : null,
          },
        ]
      : [],
  )
  await expect
    .poll(() =>
      page.evaluate((pairs) => {
        const { document } = globalThis as unknown as AnnotationBrowser
        return pairs.every(({ id, pointId, label }) => {
          const button = document.querySelector(`[data-sketch-constraint-id="${id}"]`)
          if (!button) return true
          const line = document.querySelector(`[data-sketch-coordinate-leader="${id}"]`)
          const point = document.querySelector(`circle[data-sketch-entity-id="${pointId}"]`)
          const root = line?.closest("svg")
          if (!line || !point || !root || !button.getAttribute("aria-label")?.includes(label ?? ""))
            return false
          const overlay = root.getBoundingClientRect(),
            pointBox = point.getBoundingClientRect()
          const anchorX = overlay.x + Number(line.getAttribute("x1")),
            anchorY = overlay.y + Number(line.getAttribute("y1"))
          return (
            Math.abs(anchorX - pointBox.x - pointBox.width / 2) < 1 &&
            Math.abs(anchorY - pointBox.y - pointBox.height / 2) < 1
          )
        })
      }, pairs),
    )
    .toBe(true)
}

async function expectLeaderTouchesLabel(page: Page, label: Locator) {
  const id = await label.getAttribute("data-sketch-constraint-id")
  const line = page.locator(`[data-sketch-coordinate-leader="${id}"]`)
  await expect
    .poll(async () => {
      const bounds = await label.boundingBox()
      const endpoint = await line.evaluate((element) => {
        const line = element as unknown as AnnotationElement & {
          getScreenCTM(): {
            a: number
            b: number
            c: number
            d: number
            e: number
            f: number
          } | null
        }
        const matrix = line.getScreenCTM()
        if (!matrix) throw new Error("The leader must have a screen transform.")
        const x = Number(line.getAttribute("x2")),
          y = Number(line.getAttribute("y2"))
        return {
          x: matrix.a * x + matrix.c * y + matrix.e,
          y: matrix.b * x + matrix.d * y + matrix.f,
        }
      })
      if (!bounds) return false
      return (
        endpoint.x >= bounds.x - 1 &&
        endpoint.x <= bounds.x + bounds.width + 1 &&
        endpoint.y >= bounds.y - 1 &&
        endpoint.y <= bounds.y + bounds.height + 1
      )
    })
    .toBe(true)
}

async function expectPointAnnotationThemes(
  page: Page,
  point: Locator,
  dimensions: Locator,
  browserName: string,
) {
  for (const theme of ["Dark", "Light"]) {
    await openApplicationMenuItem(page, "Settings…")
    const settings = page.getByRole("dialog", { name: "Settings", exact: true })
    await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
    await page.getByRole("option", { name: theme, exact: true }).click()
    await settings.getByRole("button", { name: "Done", exact: true }).click()
    await point.hover()
    await expect(dimensions).toHaveCount(2)
    await expectPointLeaders(page)
    if (browserName === "chromium")
      await page.screenshot({
        path: test.info().outputPath(`coordinates-${theme.toLowerCase()}.png`),
      })
  }
}

test("shows original point formulas on hover by default, with an all-label toggle and camera-safe editable leaders", async ({
  page,
  browserName,
}) => {
  const fixture = createCoordinateSketchProject()
  const archive = await writeVShape({
    snapshot: fixture.snapshot,
    events: fixture.events,
    exportedAt: "2026-10-05T00:00:00Z",
    createdBy: { application: "VibeShape annotation fixture", version: "1", build: null },
    engine: null,
  })
  if (!archive.ok) throw new Error(archive.diagnostic.message)
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto("/")
  await saved(page)
  await openApplicationMenuItem(page, "Projects")
  await page
    .getByRole("main")
    .getByLabel("Choose VibeShape project file")
    .setInputFiles({
      name: "coordinates.vshape",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(archive.value),
    })
  await page.getByRole("treeitem", { name: "Coordinate outline", exact: true }).click()
  await expect(page.getByText("Fully constrained", { exact: true })).toBeVisible()
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const dimensions = page.locator('[data-sketch-constraint-kind="dimension"]')
  const all = page.getByRole("button", { name: "Show all point dimensions", exact: true })
  await expect(all).toHaveAttribute("aria-pressed", "false")
  await expect(dimensions).toHaveCount(0)
  const pointId = fixture.sketch.entities.find(
    (entity) => entity.type === "point" && entity.x === 26,
  )?.id
  if (!pointId) throw new Error("The fixture requires its rightmost point.")
  const point = drawing.locator(`circle[data-sketch-entity-id="${pointId}"]`)
  await point.hover()
  await expect(dimensions).toHaveCount(2)
  await expect(dimensions.first()).toHaveText("26 mm * 1.000000000000")
  await expectPointLeaders(page)
  await dimensions.first().hover()
  await expect(dimensions).toHaveCount(2)
  await dimensions.first().focus()
  await page.mouse.move(5, 5)
  await expect(dimensions).toHaveCount(2)
  await all.focus()
  await expect(dimensions).toHaveCount(0)
  await all.click()
  await expect(all).toHaveAttribute("aria-pressed", "true")
  await expect(dimensions).toHaveCount(48)
  await expectPointLeaders(page)
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
  await expectPointLeaders(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  await expectPointLeaders(page)
  const toggleBounds = await all.boundingBox()
  const profileBounds = await page.getByText(/^Profile:/).boundingBox()
  if (!toggleBounds || !profileBounds)
    throw new Error("The label toggle and sketch status must be visible.")
  expect(toggleBounds.y).toBeGreaterThan(profileBounds.y + profileBounds.height)
  await all.click()
  await expect(dimensions).toHaveCount(0)
  await expectPointAnnotationThemes(page, point, dimensions, browserName)
  await page.getByRole("button", { name: "Rotate view", exact: true }).click()
  const canvas = page.getByRole("region", { name: "3D viewport", exact: true }).locator("canvas")
  const box = await canvas.boundingBox()
  if (!box) throw new Error("The navigation canvas must be visible.")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  await page.getByRole("button", { name: "Rotate view", exact: true }).click()
  const projection = page.locator("[data-sketch-plane-projection]")
  let previousProjection: string | null = null
  await expect
    .poll(
      async () => {
        const current = await projection.getAttribute("transform")
        const settled = current === previousProjection
        previousProjection = current
        return settled
      },
      { intervals: [200] },
    )
    .toBe(true)
  await point.click()
  await page.mouse.move(5, 5)
  await expect(dimensions).toHaveCount(2)
  await expectPointLeaders(page)
  const label = dimensions.first()
  const before = await label.boundingBox()
  if (!before) throw new Error("The coordinate label must be visible.")
  await page.mouse.move(before.x + 30, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + 70, before.y + before.height / 2 + 35, { steps: 8 })
  await expectLeaderTouchesLabel(page, label)
  await page.mouse.up()
  await expect.poll(async () => (await label.boundingBox())?.x).toBeCloseTo(before.x + 40, 0)
  await expect.poll(async () => (await label.boundingBox())?.y).toBeCloseTo(before.y + 35, 0)
  await expectPointLeaders(page)
  await label.dblclick()
  await expect(page.getByRole("combobox", { name: "Driving dimension expression" })).toHaveValue(
    "26 mm * 1.000000000000",
  )
  await page.keyboard.press("Escape")
  await page
    .getByRole("complementary", { name: "Task panel" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  const reopened = await saveProject(page)
  expect(reopened.project.snapshot.sketches).toEqual(fixture.snapshot.sketches)
})
