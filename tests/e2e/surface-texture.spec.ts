import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import type { SurfaceTextureMask } from "../../packages/domain/src/surface-textures"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test.setTimeout(60_000)

async function createBox(page: Page) {
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box" })
  for (const name of ["Width", "Depth", "Height"])
    await box.getByRole("combobox", { name, exact: true }).fill("10 mm")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
  )
}

async function openTexture(page: Page) {
  await invokeModelCommand(page, "Modify", "Surface texture")
  const panel = page.getByRole("complementary", { name: "Surface texture" })
  await panel.getByRole("combobox", { name: "Body", exact: true }).selectOption({ label: "Box 1" })
  await expect(panel.getByText("Relief preview ready.", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  return panel
}

async function exportedStl(page: Page) {
  await openApplicationMenuItem(page, "Export geometry…")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export STL", exact: true }).click()
  const path = await (await download).path()
  if (!path) throw new Error("The STL download has no local path.")
  const bytes = await readFile(path)
  const triangles = bytes.readUInt32LE(80)
  expect(bytes.length).toBe(84 + triangles * 50)
  const max = [-Infinity, -Infinity, -Infinity]
  for (let triangle = 0; triangle < triangles; triangle++)
    for (let vertex = 0; vertex < 3; vertex++)
      for (let axis = 0; axis < 3; axis++)
        max[axis] = Math.max(
          max[axis] ?? -Infinity,
          bytes.readFloatLE(84 + triangle * 50 + 12 + vertex * 12 + axis * 4),
        )
  return { triangles, max }
}

test("surface relief previews, commits once, survives reopen, and changes the exported mesh", async ({
  page,
}) => {
  await createBox(page)
  const original = await exportedStl(page)
  const panel = await openTexture(page)
  await panel.getByRole("button", { name: "Browse textures", exact: true }).click()
  await panel.getByRole("button", { name: "Knurling", exact: true }).click()
  await panel.getByRole("button", { name: "Done", exact: true }).click()
  await panel.getByRole("spinbutton", { name: "Relief height (mm)", exact: true }).fill("0.6")
  await expect(panel.getByText("Relief preview ready.", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toBeVisible()
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
  )
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("treeitem", { name: "Box 1 · 1 layer", exact: true }).click()
  await expect(
    panel.getByRole("spinbutton", { name: "Relief height (mm)", exact: true }),
  ).toHaveValue("0.6")
  await expect(panel.getByRole("button", { name: "Layer 1 · Knurling", exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Cancel", exact: true }).click()
  const textured = await exportedStl(page)
  expect(textured.triangles).toBeGreaterThan(original.triangles)
  expect(textured.max[2]).toBeGreaterThan((original.max[2] ?? 0) + 0.1)
})

test("painting stays a cancellable draft and supports stroke undo", async ({ page }) => {
  await createBox(page)
  const panel = await openTexture(page)
  await panel.getByRole("button", { name: "Paint", exact: true }).click()
  const canvas = page.getByRole("region", { name: "3D viewport" }).locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The model canvas is unavailable.")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect(canvas).toHaveAttribute("data-surface-texture-stroke", "true")
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("button", { name: "Undo stroke", exact: true })).toBeDisabled()
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 15, bounds.y + bounds.height / 2 + 8, {
    steps: 5,
  })
  await page.mouse.up()
  await expect(panel.getByRole("button", { name: "Undo stroke", exact: true })).toBeEnabled()
  await page.mouse.down()
  await expect(canvas).toHaveAttribute("data-surface-texture-stroke", "true")
  await expect(panel.getByRole("button", { name: "Undo stroke", exact: true })).toBeDisabled()
  await page.keyboard.press("ControlOrMeta+z")
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(panel.getByRole("button", { name: "Undo stroke", exact: true })).toBeEnabled()
  await panel.getByRole("button", { name: "Undo stroke", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Undo stroke", exact: true })).toBeDisabled()
  await panel.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toHaveCount(0)
  await page.reload()
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toHaveCount(0)
})

test("erasing a raised image stores brush dabs on the original body surface", async ({ page }) => {
  test.setTimeout(90_000)
  await createBox(page)
  const panel = await openTexture(page)
  await panel.locator('input[type="file"]').setInputFiles({
    name: "white.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAD0lEQVR4nGP4jwYYSBcAAHg8P8FY7imoAAAAAElFTkSuQmCC",
      "base64",
    ),
  })
  await panel.getByRole("spinbutton", { name: "Relief height (mm)", exact: true }).fill("1")
  await expect(panel.getByText("Relief preview ready.", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await panel.getByRole("button", { name: "Erase", exact: true }).click()
  await panel.getByRole("spinbutton", { name: "Radius (mm)", exact: true }).fill("0.6")
  const canvas = page.getByRole("region", { name: "3D viewport" }).locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The model canvas is unavailable.")
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(panel.getByRole("button", { name: "Undo stroke", exact: true })).toBeEnabled()
  await expect(panel.getByRole("button", { name: "Apply", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await panel.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toBeVisible()
  await openApplicationMenuItem(page, "Files and projects…")
  const downloading = page.waitForEvent("download")
  await page
    .getByRole("dialog", { name: "Projects", exact: true })
    .getByRole("button", { name: "Save project (.vshape)", exact: true })
    .click()
  const path = await (await downloading).path()
  if (!path) throw new Error("Native project download must be retained.")
  const decoded = await readAuthoredVShape(new Uint8Array(await readFile(path)))
  if (!decoded.ok || decoded.value.version !== 4)
    throw new Error("Expected editable surface textures in a native V4 archive.")
  const layer = decoded.value.project.snapshot.surfaceTextures[0]
  expect(layer?.map).toEqual({ kind: "custom", width: 4, height: 4, pixels: Array(16).fill(255) })
  const dab = layer?.mask.strokes[0]
  if (!dab) throw new Error("Expected the erased brush dab to be persisted.")
  expect(dab).toMatchObject({ mode: "erase", radiusMm: 0.6 })
  expectSourceBoxDab(dab)
})

test("a hidden draft target requires a visible preview before Apply", async ({ page }) => {
  await createBox(page)
  await page.getByRole("button", { name: "Hide part Box 1", exact: true }).click()
  await invokeModelCommand(page, "Modify", "Surface texture")
  const panel = page.getByRole("complementary", { name: "Surface texture" })
  await panel.getByRole("combobox", { name: "Body", exact: true }).selectOption({ label: "Box 1" })
  await expect(panel.getByText(/Relief preview is unavailable/)).toBeVisible({ timeout: 30_000 })
  await expect(panel.getByRole("button", { name: "Apply", exact: true })).toBeDisabled()
  await panel.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toHaveCount(0)
})

function expectSourceBoxDab(dab: SurfaceTextureMask["strokes"][number]) {
  const axis = dab.normal.findIndex((value) => Math.abs(value) > 0.99)
  expect(axis).toBeGreaterThanOrEqual(0)
  // The box is centered in X/Y and starts at Z=0.
  const minimum = axis === 2 ? 0 : -5
  const maximum = axis === 2 ? 10 : 5
  expect(
    Math.min(
      Math.abs((dab.center[axis] ?? Infinity) - minimum),
      Math.abs((dab.center[axis] ?? Infinity) - maximum),
    ),
  ).toBeLessThan(0.0001)
}
