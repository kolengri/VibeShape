import { resolve } from "node:path"
import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, selectSketchTool } from "./sketch-helpers"

type CameraProjection = Readonly<Record<"a" | "b" | "c" | "d" | "e" | "f", number>>
type ProjectionCanvas = { style: { cssText: string }; remove(): void }
type ProjectionBrowser = {
  document: {
    createElement(tag: "canvas"): ProjectionCanvas
    body: { append(canvas: ProjectionCanvas): void }
  }
  requestAnimationFrame(callback: () => void): void
}
type ProjectionViewer = {
  createGeometryViewport(canvas: ProjectionCanvas): {
    orientToFrame(frame: unknown): boolean
    setSketchPlaneProjection(
      frame: unknown,
      onChange: (value: CameraProjection | null) => void,
    ): void
    dispose(): void
  }
}

async function createProfile(page: Page) {
  await page
    .getByRole("complementary", { name: "Task panel" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page, "xy")
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The sketch canvas has no measurable bounds.")
  await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.42)
  await page.mouse.click(bounds.x + bounds.width * 0.74, bounds.y + bounds.height * 0.3)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
}

test("preserves a normal sketch projection far from the world origin when changing camera up", async ({
  page,
}) => {
  await page.goto("/")
  const projection = await page.evaluate(
    async (viewerPath) => {
      const browser = globalThis as unknown as ProjectionBrowser
      const viewer: ProjectionViewer = await import(viewerPath)
      const canvas = browser.document.createElement("canvas")
      canvas.style.cssText = "position:fixed;width:400px;height:400px"
      browser.document.body.append(canvas)
      const viewport = viewer.createGeometryViewport(canvas)
      try {
        await new Promise<void>((resolveFrame) =>
          browser.requestAnimationFrame(() => resolveFrame()),
        )
        const frame = {
          origin: [-100, 1_000_000_000, 0],
          xAxis: [0, 0, -1],
          yAxis: [0, 1, 0],
          normal: [1, 0, 0],
        } as const
        if (!viewport.orientToFrame(frame)) throw new Error("The support frame is invalid.")
        const result: { value: CameraProjection | null } = { value: null }
        viewport.setSketchPlaneProjection(frame, (value) => {
          result.value = value
        })
        return result.value
      } finally {
        viewport.dispose()
        canvas.remove()
      }
    },
    `/@fs${resolve("packages/viewer/src/three-viewport.ts")}`,
  )
  expect(projection).not.toBeNull()
  expect(projection?.a).toBeCloseTo(-(projection?.d ?? 0), 8)
  expect(projection?.b).toBeCloseTo(0, 8)
  expect(projection?.c).toBeCloseTo(0, 8)
  expect(projection?.e).toBeCloseTo(0.5, 8)
  expect(projection?.f).toBeCloseTo(0.5, 8)
})

async function expectRotation(page: Page, canvas: Locator, button: "left" | "middle" = "left") {
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
  const inset = await canvas.getAttribute("data-orientation-inset")
  if (!inset) throw new Error("The camera orientation inset is unavailable.")
  const [insetX = 0, insetY = 0, size = 0] = inset.split(",").map(Number)
  const clip = {
    x: bounds.x + insetX,
    y: bounds.y + bounds.height - insetY - size,
    width: size,
    height: size,
  }
  const x = bounds.x + bounds.width * 0.15
  const y = bounds.y + bounds.height * 0.75
  await page.mouse.move(x, y)
  // The orientation axes change only with the camera, never with model preselection.
  const before = await page.screenshot({ clip })
  await page.mouse.down({ button })
  await page.mouse.move(x + 70, y + 40, { steps: 8 })
  await page.mouse.up({ button })
  await expect
    .poll(async () => (await page.screenshot({ clip })).equals(before), {
      message: `${button} camera rotation must change the orientation axes.`,
    })
    .toBe(false)
}

for (const command of ["Extrude", "Revolve"] as const) {
  test(`keeps camera rotation available immediately after creating ${command}`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await createProfile(page)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: command, exact: true })
      .click()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
    const canvas = viewport.locator("canvas")
    const form = page.getByRole("form", {
      name: command === "Extrude" ? "Extrude profile" : "Revolve profile",
    })
    await form
      .getByRole("button", {
        name: command === "Extrude" ? "Create extrusion" : "Create revolve",
        exact: true,
      })
      .click()
    await expect(form).toHaveCount(0)
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expectRotation(page, canvas)
    await expectRotation(page, canvas, "middle")
  })
}
