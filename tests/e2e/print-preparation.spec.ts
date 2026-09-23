import { readFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import { expect, test } from "./fixtures"

test("previews breakaway fins on a print copy and exports without changing CAD history", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Box", exact: true }).click()
  const box = page.getByRole("form", { name: "Create box" })
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(box).not.toBeVisible()
  await expect(page.getByRole("button", { name: "Suppress Box 1" })).toBeVisible()
  await page.getByRole("button", { name: "Export…", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Export model" })
  await dialog.getByRole("button", { name: "Prepare print / breakaway fins…" }).click()
  await dialog.getByRole("button", { name: "Generate print preview" }).click()
  await expect(dialog.getByText(/1 body · [1-9]\d* fin/)).toBeVisible()
  await expect(dialog.getByLabel("Prepared print model and breakaway fins")).toBeVisible()
  await page.emulateMedia({ reducedMotion: "reduce" })
  for (const dark of [true, false]) {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), dark)
    await dialog.getByRole("button", { name: "Fit preview" }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath(`print-preview-${dark ? "dark" : "light"}.png`),
    })
  }
  // The effective layout viewport of a 1024px-wide window at 200% browser zoom.
  await page.setViewportSize({ width: 512, height: 384 })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole("button", { name: "Download prepared 3MF" }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole("button", { name: "Download prepared 3MF" })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath("print-preview-compact.png") })
  await page.setViewportSize({ width: 1024, height: 768 })
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download prepared 3MF" }).click()
  const preparedDownload = await download
  expect(preparedDownload.suggestedFilename()).toMatch(/\.3mf$/)
  const path = await preparedDownload.path()
  if (!path) throw new Error("The prepared download must be available.")
  const preparedBytes = await readFile(path)
  const archive = unzipSync(preparedBytes)
  const model = new TextDecoder().decode(archive["3D/3dmodel.model"])
  expect(model.match(/<mesh>/g)).toHaveLength(3)
  expect(model.match(/<components>/g)).toHaveLength(1)
  expect(model.match(/<item /g)).toHaveLength(1)
  await expect(
    dialog.getByText("Prepared 3MF download started. The CAD model was not changed."),
  ).toBeVisible()
  const slicerDownload = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Open in OrcaSlicer" }).click()
  const slicerPath = await (await slicerDownload).path()
  if (!slicerPath) throw new Error("The slicer fallback download must be available.")
  expect(await readFile(slicerPath)).toEqual(preparedBytes)
  await dialog.getByLabel("Tilt around X (degrees)").fill("0")
  await expect(dialog.getByRole("button", { name: "Download prepared 3MF" })).not.toBeVisible()
  await dialog.getByRole("button", { name: "Generate print preview" }).click()
  await expect(dialog.getByText("No safe fin was generated.", { exact: false })).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(page.getByRole("button", { name: "Suppress Box 1" })).toBeVisible()
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
  )
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "0",
  )
})
