import { readFile } from "node:fs/promises"
import type { Page, TestInfo } from "@playwright/test"
import { unzipSync } from "fflate"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "../e2e/application-menu-support"
import { expect, test } from "../e2e/fixtures"
import { invokeModelCommand } from "../e2e/model-command-support"

async function downloadExport(page: Page, info: TestInfo, format: "STEP" | "STL" | "3MF") {
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await dialog
    .getByRole("combobox", { name: "File format", exact: true })
    .selectOption(format.toLowerCase())
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: `Save ${format} file`, exact: true }).click()
  const download = await downloading
  const path = info.outputPath(`public-part.${format.toLowerCase()}`)
  await download.saveAs(path)
  await expect(dialog).not.toBeVisible()
  return readFile(path)
}

function verifyBoxStl(bytes: Buffer) {
  const triangles = bytes.readUInt32LE(80)
  expect(triangles).toBeGreaterThan(0)
  expect(bytes.length).toBe(84 + triangles * 50)
  const vertices = Array.from({ length: triangles * 9 }, (_, index) =>
    bytes.readFloatLE(84 + Math.floor(index / 9) * 50 + 12 + (index % 9) * 4),
  )
  const dimensions = [0, 1, 2].map((axis) => {
    const coordinates = vertices.filter((_, index) => index % 3 === axis)
    return Math.max(...coordinates) - Math.min(...coordinates)
  })
  expect(dimensions).toEqual([30, 20, 12])
}

test("the public editor loads WASM, edits, restores a native project and exports print files", async ({
  page,
  browser,
  request,
  baseURL,
}, info) => {
  if (!baseURL) throw new Error("The public editor URL is missing.")
  const manifest = await request.get("/site-manifest.json")
  expect(manifest.ok()).toBe(true)
  const identity: { sourceCommit: string } = await manifest.json()
  expect(identity.sourceCommit).toBe(process.env.VIBESHAPE_EXPECTED_COMMIT)
  expect((await request.get("/missing-public-asset.wasm")).status()).toBe(404)
  expect((await request.get("/__vibeshape/automation/status")).status()).toBe(404)
  const loadedWasm: string[] = []
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".wasm")) {
      expect(response.ok()).toBe(true)
      expect(response.headers()["content-type"]).toContain("application/wasm")
      loadedWasm.push(response.url())
    }
  })
  await page.goto("/")
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  await invokeModelCommand(page, "Primitives", "Box")
  const create = page.getByRole("form", { name: "Create box", exact: true })
  for (const [name, value] of [
    ["Width", "30 mm"],
    ["Depth", "20 mm"],
    ["Height", "10 mm"],
  ] as const)
    await create.getByRole("combobox", { name, exact: true }).fill(value)
  await create.getByRole("button", { name: "Create box", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit box", exact: true })
  await edit.getByRole("combobox", { name: "Height", exact: true }).fill("12 mm")
  await edit.getByRole("button", { name: "Update box", exact: true }).click()
  await expect(edit).not.toBeVisible()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  await page.reload()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")

  const downloading = page.waitForEvent("download")
  await openApplicationMenuItem(page, "Save project (.vshape)")
  const backup = info.outputPath("public-part.vshape")
  await (await downloading).saveAs(backup)
  const native = await readAuthoredVShape(new Uint8Array(await readFile(backup)))
  expect(native.ok).toBe(true)

  const recoveredContext = await browser.newContext({ baseURL })
  const recovered = await recoveredContext.newPage()
  const errors: string[] = []
  recovered.on("pageerror", (error) => errors.push(error.message))
  recovered.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  try {
    await recovered.goto("/")
    await recovered.getByLabel("Choose VibeShape project file").setInputFiles(backup)
    await expect(recovered.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await recovered.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    const restored = recovered.getByRole("form", { name: "Edit box", exact: true })
    await expect(restored.getByRole("combobox", { name: "Height", exact: true })).toHaveValue(
      "12 mm",
    )
    await restored.getByRole("button", { name: "Cancel", exact: true }).click()
    const step = (await downloadExport(recovered, info, "STEP")).toString("utf8")
    expect(step).toContain("ISO-10303-21;")
    expect(step).toContain("MANIFOLD_SOLID_BREP")
    expect(step).toContain("END-ISO-10303-21;")
    verifyBoxStl(await downloadExport(recovered, info, "STL"))
    const archive = unzipSync(new Uint8Array(await downloadExport(recovered, info, "3MF")))
    const model = new TextDecoder().decode(archive["3D/3dmodel.model"])
    expect(model).toContain('unit="millimeter"')
    expect(model).toContain("<triangle ")
    expect(model).toContain("<item ")
    await openApplicationMenuItem(recovered, "Settings…")
    await recovered.getByRole("tab", { name: "About VibeShape", exact: true }).click()
    await expect(
      recovered.getByRole("link", { name: /Licenses and corresponding source/ }),
    ).toHaveAttribute("href", "/sources/index.html")
    expect((await request.get("/sources/index.html")).ok()).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await recoveredContext.close()
  }
  expect(loadedWasm.length).toBeGreaterThanOrEqual(2)
})
