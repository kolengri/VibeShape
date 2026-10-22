import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test.use({ autoCreateProject: false })

const chooser = (page: Page) => page.getByRole("heading", { name: "Projects", exact: true })
const projectId = (page: Page) => new URL(page.url()).searchParams.get("project")
const openChooser = async (page: Page) => {
  await openApplicationMenuItem(page, "Projects")
  await expect(chooser(page)).toBeVisible()
  expect(projectId(page)).toBeNull()
}

test("starts and reloads at the chooser without creating a document", async ({ page }) => {
  await page.goto("/")
  await expect(chooser(page)).toBeVisible()
  await expect(page.getByRole("button", { name: "New project", exact: true })).toBeEnabled()
  await expect(page.getByRole("list", { name: "Local projects", exact: true })).toHaveCount(0)
  expect(projectId(page)).toBeNull()
  await page.reload()
  await expect(chooser(page)).toBeVisible()
  await expect(page.getByRole("button", { name: "New project", exact: true })).toBeEnabled()
  await expect(page.getByRole("list", { name: "Local projects", exact: true })).toHaveCount(0)
  expect(projectId(page)).toBeNull()
  await page.getByLabel("Choose VibeShape project file").setInputFiles({
    name: "invalid.vshape",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid archive"),
  })
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(chooser(page)).toBeVisible()
  await expect(page.getByRole("list", { name: "Local projects", exact: true })).toHaveCount(0)
})

test("recovers an unavailable project deep link into the chooser without creating a replacement", async ({
  page,
}) => {
  await page.goto("/?project=0195b5ac-b220-7a2c-8c33-67a36a7f21ac")
  await expect(chooser(page)).toBeVisible()
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page.getByRole("button", { name: "New project", exact: true })).toBeEnabled()
  expect(projectId(page)).toBeNull()
  await expect(page.getByRole("list", { name: "Local projects", exact: true })).toHaveCount(0)
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveCount(
    0,
  )
})

test("opens saved cards and deep links, imports backups and deletes from the shared chooser", async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await page.getByRole("button", { name: "New project", exact: true }).click()
  await saved(page)
  const originalId = projectId(page)
  expect(originalId).not.toBeNull()
  await openApplicationMenuItem(page, "Rename project")
  const rename = page.getByRole("dialog", { name: "Rename project", exact: true })
  await rename.getByRole("textbox", { name: "Project name", exact: true }).fill("Landing bracket")
  await rename.getByRole("button", { name: "Rename project", exact: true }).click()
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await saved(page)
  const backup = await saveProject(page)
  await openChooser(page)
  await page.reload()
  await expect(chooser(page)).toBeVisible()
  await expect(page.getByRole("listitem")).toHaveCount(1)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("project-chooser-dark.png"),
  })
  const card = page.getByRole("listitem").filter({ hasText: "Landing bracket" })
  const open = card.getByRole("button", { name: /^Open Landing bracket, revision / })
  const cardBounds = await card.boundingBox()
  const openBounds = await open.boundingBox()
  expect(cardBounds).not.toBeNull()
  expect(openBounds).not.toBeNull()
  if (!cardBounds || !openBounds) throw new Error("The saved project card has no bounds.")
  expect(Math.abs(cardBounds.width - openBounds.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(cardBounds.height - openBounds.height)).toBeLessThanOrEqual(2)
  await open.click({ position: { x: 3, y: 3 } })
  await saved(page)
  expect(projectId(page)).toBe(originalId)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("editor-controls.png"),
  })
  await openChooser(page)
  const footerBounds = await open.boundingBox()
  if (!footerBounds) throw new Error("The project card footer has no bounds.")
  await open.click({ position: { x: 12, y: footerBounds.height - 12 } })
  await saved(page)
  expect(projectId(page)).toBe(originalId)
  await page.goto(`/?project=${originalId}`)
  await saved(page)
  await expect(chooser(page)).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
  await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
  await page.getByRole("option", { name: "Light", exact: true }).click()
  await settings.getByRole("button", { name: "Done", exact: true }).click()
  await openChooser(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("project-chooser-light-mobile.png"),
  })
  await page.getByRole("button", { name: /^Delete Landing bracket, revision / }).click()
  const confirm = page.getByRole("alertdialog", { name: "Delete Landing bracket?", exact: true })
  await confirm.getByRole("button", { name: "Keep project", exact: true }).click()
  await expect(page.getByRole("listitem")).toHaveCount(1)
  await page.getByRole("button", { name: /^Delete Landing bracket, revision / }).click()
  await confirm.getByRole("button", { name: "Delete project", exact: true }).click()
  await expect(page.getByRole("listitem")).toHaveCount(0)
  await expect(confirm).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Drop a .vshape project", exact: true }),
  ).toHaveAttribute("aria-disabled", "false")
  await page.getByLabel("Choose VibeShape project file").setInputFiles({
    name: backup.filename,
    mimeType: "application/octet-stream",
    buffer: backup.bytes,
  })
  await saved(page)
  expect(projectId(page)).not.toBe(originalId)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await openChooser(page)
  await expect(page.getByRole("listitem")).toHaveCount(1)
  await expect(
    page.getByRole("button", { name: /^Open Landing bracket imported, revision / }),
  ).toBeVisible()
})
