import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import { expect, test } from "./fixtures"

async function createBox(page: import("@playwright/test").Page) {
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Box", exact: true }).click()
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box" })
    .click()
  await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
}

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

  test("downloads a 3MF fallback and remembers the preferred slicer", async ({ page }) => {
    await page.goto("/")
    await createBox(page)

    await page.getByRole("button", { name: "Export…" }).click()
    const dialog = page.getByRole("dialog", { name: "Export model" })
    const slicer = dialog.getByLabel("Preferred slicer")
    await slicer.selectOption("bambu-studio")

    const downloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Open in Bambu Studio" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("Untitled project.3mf")
    await expect(
      dialog.getByText(
        "The desktop bridge is not connected. The 3MF was downloaded for Bambu Studio instead.",
      ),
    ).toBeVisible()

    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await page.reload()
    await page.getByRole("button", { name: "Export…" }).click()
    await expect(
      page.getByRole("dialog", { name: "Export model" }).getByLabel("Preferred slicer"),
    ).toHaveValue("bambu-studio")
  })

  test("sends one authenticated 3MF to the paired local bridge", async ({ page }) => {
    const bridgeToken = "a".repeat(43)
    await page.addInitScript(
      ({ token }) => {
        localStorage.setItem("org.vibeshape.preferred-slicer.v1", "snapmaker-orca")
        localStorage.setItem("org.vibeshape.slicer-bridge-token.v1", token)
      },
      { token: bridgeToken },
    )

    const observed: {
      handoffCount: number
      handoffBytes: Buffer | null
      authorization: string | undefined
    } = { handoffCount: 0, handoffBytes: null, authorization: undefined }
    await page.route("http://127.0.0.1:43113/**", async (route) => {
      const request = route.request()
      if (request.method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Headers": "authorization, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Origin": "http://127.0.0.1:4173",
            "Access-Control-Allow-Private-Network": "true",
          },
        })
        return
      }
      observed.handoffCount += 1
      observed.handoffBytes = request.postDataBuffer()
      observed.authorization = request.headers().authorization
      const url = new URL(request.url())
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:4173" },
        body: JSON.stringify({
          protocolVersion: 1,
          ok: true,
          requestId: url.searchParams.get("requestId"),
          slicerId: url.searchParams.get("slicerId"),
          filename: url.searchParams.get("filename"),
        }),
      })
    })

    await page.goto("/")
    await createBox(page)
    await page.getByRole("button", { name: "Export…" }).click()
    await page
      .getByRole("dialog", { name: "Export model" })
      .getByRole("button", { name: "Open in Snapmaker Orca" })
      .click()

    await expect(page.getByText("3MF sent to Snapmaker Orca", { exact: true })).toBeVisible()
    expect(observed.handoffCount).toBe(1)
    expect(observed.authorization).toBe(`Bearer ${bridgeToken}`)
    if (!observed.handoffBytes) throw new Error("The bridge request did not contain a body.")
    expect(observed.handoffBytes.subarray(0, 4)).toEqual(Buffer.from([80, 75, 3, 4]))
  })
})
