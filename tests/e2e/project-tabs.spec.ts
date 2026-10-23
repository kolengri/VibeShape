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
async function rename(page: Page, name: string, via: "tab" | "menu" | "keyboard" = "tab") {
  const activeTab = projectTabs(page).getByRole("tab", { selected: true })
  if (via === "menu") await openApplicationMenuItem(page, "Rename project")
  else if (via === "keyboard") await activeTab.press("F2")
  else await activeTab.dblclick()
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
  await openApplicationMenuItem(page, "New project")
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

async function dragTreeSeparator(page: Page, distance: number) {
  const bounds = await page.locator('[data-slot="resizable-handle"]').first().boundingBox()
  if (!bounds) throw new Error("Expected the model-tree separator bounds.")
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + distance, y, { steps: 5 })
  await page.mouse.up()
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
}

test("keeps project tabs, geometry isolation and guarded URLs through switching, closing and reload", async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  await rename(page, "Bracket draft", "menu")
  await rename(page, "Tabs bracket", "keyboard")
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
  await openApplicationMenuItem(page, "Projects")
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
  await page.getByRole("button", { name: "Application menu", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "New project", exact: true })).toBeDisabled()
  await expect(page.getByRole("menuitem", { name: "Rename project", exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  const activeTab = tabs.getByRole("tab", { name: "Draft source", exact: true })
  await activeTab.dblclick()
  await activeTab.press("F2")
  await expect(page.getByRole("dialog", { name: "Rename project", exact: true })).toHaveCount(0)
  await expect(width).toHaveValue("37 mm")
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

const projectRebuildGate = `(() => {
    const NativeWorker = window.Worker
    const requests = []
    Object.assign(window, { projectMeshRequests: requests })
    const postMessage = NativeWorker.prototype.postMessage
    NativeWorker.prototype.postMessage = function (message, transferOrOptions) {
      if (message?.type === "rebuildDocument") requests.push(message.mesh)
      Reflect.apply(postMessage, this, [message, transferOrOptions])
    }
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args)
        const held = []
        const released = new WeakSet()
        this.addEventListener("message", (event) => {
          if (event.data?.type !== "documentRebuilt" || released.has(event)) return
          event.stopImmediatePropagation()
          held.push(event)
        })
        window.addEventListener("release-project-rebuild", () => {
          const event = held.shift()
          if (!event) return
          const replay = new MessageEvent("message", { data: event.data })
          released.add(replay)
          this.dispatchEvent(replay)
        })
      }
    }
})()`

test("selects and reloads a cold project with progressive viewport loading", async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await rename(page, "Detailed project")
  await primitive(page, "Cylinder")
  const detailedId = projectId(page)
  await newProject(page, "Current project")
  await page.reload()
  await saved(page)

  // Hold real worker responses so each presentation stage is observable without timing races.
  await page.evaluate(projectRebuildGate)
  const tabs = projectTabs(page)
  await tabs.getByRole("tab", { name: "Detailed project", exact: true }).click()
  await expect.poll(() => projectId(page)).toBe(detailedId)
  await expect(tabs.getByRole("tab", { name: "Detailed project", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByText("Loading project and history…", { exact: true })).toBeVisible()
  for (const region of ["toolbar", "tree", "history", "viewport", "status"]) {
    await expect(page.locator(`[data-project-skeleton="${region}"]`)).toBeVisible()
  }
  await expect(page.locator('[data-slot="resizable-panel-group"]')).toHaveAttribute("inert", "")
  await expect(page.getByRole("separator")).toHaveCount(0)
  await page.setViewportSize({ width: 512, height: 384 })
  await expect(page.getByRole("button", { name: "Show model tree", exact: true })).toHaveCount(0)
  await expect(page.getByText("Loading project and history…", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.screenshot({ animations: "disabled", path: info.outputPath("project-reading.png") })
  await page.setViewportSize({ width: 700, height: 768 })
  const readingCard = page
    .getByRole("progressbar", { name: "Project loading progress" })
    .locator("..")
  const readingBounds = await readingCard.boundingBox()
  const treeBounds = await page.locator(".workspace-panel--tree").boundingBox()
  expect(readingBounds).not.toBeNull()
  expect(treeBounds).not.toBeNull()
  if (readingBounds && treeBounds) {
    expect(readingBounds.x).toBeGreaterThanOrEqual(treeBounds.x + treeBounds.width)
    expect(readingBounds.x + readingBounds.width).toBeLessThanOrEqual(700)
  }
  const treePanel = page.locator(".workspace-panel--tree")
  const initialTreeWidth = await treePanel.evaluate((panel) => panel.getBoundingClientRect().width)
  const layoutBeforeDrag = await page.evaluate(() =>
    localStorage.getItem("vibeshape.workspace-layout.v1"),
  )
  await dragTreeSeparator(page, 64)
  expect(await treePanel.evaluate((panel) => panel.getBoundingClientRect().width)).toBe(
    initialTreeWidth,
  )
  expect(await page.evaluate(() => localStorage.getItem("vibeshape.workspace-layout.v1"))).toBe(
    layoutBeforeDrag,
  )
  await expect(page.locator('[data-slot="blocking-loader-overlay"]')).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Application menu", exact: true })).toBeEnabled()
  await expect
    .poll(() => page.evaluate<unknown[]>("window.projectMeshRequests"))
    .toEqual([{ chordTolerance: 0.5, angularTolerance: 0.5 }])
  await expect(async () => {
    await page.evaluate('window.dispatchEvent(new Event("release-project-rebuild"))')
    await expect(page.getByText("Refining model detail…", { exact: true })).toBeVisible()
  }).toPass({ timeout: 30_000 })
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible()
  await expect(page.locator("[data-project-skeleton]")).toHaveCount(0)
  await dragTreeSeparator(page, 64)
  await expect
    .poll(() => treePanel.evaluate((panel) => panel.getBoundingClientRect().width))
    .toBeGreaterThan(initialTreeWidth + 32)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vibeshape.workspace-layout.v1")))
    .not.toBe(layoutBeforeDrag)
  await expect(page.locator('[data-rendered-feature-count="1"]')).toBeVisible()
  expect(
    await page.evaluate<boolean>(`(() => {
    const canvas = document.querySelector('canvas[aria-label="3D viewport"]')
    const bounds = canvas.getBoundingClientRect()
    return document.elementFromPoint(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5) === canvas
  })()`),
  ).toBe(true)
  await expect(
    page.getByRole("progressbar", { name: "Project loading progress" }),
  ).not.toHaveAttribute("aria-valuenow")
  await expect(page.locator('[data-slot="blocking-loader-overlay"]')).toHaveCount(0)
  await page.setViewportSize({ width: 1024, height: 768 })
  const progress = page.getByRole("progressbar", { name: "Project loading progress" })
  const history = page.locator(".workspace-history")
  const progressBounds = await progress.boundingBox()
  const historyBounds = await history.boundingBox()
  expect(progressBounds).not.toBeNull()
  expect(historyBounds).not.toBeNull()
  if (progressBounds && historyBounds) {
    expect(progressBounds.y + progressBounds.height).toBeLessThan(historyBounds.y)
  }
  await expect(
    page.getByText("Opening the local document and geometry engine…", { exact: true }),
  ).toHaveCount(0)
  await page.screenshot({ animations: "disabled", path: info.outputPath("project-refining.png") })
  await tabs.getByRole("tab", { name: "Current project", exact: true }).click()
  await saved(page)
  await expect(tabs.getByRole("tab", { name: "Current project", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByRole("progressbar", { name: "Project loading progress" })).toHaveCount(0)
  await tabs.getByRole("tab", { name: "Detailed project", exact: true }).click()
  await expect(page.getByText("Refining model detail…", { exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate<unknown[]>("window.projectMeshRequests"))
    .toEqual([
      { chordTolerance: 0.5, angularTolerance: 0.5 },
      { chordTolerance: 0.05, angularTolerance: 0.1 },
    ])
  await expect(async () => {
    await page.evaluate('window.dispatchEvent(new Event("release-project-rebuild"))')
    await saved(page)
  }).toPass({ timeout: 30_000 })
  await expect(page.getByRole("progressbar", { name: "Project loading progress" })).toHaveCount(0)
  await expect(page.locator('[data-rendered-feature-count="1"]')).toBeVisible()
  await tabs.getByRole("tab", { name: "Current project", exact: true }).click()
  await saved(page)
  await tabs.getByRole("tab", { name: "Detailed project", exact: true }).click()
  await saved(page)
  expect(await page.evaluate<unknown[]>("window.projectMeshRequests")).toHaveLength(2)

  await page.addInitScript(projectRebuildGate)
  await page.reload()
  await expect(page.getByText("Loading project and history…", { exact: true })).toBeVisible()
  await expect(page.locator('[data-project-skeleton="history"]')).toBeVisible()
  await expect(tabs.getByRole("tab", { name: "Detailed project", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.locator('[data-slot="blocking-loader-overlay"]')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate<unknown[]>("window.projectMeshRequests"))
    .toEqual([{ chordTolerance: 0.5, angularTolerance: 0.5 }])
  await expect(async () => {
    await page.evaluate('window.dispatchEvent(new Event("release-project-rebuild"))')
    await expect(page.getByText("Refining model detail…", { exact: true })).toBeVisible()
  }).toPass({ timeout: 30_000 })
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible()
  await expect(async () => {
    await page.evaluate('window.dispatchEvent(new Event("release-project-rebuild"))')
    await saved(page)
  }).toPass({ timeout: 30_000 })
  await expect
    .poll(() => page.evaluate<unknown[]>("window.projectMeshRequests"))
    .toEqual([
      { chordTolerance: 0.5, angularTolerance: 0.5 },
      { chordTolerance: 0.05, angularTolerance: 0.1 },
    ])
  await expect(page.getByRole("progressbar", { name: "Project loading progress" })).toHaveCount(0)
})
