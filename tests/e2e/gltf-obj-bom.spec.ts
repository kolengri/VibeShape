import { readFile } from "node:fs/promises"
import type { Download, Locator, Page } from "@playwright/test"
import { strFromU8, unzipSync } from "fflate"
import { DEFAULT_IMPORT_LIMITS } from "../../packages/formats/src/import/contracts"
import { parseStlGeometry } from "../../packages/formats/src/import/stl"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

type GlbJson = {
  nodes: { name: string; mesh: number }[]
  meshes: { primitives: { attributes: { POSITION: number }; material: number }[] }[]
  accessors: { min?: number[]; max?: number[]; count: number }[]
  materials: unknown[]
}

async function downloadBytes(download: Promise<Download>) {
  const path = await (await download).path()
  if (!path) throw new Error("The export must produce an authentic file download.")
  return new Uint8Array(await readFile(path))
}

function parseGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x46546c67)
  expect(view.getUint32(4, true)).toBe(2)
  expect(view.getUint32(8, true)).toBe(bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  expect(jsonLength % 4).toBe(0)
  return JSON.parse(strFromU8(bytes.subarray(20, 20 + jsonLength))) as GlbJson
}

function positionBounds(json: GlbJson, meshIndex: number) {
  const accessor = json.accessors[json.meshes[meshIndex]?.primitives[0]?.attributes.POSITION ?? -1]
  if (!accessor?.min || !accessor.max) throw new Error("Missing glTF position bounds.")
  return { min: accessor.min, max: accessor.max }
}

async function exportModel(page: Page, format: "stl" | "glb" | "obj") {
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model" })
  await dialog.getByRole("combobox", { name: "File format" }).selectOption(format)
  const downloading = page.waitForEvent("download", { timeout: 60_000 })
  await dialog
    .getByRole("button", { name: `Save ${format.toUpperCase()} file`, exact: true })
    .click()
  const download = await downloading
  return {
    name: download.suggestedFilename(),
    bytes: await downloadBytes(Promise.resolve(download)),
  }
}

const assemblyPanel = (page: Page) =>
  page.getByRole("region", { name: "Assembly task", exact: true })
async function applyAssemblyTask(page: Page) {
  await assemblyPanel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await saved(page)
  await expect(
    assemblyPanel(page).getByText("Inspecting frozen assembly geometry…", { exact: true }),
  ).toHaveCount(0, { timeout: 60_000 })
}
async function createTwoInstanceAssembly(page: Page) {
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  const actions = page.getByRole("toolbar", { name: "Assembly actions", exact: true })
  await actions.getByRole("button", { name: "Create definition", exact: true }).click()
  await assemblyPanel(page)
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Bracket, left")
  await applyAssemblyTask(page)
  await actions.getByRole("button", { name: "Add instance", exact: true }).click()
  await assemblyPanel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Moved")
  await assemblyPanel(page).getByRole("spinbutton", { name: "X (mm)", exact: true }).fill("40")
  await applyAssemblyTask(page)
}
async function exportAssembly(page: Page, dialog: Locator, format: "glb" | "obj") {
  await dialog.getByRole("combobox", { name: "File format" }).selectOption(format)
  const downloading = page.waitForEvent("download", { timeout: 60_000 })
  await dialog
    .getByRole("button", { name: `Save ${format.toUpperCase()} file`, exact: true })
    .click()
  return downloadBytes(downloading)
}

