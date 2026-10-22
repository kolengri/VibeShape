import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

const projectTabs = (page: Page) =>
  page.getByRole("navigation", { name: "Open projects", exact: true })
const projectId = (page: Page) => new URL(page.url()).searchParams.get("project")
async function saved(page: Page) {
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
    { timeout: 30_000 },
  )
}
async function rename(page: Page, name: string) {
  await page
    .locator("header")
    .getByRole("button", { name: /^Rename / })
    .click()
  const dialog = page.getByRole("dialog", { name: "Rename project", exact: true })
  await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Rename project", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await saved(page)
  await expect(projectTabs(page).getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
}
async function newProject(page: Page, name: string) {
  const previous = projectId(page)
  await projectTabs(page).getByRole("button", { name: "New project", exact: true }).click()
  await expect.poll(() => projectId(page)).not.toBe(previous)
  await saved(page)
  await rename(page, name)
}
async function primitive(page: Page, name: "Box" | "Cylinder") {
  await invokeModelCommand(page, "Primitives", name)
  const form = page.getByRole("form", { name: `Create ${name.toLowerCase()}`, exact: true })
  await form.getByRole("button", { name: `Create ${name.toLowerCase()}`, exact: true }).click()
  await expect(form).toHaveCount(0)
  await saved(page)
}

test("keeps project tabs, geometry isolation and guarded URLs through switching, closing and reload", async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  await rename(page, "Tabs bracket")
  const firstId = projectId(page)
  await primitive(page, "Box")
  await newProject(page, "Tabs enclosure")
  const secondId = projectId(page)
  await primitive(page, "Cylinder")
  const tabs = projectTabs(page)
  await expect(tabs.getByRole("tab")).toHaveText(["Tabs bracket", "Tabs enclosure"])
  await tabs.getByRole("tab", { name: "Tabs bracket", exact: true }).click()
  await expect.poll(() => projectId(page)).toBe(firstId)
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toHaveCount(0)
  await tabs.getByRole("tab", { name: "Tabs bracket", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(tabs.getByRole("tab", { name: "Tabs enclosure", exact: true })).toBeFocused()
  expect(projectId(page)).toBe(firstId)
  await page.keyboard.press("Enter")
  await expect.poll(() => projectId(page)).toBe(secondId)
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toHaveCount(0)
  await page.reload()
  await saved(page)
  await expect(tabs.getByRole("tab")).toHaveText(["Tabs bracket", "Tabs enclosure"])
  await expect(tabs.getByRole("tab", { name: "Tabs enclosure", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await tabs.getByRole("tab", { name: "Tabs bracket", exact: true }).click()
  await expect.poll(() => projectId(page)).toBe(firstId)
  await page.goBack()
  await expect.poll(() => projectId(page)).toBe(secondId)
  await saved(page)
  await expect(tabs.getByRole("tab", { name: "Tabs enclosure", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await tabs.getByRole("button", { name: "Close Tabs bracket", exact: true }).click()
  await expect(tabs.getByRole("tab", { name: "Tabs bracket", exact: true })).toHaveCount(0)
  expect(projectId(page)).toBe(secondId)
  await tabs.getByRole("button", { name: "Open project…", exact: true }).click()
  const library = page.getByRole("main")
  await expect(library.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await library.getByRole("button", { name: /^Open Tabs bracket, revision / }).click()
  await expect.poll(() => projectId(page)).toBe(firstId)
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await expect(tabs.getByRole("tab")).toHaveText(["Tabs enclosure", "Tabs bracket"])
  await tabs.getByRole("tab", { name: "Tabs enclosure", exact: true }).click()
  await expect.poll(() => projectId(page)).toBe(secondId)
  await tabs.getByRole("button", { name: "Close Tabs enclosure", exact: true }).click()
  await expect.poll(() => projectId(page)).toBe(firstId)
  await saved(page)
  await expect(tabs.getByRole("tab")).toHaveText(["Tabs bracket"])
  await tabs.getByRole("button", { name: "Close Tabs bracket", exact: true }).click()
  await expect(library.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  expect(projectId(page)).toBeNull()
  await expect(tabs).toHaveCount(0)
  await library.getByRole("button", { name: /^Open Tabs bracket, revision / }).click()
  await expect.poll(() => projectId(page)).toBe(firstId)
  await saved(page)
  await expect(tabs.getByRole("tab")).toHaveText(["Tabs bracket"])
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.screenshot({ animations: "disabled", path: info.outputPath("project-tabs-dark.png") })
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
  await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
  await page.getByRole("option", { name: "Light", exact: true }).click()
  await settings.getByRole("button", { name: "Done", exact: true }).click()
  await page.screenshot({ animations: "disabled", path: info.outputPath("project-tabs-light.png") })
})

test("retains an active draft when switching or closing its project tab is blocked", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto("/")
  await saved(page)
  await rename(page, "Draft source")
  const firstId = projectId(page)
  await newProject(page, "Draft target")
  const tabs = projectTabs(page)
  await tabs.getByRole("tab", { name: "Draft source", exact: true }).click()
  await expect.poll(() => projectId(page)).toBe(firstId)
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  const width = form.getByRole("combobox", { name: "Width", exact: true })
  await width.fill("37 mm")
  await tabs.getByRole("tab", { name: "Draft target", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert"),
  ).toContainText("Finish or cancel")
  expect(projectId(page)).toBe(firstId)
  await expect(width).toHaveValue("37 mm")
  await tabs.getByRole("button", { name: "Close Draft source", exact: true }).click()
  await expect(tabs.getByRole("tab")).toHaveCount(2)
  await expect(form).toBeVisible()
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await tabs.getByRole("tab", { name: "Draft target", exact: true }).click()
  await expect(tabs.getByRole("tab", { name: "Draft target", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(form).toHaveCount(0)
})
