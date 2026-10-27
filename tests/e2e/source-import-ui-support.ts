import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import type { AuthoredDocumentSnapshot } from "../../packages/domain/src/document-v2"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect } from "./fixtures"

export async function openExport(page: Page, partName?: string) {
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  if (partName) {
    await dialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
    await page.getByRole("option", { name: partName, exact: true }).click()
  }
  return dialog
}
export async function exportGeometry(
  page: Page,
  format: "STEP" | "STL" | "3MF",
  partName?: string,
) {
  const dialog = await openExport(page, partName)
  const downloading = page.waitForEvent("download", { timeout: 30_000 })
  await dialog.getByRole("combobox", { name: "File format" }).selectOption(format.toLowerCase())
  await dialog.getByRole("button", { name: `Save ${format} file`, exact: true }).click()
  const download = await downloading,
    path = await download.path()
  if (!path) throw new Error("The authentic geometry download must be retained.")
  const bytes = await readFile(path)
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`))
  await expect(dialog).not.toBeVisible()
  return bytes
}
export async function chooseImportSource(
  page: Page,
  bytes: Buffer,
  filename: string,
  unit?: string,
) {
  await openApplicationMenuItem(page, "Import geometry…")
  const dialog = page.getByRole("dialog", { name: "Import geometry", exact: true })
  await dialog.getByLabel("Source file", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "application/octet-stream",
    buffer: bytes,
  })
  if (unit) {
    await dialog.getByRole("combobox", { name: "Source unit metadata", exact: true }).click()
    await page.getByRole("option", { name: unit, exact: true }).click()
  }
  return dialog
}

export function requireSourceSnapshot(snapshot: AuthoredDocumentSnapshot) {
  if (snapshot.schemaVersion !== 4)
    throw new Error("A captured source requires V4 source authority.")
  return snapshot
}
