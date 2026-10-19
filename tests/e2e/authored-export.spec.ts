import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { unzipSync } from "fflate"
import { readVShapeV3 } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function createBox(page: Page, values: Record<string, string>) {
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  for (const [name, value] of Object.entries(values))
    await form.getByRole("combobox", { name, exact: true }).fill(value)
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(form).not.toBeVisible()
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
}
async function renamePart(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `Rename part ${from}`, exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Rename item", exact: true })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(to)
  await dialog.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(dialog).not.toBeVisible()
}
async function nativeSnapshot(page: Page) {
  await openApplicationMenuItem(page, "Files and projects…")
  const dialog = page.getByRole("dialog", { name: "Projects", exact: true })
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Save project (.vshape)", exact: true }).click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("Native archive download was not retained.")
  await expect(dialog).not.toBeVisible()
  const result = await readVShapeV3(new Uint8Array(await readFile(path)))
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
  return result.value.snapshot
}
function measureTriangles(vertices: readonly number[], indices: readonly number[]) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  vertices.forEach((value, index) => {
    const axis = (index % 3) as 0 | 1 | 2
    min[axis] = Math.min(min[axis], value)
    max[axis] = Math.max(max[axis], value)
  })
  let signedVolume = 0
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = indices.slice(index, index + 3).map((value) => value * 3) as [
      number,
      number,
      number,
    ]
    const [ax, ay, az] = vertices.slice(a, a + 3) as [number, number, number]
    const [bx, by, bz] = vertices.slice(b, b + 3) as [number, number, number]
    const [cx, cy, cz] = vertices.slice(c, c + 3) as [number, number, number]
    signedVolume +=
      (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return { min, max, volume: Math.abs(signedVolume) }
}
function readBinaryStl(bytes: Buffer) {
  const count = bytes.readUInt32LE(80)
  expect(bytes.byteLength).toBe(84 + count * 50)
  const vertices: number[] = []
  for (let triangle = 0; triangle < count; triangle++) {
    for (let value = 0; value < 9; value++)
      vertices.push(bytes.readFloatLE(84 + triangle * 50 + 12 + value * 4))
  }
  return measureTriangles(
    vertices,
    Array.from({ length: count * 3 }, (_, index) => index),
  )
}
async function downloadExport(page: Page, format: "STL" | "3MF", part?: string) {
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  if (part) {
    await dialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
    await page.getByRole("option", { name: part, exact: true }).click()
  }
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: `Export ${format}`, exact: true }).click()
  const download = await downloading
  await expect(dialog).not.toBeVisible()
  return download
}

test("exports a hidden selected part and a named positioned assembly without changing the design", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await createBox(page, {})
  await createBox(page, {
    Width: "10 mm",
    Depth: "20 mm",
    Height: "30 mm",
    "Origin X": "100 mm",
    "Origin Y": "-40 mm",
    "Origin Z": "5 mm",
  })
  await renamePart(page, "Box 1", "Housing")
  await renamePart(page, "Box 2", "Insert")
  await page.getByRole("button", { name: "Hide part Insert", exact: true }).click()
  await expect(page.getByRole("button", { name: "Show part Insert", exact: true })).toBeVisible()
  const before = await nativeSnapshot(page)
  const stl = await downloadExport(page, "STL", "Insert")
  const stlPath = testInfo.outputPath("insert.stl")
  await stl.saveAs(stlPath)
  const selected = readBinaryStl(await readFile(stlPath))
  expect(selected.volume).toBeCloseTo(6000, 5)
  // Box origins locate the center of the XY footprint; height starts at origin Z.
  expect(selected.min).toEqual([95, -50, 5])
  expect(selected.max).toEqual([105, -30, 35])
  const threeMf = await downloadExport(page, "3MF")
  const threeMfPath = testInfo.outputPath("positioned-parts.3mf")
  await threeMf.saveAs(threeMfPath)
  const model = new TextDecoder().decode(
    unzipSync(new Uint8Array(await readFile(threeMfPath)))["3D/3dmodel.model"],
  )
  const parsed = await page.evaluate((xml) => {
    type XmlNode = {
      getAttribute(name: string): string | null
      querySelector(selector: string): XmlNode | null
      querySelectorAll(selector: string): Iterable<XmlNode> & { length: number }
    }
    const browser = globalThis as unknown as {
      DOMParser: new () => { parseFromString(xml: string, type: string): XmlNode }
    }
    const document = new browser.DOMParser().parseFromString(xml, "application/xml")
    const meshes = [...document.querySelectorAll("object")].filter((object) =>
      object.querySelector("mesh"),
    )
    return {
      buildItems: document.querySelectorAll("build > item").length,
      components: document.querySelectorAll("components > component").length,
      meshes: meshes.map((object) => ({
        name: object.getAttribute("name"),
        vertices: [...object.querySelectorAll("vertex")].flatMap((vertex) =>
          ["x", "y", "z"].map((key) => Number(vertex.getAttribute(key))),
        ),
        indices: [...object.querySelectorAll("triangle")].flatMap((triangle) =>
          ["v1", "v2", "v3"].map((key) => Number(triangle.getAttribute(key))),
        ),
      })),
    }
  }, model)
  expect(parsed.buildItems).toBe(1)
  expect(parsed.components).toBe(2)
  expect(parsed.meshes.map(({ name }) => name)).toEqual(["Housing", "Insert"])
  const insert = parsed.meshes.find(({ name }) => name === "Insert")
  if (!insert) throw new Error("Named insert mesh is missing.")
  expect(measureTriangles(insert.vertices, insert.indices)).toEqual(selected)
  expect(await nativeSnapshot(page)).toEqual(before)
  const stale = await page.evaluate(async (source) => {
    const controller: { exportActiveDocument(format: string, partId: string): Promise<unknown> } =
      await import(source)
    return controller.exportActiveDocument("stl", "0195b5ac-b220-7a2c-8c33-000000000999")
  }, "/src/document/document-controller.ts")
  expect(stale).toMatchObject({ ok: false, diagnostic: { sourceCode: "stale-revision" } })
})
