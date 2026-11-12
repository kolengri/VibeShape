import { readFile } from "node:fs/promises"
import type { Download, Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function bytesOf(download: Download) {
  const path = await download.path()
  if (!path) throw new Error("The drawing must produce an authentic file download.")
  return new Uint8Array(await readFile(path))
}

/** A default box with a centred Ø10 mm cylinder subtracted through it. */
async function createBoxWithHole(page: Page) {
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const cylinder = page.getByRole("form", { name: "Create cylinder" })
  await cylinder.getByRole("combobox", { name: "Radius" }).fill("5 mm")
  await cylinder.getByRole("combobox", { name: "Height" }).fill("200 mm")
  await cylinder.getByRole("checkbox", { name: "Center height about placement origin" }).check()
  await cylinder.getByRole("button", { name: "Create cylinder", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible()
  await invokeModelCommand(page, "Modify", "Subtract")
  const subtract = page.getByRole("form", { name: "Subtract solids" })
  await expect(subtract.getByRole("button", { name: "Subtract", exact: true })).toBeEnabled({
    timeout: 10_000,
  })
  await subtract.getByRole("button", { name: "Subtract", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible()
  await saved(page)
}

async function download(page: Page, label: string) {
  const downloading = page.waitForEvent("download", { timeout: 60_000 })
  await page
    .getByRole("dialog", { name: "Create Drawing" })
    .getByRole("button", { name: label, exact: true })
    .click()
  const file = await downloading
  return { name: file.suggestedFilename(), bytes: await bytesOf(file) }
}

test.describe("Engineering drawings", () => {
  test("previews projected views and downloads SVG, DXF and PDF sheets", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await createBoxWithHole(page)
    await openApplicationMenuItem(page, "Create Drawing…")
    const dialog = page.getByRole("dialog", { name: "Create Drawing" })
    const preview = dialog.getByTestId("drawing-preview")
    await expect(preview).toBeVisible({ timeout: 60_000 })
    const source = decodeURIComponent((await preview.getAttribute("src")) ?? "")
    for (const group of ["view-front", "view-top", "view-right", "view-isometric", "title-block"])
      expect(source).toContain(`id="${group}"`)
    expect(source).toContain('class="hidden"')
    expect(source).toContain("Ø10")
    await expect(dialog.getByTestId("drawing-scale")).toHaveText(/^Scale \d+:\d+$/)

    await dialog.getByRole("combobox", { name: "Projection", exact: true }).click()
    await page.getByRole("option", { name: "Third angle (ANSI)", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Drawing number", exact: true }).fill("VS-0001")
    await expect
      .poll(async () => decodeURIComponent((await preview.getAttribute("src")) ?? ""))
      .toContain("VS-0001")
    await dialog.screenshot({ path: test.info().outputPath("drawing-dialog.png") })

    const svg = await download(page, "Download SVG")
    expect(svg.name).toMatch(/ drawing\.svg$/)
    const svgText = new TextDecoder().decode(svg.bytes)
    expect(svgText.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svgText).toContain("Third angle")
    expect(svgText).toContain("VS-0001")

    const dxf = await download(page, "Download DXF")
    expect(dxf.name).toMatch(/ drawing\.dxf$/)
    const dxfText = new TextDecoder().decode(dxf.bytes)
    expect(dxfText).toContain("AC1009")
    expect(dxfText).toMatch(/\r\nHIDDEN\r\n/)
    expect(dxfText.trimEnd().endsWith("EOF")).toBe(true)

    const pdf = await download(page, "Download PDF")
    expect(pdf.name).toMatch(/ drawing\.pdf$/)
    const pdfText = new TextDecoder("latin1").decode(pdf.bytes)
    expect(pdfText.startsWith("%PDF-1.4")).toBe(true)
    expect(pdfText).toContain("/Count 1")
    expect(pdfText.trimEnd().endsWith("%%EOF")).toBe(true)

    await dialog.getByRole("button", { name: "Close", exact: true }).first().click()
    await expect(dialog).toBeHidden()
    await openApplicationMenuItem(page, "Create Drawing…")
    await expect(
      page.getByRole("dialog", { name: "Create Drawing" }).getByRole("textbox", {
        name: "Drawing number",
        exact: true,
      }),
    ).toHaveValue("VS-0001")
  })
})
