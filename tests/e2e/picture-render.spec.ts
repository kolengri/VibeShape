import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function openPicture(page: Page) {
  await openApplicationMenuItem(page, "Render Picture…")
  return page.getByRole("dialog", { name: "Render Picture", exact: true })
}

test("renders visible model bodies to a real PNG and returns to settings without changing the model", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("button", { name: /Hide.*Box 1/ }).click()
  await saved(page)
  const before = (await saveProject(page)).project.snapshot
  await invokeModelCommand(page, "Inspect", "Render Picture")
  const dialog = page.getByRole("dialog", { name: "Render Picture", exact: true })
  await expect(dialog.getByRole("combobox", { name: "Body 1", exact: true })).toBeVisible()
  await expect(dialog.getByRole("combobox", { name: "Body 2", exact: true })).toHaveCount(0)
  await dialog.getByRole("combobox", { name: "Scene", exact: true }).click()
  await page.getByRole("option", { name: "Wooden table", exact: true }).click()
  await dialog.getByRole("combobox", { name: "Body 1", exact: true }).click()
  await page.getByRole("option", { name: "Glossy", exact: true }).click()
  await dialog.getByRole("button", { name: "Render picture", exact: true }).click()
  const preview = dialog.getByRole("img", {
    name: "Rendered picture of the visible model",
    exact: true,
  })
  await expect(preview).toBeVisible()
  expect(
    await preview.evaluate((node: { naturalWidth: number; naturalHeight: number }) => [
      node.naturalWidth,
      node.naturalHeight,
    ]),
  ).toEqual([1080, 1080])
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("link", { name: "Download PNG", exact: true }).click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("PNG download was not retained.")
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR")
  expect(bytes.readUInt32BE(16)).toBe(1080)
  expect(bytes.readUInt32BE(20)).toBe(1080)
  await dialog.getByRole("button", { name: "Return to settings", exact: true }).click()
  await expect(dialog.getByRole("combobox", { name: "Scene", exact: true })).toHaveText(
    "Wooden table",
  )
  await dialog.getByRole("combobox", { name: "Image size", exact: true }).click()
  await page.getByRole("option", { name: "1280 × 720 px", exact: true }).click()
  await dialog.getByRole("combobox", { name: "Camera", exact: true }).click()
  await page.getByRole("option", { name: "Current view", exact: true }).click()
  await dialog.getByRole("button", { name: "Render picture", exact: true }).click()
  await expect(preview).toBeVisible()
  await expect
    .poll(() =>
      preview.evaluate((node: { naturalWidth: number; naturalHeight: number }) => [
        node.naturalWidth,
        node.naturalHeight,
      ]),
    )
    .toEqual([1280, 720])
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click()
  const after = (await saveProject(page)).project.snapshot
  expect(after).toEqual(before)
})

test("cancels a progressive browser render and can immediately render Draft", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const dialog = await openPicture(page)
  await dialog.getByRole("combobox", { name: "Quality", exact: true }).click()
  await page.getByRole("option", { name: "High", exact: true }).click()
  await dialog.getByRole("button", { name: "Render picture", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("Preparing path tracing shaders", {
    timeout: 60_000,
  })
  await dialog.getByRole("button", { name: "Cancel render", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Render picture", exact: true })).toBeEnabled()
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  await dialog.getByRole("combobox", { name: "Quality", exact: true }).click()
  await page.getByRole("option", { name: "Draft", exact: true }).click()
  await dialog.getByRole("button", { name: "Render picture", exact: true }).click()
  await expect(dialog.getByRole("img")).toBeVisible()
})

test("reports unsupported authored relief explicitly and permits rendering after Undo", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await saved(page)
  await invokeModelCommand(page, "Modify", "Surface texture")
  const panel = page.getByRole("complementary", { name: "Surface texture" })
  await panel.getByRole("combobox", { name: "Body", exact: true }).selectOption({ label: "Box 1" })
  await expect(panel.getByText("Relief preview ready.", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await panel.getByRole("button", { name: "Apply", exact: true }).click()
  await saved(page)
  const before = (await saveProject(page)).project.snapshot
  const dialog = await openPicture(page)
  for (const dark of [false, true]) {
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), dark)
    await expect(dialog.getByRole("alert")).toHaveText(/does not support authored surface relief/)
    await expect(dialog.getByRole("button", { name: "Render picture", exact: true })).toBeDisabled()
  }
  await expect(dialog.getByRole("img")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click()
  expect((await saveProject(page)).project.snapshot).toEqual(before)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Undo", exact: true })
    .click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Surface textures", exact: true })).toHaveCount(0)
  const supported = await openPicture(page)
  await expect(supported.getByRole("alert")).toHaveCount(0)
  await expect(supported.getByRole("button", { name: "Render picture", exact: true })).toBeEnabled()
  await supported.getByRole("button", { name: "Render picture", exact: true }).click()
  await expect(supported.getByRole("img")).toBeVisible()
})

test("completes a Standard progressive render as a real PNG", async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const dialog = await openPicture(page)
  await dialog.getByRole("combobox", { name: "Quality", exact: true }).click()
  await page.getByRole("option", { name: "Standard", exact: true }).click()
  await dialog.getByRole("button", { name: "Render picture", exact: true }).click()
  await expect(dialog.getByRole("img")).toBeVisible({ timeout: 150_000 })
  expect(
    await dialog
      .getByRole("img")
      .evaluate((node: { naturalWidth: number; naturalHeight: number }) => [
        node.naturalWidth,
        node.naturalHeight,
      ]),
  ).toEqual([1080, 1080])
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("link", { name: "Download PNG", exact: true }).click()
  const path = await (await downloading).path()
  if (!path) throw new Error("PNG download was not retained.")
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(1080)
  expect(bytes.readUInt32BE(20)).toBe(1080)
  await expect(dialog.getByRole("alert")).toHaveCount(0)
})
