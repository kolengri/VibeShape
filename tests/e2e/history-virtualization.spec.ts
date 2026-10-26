import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { historyVirtualizationFixture, longHistoryLabel } from "./history-virtualization-fixture"

const root = resolve(import.meta.dirname, "../..")
test.use({ autoCreateProject: false })

async function openLongHistory(page: Page, folder: boolean) {
  const portable = historyVirtualizationFixture(folder)
  await page.route("**/history-virtualization-seed.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>History fixture</title>",
    }),
  )
  await page.goto("/history-virtualization-seed.html")
  const documentId = await page.evaluate(
    async ({ root, serialized }) => {
      const portable: ReturnType<typeof historyVirtualizationFixture> = JSON.parse(serialized)
      const [database, repository]: [
        typeof import("../../packages/persistence/src/database"),
        typeof import("../../packages/persistence/src/versioned-repository"),
      ] = await Promise.all([
        import(`/@fs${root}/packages/persistence/src/database.ts`),
        import(`/@fs${root}/packages/persistence/src/versioned-repository.ts`),
      ])
      const db = new database.VibeShapeDatabase("vibeshape-product-v0")
      try {
        const stored = await new repository.VersionedLocalDocumentRepository(
          db,
        ).copyPortableProjectV3(portable)
        if (!stored.ok) throw new Error(stored.diagnostic.message)
        return portable.snapshot.id
      } finally {
        db.close()
      }
    },
    { root, serialized: JSON.stringify(portable) },
  )
  await page.goto(`/?project=${documentId}`)
  const track = page.locator("[data-history-track]")
  await expect(track).toHaveAttribute("data-history-virtualized", "true", { timeout: 30_000 })
  return track
}

