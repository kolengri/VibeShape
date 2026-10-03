import { readFile } from "node:fs/promises"
import type { Locator, Page } from "@playwright/test"
import {
  DEFAULT_IMPORT_LIMITS,
  type ParsedGeometryImport,
} from "../../packages/formats/src/import/contracts"
import { parseStlGeometry } from "../../packages/formats/src/import/stl"
import { parseThreeMfGeometry } from "../../packages/formats/src/import/three-mf"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

const panel = (page: Page) => page.getByRole("region", { name: "Assembly task", exact: true })
async function apply(page: Page) {
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await saved(page)
  await expect(
    panel(page).getByText("Inspecting frozen assembly geometry…", { exact: true }),
  ).toHaveCount(0, { timeout: 60_000 })
}
async function choose(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole("combobox", { name: "Instances to export" }).click()
  await page.getByRole("option", { name, exact: true }).click()
}
async function downloadFile(page: Page, dialog: Locator, name: string) {
  const downloading = page.waitForEvent("download", { timeout: 60_000 })
  await dialog.getByRole("button", { name, exact: true }).click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("The assembly export must produce an authentic file download.")
  return readFile(path)
}
function meshBounds(parsed: ParsedGeometryImport) {
  if (parsed.kind !== "triangle-mesh")
    throw new Error("An assembly STL/3MF must contain triangle meshes.")
  const vertices = parsed.meshes.flatMap(({ vertices }) => vertices)
  return {
    min: [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis] ?? Number.NaN))),
    max: [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis] ?? Number.NaN))),
    count: parsed.meshes.length,
  }
}
async function configurePrinter(page: Page) {
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByLabel("Bed width X (mm)").fill("10")
  await settings.getByLabel("Bed depth Y (mm)").fill("10")
  await settings.getByLabel("Maximum print height Z (mm)").fill("100")
  await settings.getByRole("button", { name: "Apply printer profile" }).click()
  await settings.getByRole("button", { name: "Done", exact: true }).click()
}
async function createAssembly(page: Page) {
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await panel(page).getByRole("button", { name: "Create definition", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Export bracket")
  await apply(page)
  await panel(page).getByRole("button", { name: "Add instance", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Translated bracket")
  await panel(page).getByRole("spinbutton", { name: "X (mm)", exact: true }).fill("40")
  await apply(page)
}
async function reviewPrintLayout(page: Page, dialog: Locator) {
  for (const dark of [true, false]) {
    await page
      .locator("html")
      .evaluate((element, active) => element.classList.toggle("dark", active), dark)
    await dialog.getByRole("button", { name: "Fit preview", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath(`assembly-print-${dark ? "dark" : "light"}.png`),
      animations: "disabled",
    })
  }
  // Matches the effective layout viewport of a 1024px window at 200% browser zoom.
  await page.setViewportSize({ width: 512, height: 384 })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const download = dialog.getByRole("button", { name: "Download prepared 3MF" })
  await download.scrollIntoViewIfNeeded()
  await expect(download).toBeInViewport()
  await page.screenshot({
    path: test.info().outputPath("assembly-print-compact.png"),
    animations: "disabled",
  })
  await page.setViewportSize({ width: 1024, height: 768 })
}
async function reviewPrint(page: Page, dialog: Locator, original: ReturnType<typeof meshBounds>) {
  await dialog.getByRole("button", { name: "Prepare assembly for printing", exact: true }).click()
  await expect(dialog.getByText(/Relative instance poses are preserved/)).toBeVisible()
  await dialog.getByLabel("Tilt around X (degrees)").fill("0")
  await dialog.getByLabel("Generate experimental breakaway fins").uncheck()
  await dialog.getByRole("button", { name: "Generate print preview" }).click()
  await expect(dialog.getByText(/2 bodies · 0 fins/)).toBeVisible({ timeout: 60_000 })
  await expect(
    dialog.getByText("Outside the build volume in this orientation", { exact: true }),
  ).toBeVisible()
  await expect(dialog.getByText(/X upper boundary: exceeds by/)).toBeVisible()
  await dialog.getByRole("button", { name: "Fit preview", exact: true }).click()
  await reviewPrintLayout(page, dialog)
  const prepared = meshBounds(
    await parseThreeMfGeometry(
      await downloadFile(page, dialog, "Download prepared 3MF"),
      DEFAULT_IMPORT_LIMITS,
    ),
  )
  expect(prepared.count).toBe(2)
  expect((prepared.min[0] ?? 0) + (prepared.max[0] ?? 0)).toBeCloseTo(0, 7)
  expect(prepared.min[2]).toBeCloseTo(0, 7)
  expect((prepared.max[0] ?? 0) - (prepared.min[0] ?? 0)).toBeCloseTo(
    (original.max[0] ?? 0) - (original.min[0] ?? 0),
    7,
  )
  await dialog.getByLabel("Rotate on bed around Z (degrees)").fill("90")
  await expect(dialog.getByRole("button", { name: "Download prepared 3MF" })).not.toBeVisible()
}

test("exports selected and all frozen assembly poses to STEP/STL/3MF and reviews a derived print copy without changing authority", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  await configurePrinter(page)
  await createAssembly(page)
  const assemblyViewport = page.getByRole("region", { name: "Assembly geometry", exact: true })
  await expect(
    assemblyViewport.getByText("Custom printer: 10 × 10 × 100 mm", { exact: true }),
  ).toBeVisible()
  await expect(
    assemblyViewport.getByText("Outside the build volume in this orientation", { exact: true }),
  ).toBeVisible()
  await expect(assemblyViewport.getByText(/X upper boundary: exceeds by/)).toBeVisible()
  const before = await saveProject(page)
  await expect(page.getByRole("button", { name: "Export…", exact: true })).toHaveCount(0)
  await panel(page).getByRole("button", { name: "Export assembly…", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Export assembly…", exact: true })
  await choose(page, dialog, "Export bracket instance")
  const single = meshBounds(
    await parseThreeMfGeometry(
      await downloadFile(page, dialog, "Download 3MF"),
      DEFAULT_IMPORT_LIMITS,
    ),
  )
  expect(single.count).toBe(1)
  await choose(page, dialog, "All assembly instances")
  const all = meshBounds(
    await parseThreeMfGeometry(
      await downloadFile(page, dialog, "Download 3MF"),
      DEFAULT_IMPORT_LIMITS,
    ),
  )
  expect(all.count).toBe(2)
  expect(all.min[0]).toBeCloseTo(single.min[0] ?? Number.NaN, 7)
  expect(all.max[0]).toBeCloseTo((single.max[0] ?? 0) + 40, 7)
  const stl = meshBounds(
    parseStlGeometry(await downloadFile(page, dialog, "Download STL"), "mm", DEFAULT_IMPORT_LIMITS),
  )
  expect(stl.min).toEqual(all.min)
  expect(stl.max).toEqual(all.max)
  const step = (await downloadFile(page, dialog, "Download STEP")).toString("utf8")
  expect(step).toContain("ISO-10303-21")
  expect(step.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(2)
  await reviewPrint(page, dialog, all)
  await dialog.getByRole("button", { name: "Close export", exact: true }).click()
  const after = await saveProject(page)
  expect(after.project.snapshot).toEqual(before.project.snapshot)
})