test("exports a model as GLB in meters with Y up and as an OBJ archive with materials", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()

  const stl = parseStlGeometry(
    Buffer.from((await exportModel(page, "stl")).bytes),
    "mm",
    DEFAULT_IMPORT_LIMITS,
  )
  if (stl.kind !== "triangle-mesh") throw new Error("Expected an STL mesh.")
  const vertices = stl.meshes.flatMap((mesh) => mesh.vertices)
  const mm = [0, 1, 2].map((axis) => ({
    min: Math.min(...vertices.map((vertex) => vertex[axis] ?? Number.NaN)),
    max: Math.max(...vertices.map((vertex) => vertex[axis] ?? Number.NaN)),
  }))

  const glb = await exportModel(page, "glb")
  expect(glb.name).toBe("Untitled project.glb")
  const json = parseGlb(glb.bytes)
  expect(json.nodes).toEqual([{ name: "Box 1", mesh: 0 }])
  expect(json.materials).toHaveLength(1)
  const bounds = positionBounds(json, 0)
  const [x, y, z] = mm as [(typeof mm)[0], (typeof mm)[0], (typeof mm)[0]]
  expect(bounds.min[0]).toBeCloseTo(x.min * 0.001, 6)
  expect(bounds.max[0]).toBeCloseTo(x.max * 0.001, 6)
  expect(bounds.min[1]).toBeCloseTo(z.min * 0.001, 6)
  expect(bounds.max[1]).toBeCloseTo(z.max * 0.001, 6)
  expect(bounds.min[2]).toBeCloseTo(-y.max * 0.001, 6)
  expect(bounds.max[2]).toBeCloseTo(-y.min * 0.001, 6)

  const obj = await exportModel(page, "obj")
  expect(obj.name).toBe("Untitled project.zip")
  const archive = unzipSync(obj.bytes)
  const text = strFromU8(archive["model.obj"] as Uint8Array)
  expect(text.match(/^o .+$/gm)).toEqual(["o Box 1"])
  expect(text).toContain("mtllib model.mtl")
  expect(text.match(/^usemtl material_1$/gm)).toHaveLength(1)
  expect(strFromU8(archive["model.mtl"] as Uint8Array)).toContain("newmtl material_1")
})

test("lists assembly BOM quantities, refuses unknown mass, exports CSV and placed GLB/OBJ", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await saved(page)
  await createTwoInstanceAssembly(page)

  await page.getByRole("button", { name: "Show bill of materials", exact: true }).click()
  const bom = page.getByRole("dialog", { name: "Bill of materials", exact: true })
  const table = bom.getByRole("table", { name: "Assembly bill of materials" })
  const row = table.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "Bracket, left", exact: true }),
  })
  await expect(row.getByRole("cell").nth(1)).toHaveText("2")
  await expect(row.getByRole("cell").nth(4)).toHaveText("—")
  const material = row.getByRole("combobox", { name: "Material for Bracket, left" })
  await material.focus()
  await material.selectOption("pla")
  await expect(row.getByRole("cell").nth(4)).toHaveText(/^\d+(\.\d+)? g$/)
  const csvDownload = page.waitForEvent("download")
  await bom.getByRole("button", { name: "Download CSV", exact: true }).click()
  const csvBytes = await downloadBytes(csvDownload)
  expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const records = strFromU8(csvBytes.subarray(3)).split("\r\n")
  expect(records[0]).toBe(
    "Item,Part,Qty,Appearance,Material,Density (kg/m³),Unit volume (mm³),Unit mass (g),Total mass (g)",
  )
  expect(records[1]).toMatch(
    /^1,"Bracket, left",2,,PLA — Prusament,1240,\d+(\.\d+)?,[\d.]+,[\d.]+$/,
  )
  await bom.getByRole("button", { name: "Close", exact: true }).first().click()

  await page
    .getByRole("toolbar", { name: "Assembly actions", exact: true })
    .getByRole("button", { name: "Export assembly…", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "Export assembly…", exact: true })
  const json = parseGlb(await exportAssembly(page, dialog, "glb"))
  expect(json.nodes.map(({ name }) => name)).toEqual(["Bracket, left instance", "Moved"])
  const first = positionBounds(json, 0)
  const second = positionBounds(json, 1)
  expect((second.min[0] ?? 0) - (first.min[0] ?? 0)).toBeCloseTo(0.04, 6)
  const objText = strFromU8(
    unzipSync(await exportAssembly(page, dialog, "obj"))["model.obj"] as Uint8Array,
  )
  expect(objText.match(/^o .+$/gm)).toEqual(["o Bracket, left instance", "o Moved"])
})