for (const folder of [false, true])
  test(`windows 800 History operations${folder ? " including one expanded folder" : ""} and navigates across unmounted rows`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000)
    await page.emulateMedia({ reducedMotion: "reduce" })
    const track = await openLongHistory(page, folder)
    const mounted = track.locator("[data-history-index]")
    const sidebar = page.getByRole("complementary", { name: "Model tree", exact: true })
    const sketchList = sidebar.locator("[data-virtual-sketch-list]")
    await expect(sketchList).toBeAttached()
    await expect.poll(() => sketchList.locator('[role="treeitem"]').count()).toBeLessThan(55)
    const sketchHeader = sidebar.getByRole("treeitem", { name: "Sketches", exact: true })
    await sketchHeader.focus()
    await sketchHeader.press("End")
    const sidebarLast = sidebar.getByRole("treeitem", { name: "Profile 200", exact: true })
    await expect(sidebarLast).toBeFocused()
    await sidebarLast.press("ArrowUp")
    await expect(sidebar.getByRole("treeitem", { name: "Profile 199", exact: true })).toBeFocused()
    await sidebarLast.focus()
    await sidebarLast.press("Home")
    await expect(sketchList.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(0)
    const sidebarCount = await sketchList.locator('[role="treeitem"]').count()
    const selectionSearch = sidebar.getByRole("searchbox")
    const selectedSketch = sidebar.getByRole("treeitem", { name: "Profile 100", exact: true })
    for (let attempt = 0; attempt < 2; attempt++) {
      await selectionSearch.fill("Profile 100")
      await selectedSketch.click({ modifiers: ["ControlOrMeta"] })
      await expect(selectedSketch).toHaveAttribute("aria-selected", "true")
      await selectionSearch.fill("")
      await expect(selectedSketch).toBeVisible()
      await expect(selectedSketch).toHaveAttribute("aria-selected", "true")
      await selectedSketch.focus()
      await selectedSketch.press("Escape")
      await expect(selectedSketch).toHaveAttribute("aria-selected", "false")
      await sidebar.locator('[data-slot="model-tree-content"]').evaluate((element) => {
        element.scrollTop = 0
      })
    }
    const partsHeader = sidebar.getByRole("treeitem", { name: "Parts", exact: true })
    await partsHeader.focus()
    await partsHeader.press("ArrowLeft")
    await expect(partsHeader).toHaveAttribute("aria-expanded", "false")
    await sketchHeader.focus()
    await sketchHeader.press("End")
    await expect(sidebarLast).toBeFocused()
    await expect(sidebarLast).toBeVisible()
    await selectionSearch.fill("Profile 1")
    await sidebar
      .getByRole("treeitem", { name: "Profile 1", exact: true })
      .click({ modifiers: ["ControlOrMeta"] })
    await selectionSearch.fill("")
    await sketchHeader.focus()
    await sketchHeader.press("End")
    await expect(sidebarLast).toBeFocused()
    await sidebarLast.click({ modifiers: ["Shift"] })
    await selectionSearch.fill("Profile 100")
    await expect(
      sidebar.getByText("199 selected items are outside these results.", { exact: true }),
    ).toBeVisible()
    await selectionSearch.fill("")
    await sketchHeader.focus()
    await sketchHeader.press("Escape")
    await expect.poll(() => mounted.count()).toBeLessThan(75)
    await track.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    const last = track.getByRole("treeitem", { name: "Edit Profile 200", exact: true })
    await expect(last).toBeVisible()
    await last.focus()
    await page.keyboard.press("Home")
    const first = track.getByRole("treeitem", {
      name: folder ? "Folder Long folder" : "Operation 1",
      exact: true,
    })
    await expect(first).toBeFocused()
    if (folder) {
      await first.press("ArrowDown")
      await expect(track.getByRole("treeitem", { name: "Operation 1", exact: true })).toBeFocused()
    }
    await page.keyboard.press("End")
    await expect(last).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(
      track.getByRole("treeitem", { name: "Edit Profile 199", exact: true }),
    ).toBeFocused()
    await expect.poll(() => mounted.count()).toBeLessThan(75)
    const compactCount = await mounted.count()
    await page.getByRole("button", { name: "Details", exact: true }).click()
    await expect(last).toBeVisible()
    const detailedWidth = await mounted
      .last()
      .evaluate((element) => element.getBoundingClientRect().width)
    expect(detailedWidth).toBeGreaterThan(150)
    await expect.poll(() => mounted.count()).toBeLessThan(30)
    const cursor = page.getByRole("separator", { name: "History rollback divider", exact: true })
    await cursor.focus()
    await cursor.press("Home")
    await expect(cursor).toHaveAttribute("aria-valuenow", "0")
    await cursor.press("End")
    await expect(cursor).toHaveAttribute("aria-valuenow", "800")
    await expect(last).toBeVisible()
    if (folder) {
      await last.focus()
      await last.press("Home")
      await expect(first).toBeFocused()
      await first.click()
      await expect(first).toHaveAttribute("aria-expanded", "false")
      await track.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      await last.focus()
      await expect(first).toHaveCount(0)
      await last.press("Home")
      await expect(first).toBeFocused()
      await expect(first).toHaveAttribute("aria-expanded", "false")
      await first.press("ArrowDown")
      await expect(first).toHaveAttribute("aria-expanded", "true")
      await expect.poll(() => mounted.count()).toBeLessThan(30)
    }
    if (!folder) {
      const source = await last.boundingBox()
      const sourceId = await last
        .locator("xpath=ancestor::*[@data-history-id][1]")
        .getAttribute("data-history-id")
      if (!source || !sourceId) throw new Error("The long History drag requires a measured source.")
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
      await page.mouse.down()
      await page.mouse.move(source.x + source.width / 2 - 10, source.y + source.height / 2, {
        steps: 4,
      })
      await track.evaluate((element) => {
        element.scrollLeft = 0
      })
      await expect(first).toBeVisible()
      await expect.poll(() => mounted.count()).toBeLessThan(30)
      const destination = await first.boundingBox()
      if (!destination) throw new Error("The long History drag requires a measured destination.")
      await page.mouse.move(
        destination.x + destination.width / 2,
        destination.y + destination.height / 2,
        { steps: 15 },
      )
      await page.mouse.up()
      await expect(track.locator('[data-history-index="0"]')).toHaveAttribute(
        "data-history-id",
        sourceId,
        { timeout: 30_000 },
      )
    }
    const search = sidebar.getByRole("searchbox")
    await search.fill(longHistoryLabel)
    await sidebar.getByRole("treeitem", { name: longHistoryLabel, exact: true }).click()
    const edit = page.getByRole("form", { name: "Edit box", exact: true })
    await expect(edit).toBeVisible()
    const revealed = track.getByRole("treeitem", { name: longHistoryLabel, exact: true })
    await expect(revealed).toBeVisible()
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    await search.fill("")
    await track
      .getByRole("button", { name: `Actions for ${longHistoryLabel}`, exact: true })
      .click()
    await page.getByRole("menuitem", { name: `Rename ${longHistoryLabel}…`, exact: true }).click()
    const rename = page.getByRole("dialog", { name: "Rename feature", exact: true })
    await expect(rename).toBeVisible()
    await track.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await expect(rename).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(rename).toHaveCount(0)
    await checkHistoryLayouts(page, track, mounted, folder)
    const path = info.outputPath("history-mount-count.json")
    await writeFile(
      path,
      JSON.stringify({
        operations: 800,
        compactCount,
        detailedCount: await mounted.count(),
        sidebarCount,
        detailedWidth,
      }),
    )
    await info.attach("history-mount-count", { path, contentType: "application/json" })
  })

async function checkHistoryLayouts(page: Page, track: Locator, mounted: Locator, folder: boolean) {
  for (const width of [1024, 512]) {
    await page.setViewportSize({ width, height: width === 512 ? 450 : 900 })
    for (const theme of ["light", "dark"]) {
      await page.locator("html").evaluate((node, theme) => {
        node.classList.toggle("dark", theme === "dark")
      }, theme)
      await track.getByRole("treeitem").last().focus()
      await page.keyboard.press("End")
      const tail = track.getByRole("treeitem", {
        name: folder ? "Edit Profile 200" : "Edit Profile 199",
        exact: true,
      })
      await expect(tail).toBeFocused()
      await expect(tail).toBeVisible()
      await expect.poll(() => mounted.count()).toBeLessThan(30)
      expect(
        await page.locator("html").evaluate((element) => {
          const browser = element.ownerDocument.defaultView
          return browser !== null && element.scrollWidth <= browser.innerWidth + 1
        }),
      ).toBe(true)
      const bounds = await track.boundingBox()
      const item = await tail.boundingBox()
      if (!bounds || !item) throw new Error("History must have a measurable visible track.")
      expect(item.x).toBeGreaterThanOrEqual(bounds.x - 1)
      expect(item.x + item.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
    }
  }
}
