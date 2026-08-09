import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import { expect, test } from "./fixtures"

test.describe("document export", () => {
  test("downloads 3MF, exact STEP, and binary STL from rebuilt terminal bodies", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Export…" }).click()
    const dialog = page.getByRole("dialog", { name: "Export model" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Create a valid solid body before exporting.")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Export STEP" })).toBeDisabled()
    await dialog.getByRole("button", { name: "Close", exact: true }).click()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await toolbar.getByRole("button", { name: "Cylinder", exact: true }).click()
    await page
      .getByRole("form", { name: "Create cylinder" })
      .getByRole("button", { name: "Create cylinder" })
      .click()
    await expect(page.getByRole("treeitem", { name: "Cylinder 1" })).toBeVisible()

    await page.getByRole("button", { name: "Export…" }).click()
    const threeMfDownloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Export 3MF" }).click()
    const threeMfDownload = await threeMfDownloadPromise
    expect(threeMfDownload.suggestedFilename()).toBe("Untitled project.3mf")
    const threeMfPath = await threeMfDownload.path()
    if (!threeMfPath) throw new Error("Playwright did not retain the 3MF download.")
    const threeMfArchive = unzipSync(new Uint8Array(await readFile(threeMfPath)))
    const model = new TextDecoder().decode(threeMfArchive["3D/3dmodel.model"])
    expect(model).toContain('<model unit="millimeter"')
    expect(model.match(/<object /g)).toHaveLength(2)
    await expect(page.getByText("3MF download started", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Export…" }).click()
    const stepDownloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Export STEP" }).click()
    const stepDownload = await stepDownloadPromise
    expect(stepDownload.suggestedFilename()).toBe("Untitled project.step")
    const stepPath = await stepDownload.path()
    if (!stepPath) throw new Error("Playwright did not retain the STEP download.")
    const stepBytes = await readFile(stepPath)
    expect(stepBytes.subarray(0, 13).toString("ascii")).toBe("ISO-10303-21;")
    await expect(page.getByText("STEP download started", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Export…" }).click()
    const stlDownloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Export STL" }).click()
    const stlDownload = await stlDownloadPromise
    expect(stlDownload.suggestedFilename()).toBe("Untitled project.stl")
    const stlPath = await stlDownload.path()
    if (!stlPath) throw new Error("Playwright did not retain the STL download.")
    const stlBytes = await readFile(stlPath)
    const triangleCount = stlBytes.readUInt32LE(80)
    expect(triangleCount).toBeGreaterThan(0)
    expect(stlBytes.byteLength).toBe(84 + triangleCount * 50)
    await expect(page.getByText("STL download started", { exact: true })).toBeVisible()
  })
})
