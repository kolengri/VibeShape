import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function createBox(page: import("@playwright/test").Page) {
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
}

async function reviewExportLayout(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog", { name: "Export model" })
  await page.emulateMedia({ reducedMotion: "reduce" })
  for (const { width, dark } of [
    { width: 1024, dark: false },
    { width: 1024, dark: true },
    { width: 512, dark: true },
    { width: 390, dark: false },
  ]) {
    await page.setViewportSize({ width, height: 768 })
    await page
      .locator("html")
      .evaluate((element, active) => element.classList.toggle("dark", active), dark)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    )
    await expect(dialog.getByRole("combobox", { name: "Destination" })).toBeVisible()
    const save = dialog.getByRole("button", { name: "Save 3MF file" })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath(`export-${width}-${dark ? "dark" : "light"}.png`),
      animations: "disabled",
    })
  }
  await page.setViewportSize({ width: 1024, height: 768 })
}

test.describe("document export", () => {
  test("remembers the last format and mesh quality after export and reload", async ({ page }) => {
    await page.goto("/")
    await createBox(page)
    await openApplicationMenuItem(page, "Export geometry…")
    const dialog = page.getByRole("dialog", { name: "Export model" })
    await dialog.getByRole("combobox", { name: "File format" }).selectOption("stl")
    await dialog.getByRole("combobox", { name: "Mesh quality" }).click()
    await page.getByRole("option", { name: "Fine", exact: true }).click()
    const downloaded = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Save STL file", exact: true }).click()
    expect((await downloaded).suggestedFilename()).toBe("Untitled project.stl")
    await expect(dialog).toHaveCount(0)
    await openApplicationMenuItem(page, "Export geometry…")
    await expect(dialog.getByRole("combobox", { name: "File format" })).toHaveValue("stl")
    await expect(dialog.getByRole("combobox", { name: "Mesh quality" })).toHaveText("Fine")
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await page.reload()
    await openApplicationMenuItem(page, "Export geometry…")
    await expect(dialog.getByRole("combobox", { name: "File format" })).toHaveValue("stl")
    await expect(dialog.getByRole("combobox", { name: "Mesh quality" })).toHaveText("Fine")
  })

  test("downloads 3MF, exact STEP, and binary STL from rebuilt terminal bodies", async ({
    page,
  }) => {
    await page.goto("/")
    await openApplicationMenuItem(page, "Export geometry…")
    const dialog = page.getByRole("dialog", { name: "Export model" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Create a valid solid body before exporting.")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Save 3MF file" })).toBeDisabled()
    await dialog.getByRole("button", { name: "Close", exact: true }).click()

    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
    await invokeModelCommand(page, "Primitives", "Cylinder")
    await page
      .getByRole("form", { name: "Create cylinder" })
      .getByRole("button", { name: "Create cylinder", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true })).toBeVisible()

    await openApplicationMenuItem(page, "Export geometry…")
    await reviewExportLayout(page)
    const threeMfDownloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Save 3MF file" }).click()
    const threeMfDownload = await threeMfDownloadPromise
    expect(threeMfDownload.suggestedFilename()).toBe("Untitled project.3mf")
    const threeMfPath = await threeMfDownload.path()
    if (!threeMfPath) throw new Error("Playwright did not retain the 3MF download.")
    const threeMfArchive = unzipSync(new Uint8Array(await readFile(threeMfPath)))
    const model = new TextDecoder().decode(threeMfArchive["3D/3dmodel.model"])
    expect(model).toContain('<model unit="millimeter"')
    expect(model.match(/<mesh>/g)).toHaveLength(2)
    expect(model.match(/<components>/g)).toHaveLength(1)
    expect(model.match(/<item objectid=/g)).toHaveLength(1)
    await expect(page.getByText("3MF download started", { exact: true })).toBeVisible()

    await openApplicationMenuItem(page, "Export geometry…")
    const stepDownloadPromise = page.waitForEvent("download")
    await dialog.getByRole("combobox", { name: "File format" }).selectOption("step")
    await expect(dialog.getByRole("combobox", { name: "Mesh quality" })).toHaveCount(0)
    await dialog.getByRole("button", { name: "Save STEP file" }).click()
    const stepDownload = await stepDownloadPromise
    expect(stepDownload.suggestedFilename()).toBe("Untitled project.step")
    const stepPath = await stepDownload.path()
    if (!stepPath) throw new Error("Playwright did not retain the STEP download.")
    const stepBytes = await readFile(stepPath)
    expect(stepBytes.subarray(0, 13).toString("ascii")).toBe("ISO-10303-21;")
    await expect(page.getByText("STEP download started", { exact: true })).toBeVisible()

    await openApplicationMenuItem(page, "Export geometry…")
    const stlDownloadPromise = page.waitForEvent("download")
    await dialog.getByRole("combobox", { name: "File format" }).selectOption("stl")
    await dialog.getByRole("button", { name: "Save STL file" }).click()
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

  test("explains desktop-only handoff and keeps browser file download explicit", async ({
    page,
  }) => {
    const bridgeRequests: string[] = []
    page.on("request", (request) => {
      if (request.url().startsWith("http://127.0.0.1:43113/")) bridgeRequests.push(request.url())
    })
    await page.goto("/")
    await createBox(page)
    await openApplicationMenuItem(page, "Export geometry…")
    const dialog = page.getByRole("dialog", { name: "Export model" })
    await dialog.getByRole("combobox", { name: "Destination" }).selectOption("slicer")
    await expect(dialog.getByText(/Direct handoff is available in the desktop app/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Open in slicer", exact: true })).toBeDisabled()
    await expect(dialog.getByRole("button", { name: "Choose slicer application…" })).toHaveCount(0)
    await dialog.getByRole("combobox", { name: "Destination" }).selectOption("file")
    const downloading = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Save 3MF file" }).click()
    expect((await downloading).suggestedFilename()).toBe("Untitled project.3mf")
    expect(bridgeRequests).toEqual([])
  })

  test("hands an authentic mesh to an isolated desktop host and remembers its selected target and format", async ({
    page,
  }) => {
    await page.addInitScript({
      content: `(() => {
      window.__exportTestHandoffs = [];
      window.vibeshapeSlicer = {
        protocolVersion: 1,
        listApplications: async () => ({ ok: true, targets: [
          { id: "orca-slicer", name: "OrcaSlicer" },
          { id: "custom-00000000-0000-4000-8000-000000000002", name: "Custom Slicer" }
        ] }),
        chooseApplication: async () => ({ ok: true, target: { id: "custom-00000000-0000-4000-8000-000000000002", name: "Custom Slicer" } }),
        send: async (request) => {
          window.__exportTestHandoffs.push({ slicerId: request.slicerId, format: request.format,
            filename: request.filename, bytes: request.file.byteLength, prefix: Array.from(request.file.slice(0, 4)) });
          return { ok: true, fileId: "00000000-0000-4000-8000-000000000001", slicerName: "Custom Slicer" };
        },
        reveal: async () => true
      };
    })();`,
    })
    let downloads = 0
    page.on("download", () => {
      downloads += 1
    })
    await page.goto("/")
    await createBox(page)
    const longName =
      "Lid - continuous half-round ribs without spherical bulges and with a reinforced mounting rim"
    await page.getByRole("button", { name: "Rename part Box 1", exact: true }).click()
    const rename = page.getByRole("dialog", { name: "Rename item", exact: true })
    await rename.getByRole("textbox", { name: "Name", exact: true }).fill(longName)
    await rename.getByRole("button", { name: "Rename", exact: true }).click()
    await expect(rename).toBeHidden()
    await openApplicationMenuItem(page, "Export geometry…")
    const dialog = page.getByRole("dialog", { name: "Export model" })
    await dialog.getByRole("combobox", { name: "Destination" }).selectOption("slicer")
    const scope = dialog.getByRole("combobox", { name: "Export scope", exact: true })
    await scope.click()
    await page.getByRole("option", { name: longName, exact: true }).click()
    for (const width of [1024, 512]) {
      await page.setViewportSize({ width, height: 768 })
      await expect(scope).toContainText(longName)
      expect((await scope.boundingBox())?.height).toBe(32)
      expect(
        await scope
          .locator("span")
          .first()
          .evaluate((element) => {
            const style = element.ownerDocument.defaultView?.getComputedStyle(element)
            return { whiteSpace: style?.whiteSpace, textOverflow: style?.textOverflow }
          }),
      ).toEqual({ whiteSpace: "nowrap", textOverflow: "ellipsis" })
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      )
      const choose = dialog.getByRole("button", { name: "Choose slicer application…", exact: true })
      await expect(choose).toHaveText("")
      const select = await dialog
        .getByRole("combobox", { name: "Slicer", exact: true })
        .boundingBox()
      const action = await choose.boundingBox()
      if (!select || !action) throw new Error("Slicer controls must be measurable")
      expect(select.y).toBe(action.y)
      expect(select.x + select.width).toBeLessThanOrEqual(action.x)
      await page.screenshot({
        path: test.info().outputPath(`native-export-long-scope-${width}.png`),
      })
    }
    await scope.click()
    await page.getByRole("option", { name: "All parts", exact: true }).click()
    await dialog.getByRole("button", { name: "Choose slicer application…" }).click()
    await expect(dialog.getByRole("combobox", { name: "Slicer", exact: true })).toHaveValue(
      "custom-00000000-0000-4000-8000-000000000002",
    )
    await dialog.getByRole("button", { name: "Open in slicer", exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByText("Sent to Custom Slicer. Verify the imported model in the slicer.", {
        exact: true,
      }),
    ).toBeVisible()
    const handoffs = await page.evaluate<
      { slicerId: string; format: string; filename: string; bytes: number; prefix: number[] }[]
    >("window.__exportTestHandoffs")
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]).toEqual({
      slicerId: "custom-00000000-0000-4000-8000-000000000002",
      format: "3mf",
      filename: "Untitled project.3mf",
      bytes: expect.any(Number),
      prefix: [80, 75, 3, 4],
    })
    expect(handoffs[0]?.bytes).toBeGreaterThan(100)
    expect(downloads).toBe(0)
    await openApplicationMenuItem(page, "Export geometry…")
    await dialog.getByRole("combobox", { name: "Destination" }).selectOption("slicer")
    await dialog.getByRole("combobox", { name: "File format" }).selectOption("stl")
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await page.reload()
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await openApplicationMenuItem(page, "Export geometry…")
    await dialog.getByRole("combobox", { name: "Destination" }).selectOption("slicer")
    await expect(dialog.getByRole("combobox", { name: "Slicer", exact: true })).toHaveValue(
      "custom-00000000-0000-4000-8000-000000000002",
    )
    await expect(dialog.getByRole("combobox", { name: "File format" })).toHaveValue("stl")
  })
})
