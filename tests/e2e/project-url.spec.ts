import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test.setTimeout(60_000)

async function saved(page: Page) {
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeAttached()
}

async function rename(page: Page, name: string) {
  await openApplicationMenuItem(page, "Rename project")
  const dialog = page.getByRole("dialog", { name: "Rename project", exact: true })
  await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Rename project", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await saved(page)
}

async function newProject(page: Page) {
  const previous = new URL(page.url()).searchParams.get("project")
  await openApplicationMenuItem(page, "Projects")
  await page.getByRole("main").getByRole("button", { name: "New project", exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get("project")).not.toBe(previous)
  await saved(page)
}

async function activeId(page: Page) {
  return page.evaluate(() =>
    (
      globalThis as unknown as { localStorage: { getItem(key: string): string | null } }
    ).localStorage.getItem("vibeshape-active-document-id"),
  )
}

test("project URLs select local projects across switching, history, direct links, and reload", async ({
  page,
}) => {
  await page.goto("/?panel=browser#model")
  await saved(page)
  await expect.poll(() => new URL(page.url()).searchParams.get("project")).toBeTruthy()
  await rename(page, "First URL project")
  const firstUrl = page.url()
  const firstId = new URL(firstUrl).searchParams.get("project")
  await newProject(page)
  await rename(page, "Second URL project")
  const secondUrl = page.url()
  const secondId = new URL(secondUrl).searchParams.get("project")
  expect(secondId).not.toBe(firstId)
  expect(new URL(secondUrl).searchParams.get("panel")).toBe("browser")
  expect(new URL(secondUrl).hash).toBe("#model")

  await page.goBack()
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get("project")).toBeNull()
  await page.goBack()
  await expect(
    page.getByRole("tab", { name: "First URL project", exact: true, selected: true }),
  ).toBeVisible()
  await expect.poll(() => activeId(page)).toBe(firstId)
  expect(page.url()).toBe(firstUrl)
  await page.goForward()
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()
  await page.goForward()
  await expect(
    page.getByRole("tab", { name: "Second URL project", exact: true, selected: true }),
  ).toBeVisible()
  await expect.poll(() => activeId(page)).toBe(secondId)
  expect(page.url()).toBe(secondUrl)

  // The explicit link wins even though the second project was the last local selection.
  await page.goto(firstUrl)
  await expect(
    page.getByRole("tab", { name: "First URL project", exact: true, selected: true }),
  ).toBeVisible()
  await expect.poll(() => activeId(page)).toBe(firstId)
  await page.reload()
  await expect(
    page.getByRole("tab", { name: "First URL project", exact: true, selected: true }),
  ).toBeVisible()
  expect(page.url()).toBe(firstUrl)

  await openApplicationMenuItem(page, "Projects")
  const project = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: "Second URL project" })
  await project.getByRole("button", { name: /^Open / }).click()
  await expect(page).toHaveURL(secondUrl)
  await expect(
    page.getByRole("tab", { name: "Second URL project", exact: true, selected: true }),
  ).toBeVisible()
})

test("blocked Back retains the active project, unsaved draft, and canonical URL", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await newProject(page)
  const currentUrl = page.url()
  const currentId = new URL(currentUrl).searchParams.get("project")
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("combobox", { name: "Width", exact: true }).fill("37 mm")
  await page.goBack()
  await expect(page.getByRole("alert")).toContainText("Finish the active edit")
  await expect(page).toHaveURL(currentUrl)
  await expect.poll(() => activeId(page)).toBe(currentId)
  await expect(form.getByRole("combobox", { name: "Width", exact: true })).toHaveValue("37 mm")
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Dismiss", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveCount(0)
})

for (const target of ["invalid", "0195b5ac-b250-7a2c-8c33-000000000199"]) {
  test(`a ${target === "invalid" ? "malformed" : "missing local"} project URL fails explicitly and offers recovery`, async ({
    page,
  }) => {
    await page.goto("/")
    await saved(page)
    const originalId = new URL(page.url()).searchParams.get("project")
    await page.goto(`/?panel=browser&project=${target}#model`)
    await expect(
      page.getByRole("alert", { name: "Project navigation", exact: true }),
    ).toContainText(target === "invalid" ? "project URL is invalid" : "not stored in this browser")
    expect(new URL(page.url()).searchParams.get("project")).toBe(target)
    expect(await activeId(page)).toBe(originalId)
    await page.getByRole("link", { name: "Open projects", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get("project")).toBeNull()
    await page.getByRole("button", { name: /^Open Untitled project, revision / }).click()
    await saved(page)
    await expect.poll(() => new URL(page.url()).searchParams.get("project")).toBe(originalId)
    expect(new URL(page.url()).searchParams.get("panel")).toBe("browser")
    expect(new URL(page.url()).hash).toBe("#model")
    await expect(page.getByRole("alert")).toHaveCount(0)
  })
}
