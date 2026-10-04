import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect } from "./fixtures"

export async function saved(page: Page, timeout = 30_000) {
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeAttached({
    timeout,
  })
}
export async function createSolids(page: Page) {
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  for (const name of ["Box", "Cylinder"]) {
    await commands.getByRole("button", { name, exact: true }).click()
    const form = page.getByRole("form", { name: `Create ${name.toLowerCase()}`, exact: true })
    await form.getByRole("button", { name: `Create ${name.toLowerCase()}`, exact: true }).click()
    await expect(page.getByRole("treeitem", { name: `Part ${name} 1`, exact: true })).toBeVisible({
      timeout: 30_000,
    })
  }
  await saved(page)
}
export async function saveProject(page: Page) {
  await openApplicationMenuItem(page, "Files and projects…")
  const projects = page.getByRole("dialog", { name: "Projects", exact: true })
  const downloading = page.waitForEvent("download")
  await projects.getByRole("button", { name: "Save project (.vshape)", exact: true }).click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("Native archive download must be retained.")
  const bytes = await readFile(path)
  const decoded = await readAuthoredVShape(new Uint8Array(bytes))
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.diagnostic))
  if (decoded.value.version !== 3 && decoded.value.version !== 4 && decoded.value.version !== 5)
    throw new Error("Current authored Save must retain V3, V4 or V5 authority.")
  await expect(projects).not.toBeVisible()
  return { bytes, filename: download.suggestedFilename(), project: decoded.value.project }
}

export async function openProject(
  page: Page,
  source: Awaited<ReturnType<typeof saveProject>>,
  timeout = 30_000,
) {
  await openApplicationMenuItem(page, "Files and projects…")
  await page
    .getByRole("dialog", { name: "Projects", exact: true })
    .getByLabel("Choose VibeShape project file")
    .setInputFiles({
      name: source.filename,
      mimeType: "application/octet-stream",
      buffer: source.bytes,
    })
  await expect(
    page
      .locator("header")
      .first()
      .getByText(`${source.project.snapshot.name} imported`, { exact: true }),
  ).toBeVisible({ timeout })
  await saved(page, timeout)
}

export async function deleteFeatureAndUndo(page: Page, name: string) {
  await page.getByRole("treeitem", { name, exact: true }).click()
  const remove = page.getByRole("button", { name: "Delete feature", exact: true })
  await expect(remove).toBeEnabled()
  await remove.click()
  const confirmation = page.getByRole("alertdialog", { name: `Delete ${name}?`, exact: true })
  await confirmation.getByRole("button", { name: "Delete feature", exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  await expect(page.getByRole("treeitem", { name, exact: true })).toHaveCount(0)
  await saved(page)
  const deleted = await saveProject(page)
  expect(deleted.project.snapshot.features.some(({ label }) => label === name)).toBe(false)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name, exact: true })).toBeVisible()
  return saveProject(page)
}
