import { createHash } from "node:crypto"
import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { exportGeometry, requireSourceSnapshot } from "./source-import-ui-support"

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><path id="outline" d="M 2 3 L 22 3 L 22 13 L 2 13 Z"/></svg>'
const dxf =
  "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nCUT\n90\n4\n70\n1\n10\n2\n20\n3\n10\n22\n20\n3\n10\n22\n20\n13\n10\n2\n20\n13\n0\nENDSEC\n0\nEOF\n"
type SavedProject = Awaited<ReturnType<typeof saveProject>>
type ImportedSketch = ReturnType<typeof requireImportedSketch>

function expectSourceBytes(project: SavedProject, digest: string, text: string) {
  if (!("assetBlobs" in project.project))
    throw new Error("Native Save must retain current and historical planar source bytes.")
  expect(project.project.assetBlobs.find((blob) => blob.digest === digest)?.bytes).toEqual(
    new Uint8Array(Buffer.from(text)),
  )
}

function requireImportedSketch(project: SavedProject, format: "svg" | "dxf") {
  const snapshot = requireSourceSnapshot(project.project.snapshot)
  const sketch = snapshot.sketches.find(({ label }) => label === `Imported outline.${format}`)
  if (!sketch?.sourceImport)
    throw new Error("The ordinary sketch must retain captured source provenance.")
  return sketch
}

function expectImportedGeometry(
  imported: SavedProject,
  before: SavedProject,
  sketch: ImportedSketch,
  format: "svg" | "dxf",
  text: string,
) {
  const snapshot = requireSourceSnapshot(imported.project.snapshot)
  const asset = snapshot.assets.find(({ id }) => id === sketch.sourceImport?.assetId)
  expect(asset).toMatchObject({
    format,
    representation: "sketch-curves",
    digest: createHash("sha256").update(text).digest("hex"),
    byteLength: Buffer.byteLength(text),
    normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1 },
  })
  expect(sketch.sourceImport?.paths.map(({ outputId }) => outputId)).toEqual(asset?.outputs)
  expectSourceBytes(imported, createHash("sha256").update(text).digest("hex"), text)
  expect(sketch.entities.filter(({ type }) => type === "line")).toHaveLength(4)
  expect(sketch.entities.filter(({ type }) => type === "point")).toHaveLength(4)
  expect(snapshot.features).toEqual(before.project.snapshot.features)
  expect(snapshot.parts).toEqual(before.project.snapshot.parts)
}

function expectSourceIdentity(project: SavedProject, sketch: ImportedSketch) {
  expect(
    project.project.snapshot.sketches.find(({ id }) => id === sketch.id)?.sourceImport,
  ).toEqual(sketch.sourceImport)
}

async function choose(page: Page, format: "svg" | "dxf", text: string) {
  await openApplicationMenuItem(page, "Import sketch…")
  const dialog = page.getByRole("dialog", { name: "Import sketch curves", exact: true })
  await dialog.getByLabel("Sketch source file", { exact: true }).setInputFiles({
    name: `outline.${format}`,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(text),
  })
  if (format === "svg") {
    await dialog.getByRole("combobox", { name: "Source length unit", exact: true }).click()
    await page.getByRole("option", { name: "Millimeter (mm)", exact: true }).click()
  }
  await dialog.getByRole("button", { name: "Inspect sketch source", exact: true }).click()
  await expect(
    dialog.getByRole("button", { name: "Apply sketch import", exact: true }),
  ).toBeEnabled({ timeout: 30000 })
  await expect(
    dialog.getByRole("img", { name: "Imported sketch curve preview", exact: true }),
  ).toBeVisible()
  await expect(dialog.getByText("1 path · 1 closed · 4 curves", { exact: true })).toBeVisible()
  return dialog
}

async function editOrdinaryPoint(page: Page, sketch: ImportedSketch) {
  const drawing = page.getByRole("img", { name: "Editable sketch geometry", exact: true })
  await expect(drawing).toBeVisible()
  const pointId = sketch.sourceImport?.paths[0]?.pointIds[0]
  if (!pointId) throw new Error("The imported outline must capture an ordinary point identity.")
  const point = drawing.locator(
    `[data-sketch-entity-type="point"][data-sketch-entity-id="${pointId}"]`,
  )
  const before = await point.getAttribute("cx")
  const target = await point.boundingBox()
  if (!target) throw new Error("The ordinary imported point must have a pointer target.")
  await page.keyboard.down("Shift")
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2)
  await page.mouse.down()
  await expect(drawing).toHaveAttribute("data-sketch-dragging-point-id", pointId)
  await page.mouse.move(target.x + target.width / 2 + 8, target.y + target.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect(point).not.toHaveAttribute("cx", before ?? "")
}

async function editAndExtrude(page: Page, sketch: ImportedSketch) {
  await page.getByRole("treeitem", { name: sketch.label, exact: true }).click()
  await editOrdinaryPoint(page, sketch)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  const finished = await saveProject(page)
  expectSourceIdentity(finished, sketch)
  const edited = finished.project.snapshot.sketches.find(({ id }) => id === sketch.id)
  expect(edited?.entities).not.toEqual(sketch.entities)
  expect(edited?.entities.map(({ id }) => id)).toEqual(sketch.entities.map(({ id }) => id))
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1", {
    timeout: 60000,
  })
  await viewport
    .getByRole("combobox", { name: "Select saved profile", exact: true })
    .selectOption({ label: `${sketch.label} · Profile 1` })
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Extrude", exact: true })
    .click()
  const extrusion = page.getByRole("form", { name: "Extrude profile", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 60000 })
  await extrusion.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", { timeout: 60000 })
  expect((await exportGeometry(page, "STEP")).toString("utf8")).toContain("ISO-10303-21")
  expectSourceIdentity(await saveProject(page), sketch)
}

for (const format of ["svg", "dxf"] as const) {
  test(`imports exact ${format.toUpperCase()} sketch curves atomically, restores source identity and extrudes after native reopen`, async ({
    page,
  }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/")
    await saved(page)
    const before = await saveProject(page)
    const text = format === "svg" ? svg : dxf
    let dialog = await choose(page, format, text)
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    const canceled = await saveProject(page)
    expect(canceled.project.snapshot).toEqual(before.project.snapshot)
    dialog = await choose(page, format, text)
    await dialog.getByRole("button", { name: "Apply sketch import", exact: true }).dblclick()
    await expect(dialog).not.toBeVisible({ timeout: 30000 })
    await saved(page)
    const imported = await saveProject(page)
    const sketch = requireImportedSketch(imported, format)
    expectImportedGeometry(imported, before, sketch, format, text)
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await saved(page)
    const undone = await saveProject(page)
    expect(undone.project.snapshot.sketches).toEqual(before.project.snapshot.sketches)
    expectSourceBytes(undone, createHash("sha256").update(text).digest("hex"), text)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await saved(page)
    await page.reload()
    await saved(page)
    const reloaded = await saveProject(page)
    expect(reloaded.project.snapshot.sketches).toEqual(imported.project.snapshot.sketches)
    await openProject(page, reloaded)
    await editAndExtrude(page, sketch)
  })
}
