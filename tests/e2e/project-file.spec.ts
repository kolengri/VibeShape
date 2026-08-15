import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

type BrowserRequest<Result> = {
  error: unknown
  result: Result
  onerror: (() => void) | null
  onsuccess: (() => void) | null
}

type BrowserObjectStore = {
  count: () => BrowserRequest<number>
  createIndex: (name: string, keyPath: string, options?: { unique?: boolean }) => unknown
  put: (value: unknown) => unknown
}

type BrowserDatabase = {
  close: () => void
  createObjectStore: (
    name: string,
    options: { keyPath: string | readonly string[] },
  ) => BrowserObjectStore
  objectStoreNames: { contains: (name: string) => boolean }
  transaction: (
    storeName: string,
    mode: "readonly",
  ) => { objectStore: (name: string) => BrowserObjectStore }
}

type BrowserOpenRequest = BrowserRequest<BrowserDatabase> & {
  onupgradeneeded: (() => void) | null
}

type BrowserGlobal = {
  indexedDB: { open: (name: string, version?: number) => BrowserOpenRequest }
}

async function seedVersionOneDatabase(page: Page) {
  await page.goto("/persistence-spike-sw.js")
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = (globalThis as unknown as BrowserGlobal).indexedDB.open(
          "vibeshape-product-v0",
          10,
        )
        request.onerror = () => reject(request.error)
        request.onupgradeneeded = () => {
          const database = request.result
          const projects = database.createObjectStore("projects", { keyPath: "documentId" })
          projects.createIndex("updatedAt", "updatedAt")
          const snapshots = database.createObjectStore("snapshots", {
            keyPath: ["documentId", "revision"],
          })
          snapshots.createIndex("documentId", "documentId")
          snapshots.createIndex("revision", "revision")
          const events = database.createObjectStore("events", {
            keyPath: ["documentId", "revision"],
          })
          events.createIndex("documentId", "documentId")
          events.createIndex("revision", "revision")
          events.createIndex("commandId", "commandId", { unique: true })
          const recovery = database.createObjectStore("recovery", { keyPath: "documentId" })
          recovery.createIndex("updatedAt", "updatedAt")
          const leases = database.createObjectStore("leases", { keyPath: "documentId" })
          leases.createIndex("expiresAt", "expiresAt")
          const cacheIndex = database.createObjectStore("cacheIndex", { keyPath: "contentHash" })
          cacheIndex.createIndex("lastAccessedAt", "lastAccessedAt")
          cacheIndex.createIndex("engineBuildId", "engineBuildId")
          cacheIndex.put({
            schemaVersion: 0,
            contentHash: "0".repeat(64),
            path: `cache/${"0".repeat(64)}.bin`,
            byteLength: 1,
            engineBuildId: "org.vibeshape.occt",
            lastAccessedAt: "2026-08-08T00:00:00Z",
          })
        }
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
      }),
  )
}

async function projectThumbnailCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = (globalThis as unknown as BrowserGlobal).indexedDB.open(
          "vibeshape-product-v0",
        )
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction("projectThumbnails", "readonly")
          const count = transaction.objectStore("projectThumbnails").count()
          count.onerror = () => reject(count.error)
          count.onsuccess = () => {
            database.close()
            resolve(count.result)
          }
        }
      }),
  )
}

test.describe("native project file", () => {
  test("adds the preview store without replacing version-one browser data", async ({ page }) => {
    await seedVersionOneDatabase(page)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const migration = await page.evaluate(
      () =>
        new Promise<{ cacheEntries: number; hasPreviewStore: boolean }>((resolve, reject) => {
          const request = (globalThis as unknown as BrowserGlobal).indexedDB.open(
            "vibeshape-product-v0",
          )
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const database = request.result
            const hasPreviewStore = database.objectStoreNames.contains("projectThumbnails")
            const transaction = database.transaction("cacheIndex", "readonly")
            const count = transaction.objectStore("cacheIndex").count()
            count.onerror = () => reject(count.error)
            count.onsuccess = () => {
              database.close()
              resolve({ cacheEntries: count.result, hasPreviewStore })
            }
          }
        }),
    )
    expect(migration).toEqual({ cacheEntries: 1, hasPreviewStore: true })
  })

  test("backs up and opens a configurable model in fresh browser storage", async ({
    browser,
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("heading", { name: "Variables", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("24 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const createBox = page.getByRole("form", { name: "Create box" })
    await createBox.getByRole("combobox", { name: "Width" }).fill("#width")
    await createBox.getByRole("button", { name: "Create box" }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await expect.poll(() => projectThumbnailCount(page)).toBe(1)

    await page.getByRole("button", { name: "Project…" }).click()
    const projectsDialog = page.getByRole("dialog", { name: "Projects" })
    await projectsDialog.getByRole("button", { name: "Rename Untitled project" }).click()
    const renameDialog = page.getByRole("dialog", { name: "Rename project" })
    await renameDialog.getByRole("textbox", { name: "Project name" }).fill("Calibration bracket")
    await renameDialog.getByRole("button", { name: "Rename project", exact: true }).dblclick()
    await expect(renameDialog).toHaveCount(0)
    await expect(
      page.locator("header").first().getByText("Calibration bracket", { exact: true }),
    ).toBeVisible()

    await expect(
      projectsDialog.getByText("Calibration bracket", {
        exact: true,
      }),
    ).toBeVisible()
    const backupDownload = page.waitForEvent("download")
    await projectsDialog.getByRole("button", { name: "Download .vshape" }).dblclick()
    const download = await backupDownload
    expect(download.suggestedFilename()).toBe("Calibration bracket.vshape")
    const backupPath = await download.path()
    if (!backupPath) throw new Error("Playwright did not retain the .vshape download.")
    const backupBytes = await readFile(backupPath)
    expect(backupBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    await page.getByRole("button", { name: "Project…" }).click()
    const currentProjectDialog = page.getByRole("dialog", { name: "Projects" })
    await currentProjectDialog.getByLabel("Choose VibeShape project file").setInputFiles(backupPath)
    await expect(currentProjectDialog.getByRole("alert")).toContainText(
      "This exact project already exists in this browser.",
    )
    await currentProjectDialog.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()

    const importedContext = await browser.newContext()
    const importedPage = await importedContext.newPage()
    const runtimeErrors: string[] = []
    importedPage.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`)
    })
    importedPage.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`))

    try {
      await importedPage.goto("http://127.0.0.1:4173/")
      await expect(importedPage.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await importedPage.getByRole("button", { name: "Project…" }).click()
      await importedPage.getByLabel("Choose VibeShape project file").setInputFiles(backupPath)

      await expect(importedPage.getByText("Calibration bracket", { exact: true })).toBeVisible()
      await expect(importedPage.getByRole("treeitem", { name: "Box 1" })).toBeVisible({
        timeout: 30_000,
      })
      const viewport = importedPage.getByRole("region", { name: "3D viewport" })
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
      await importedPage.getByRole("treeitem", { name: "Variables" }).click()
      await expect(importedPage.getByRole("textbox", { name: "Variable name" })).toHaveValue(
        "width",
      )
      await expect(importedPage.getByRole("combobox", { name: "Variable expression" })).toHaveValue(
        "24 mm",
      )
      await importedPage.getByRole("treeitem", { name: "Box 1" }).click()
      await expect(
        importedPage
          .getByRole("form", { name: "Edit box" })
          .getByRole("combobox", { name: "Width" }),
      ).toHaveValue("#width")
      expect(runtimeErrors).toEqual([])
    } finally {
      await importedContext.close()
    }
  })

  test("creates, switches, duplicates, and deletes configurable local projects", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("24 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const createBox = page.getByRole("form", { name: "Create box" })
    await createBox.getByRole("combobox", { name: "Width" }).fill("#width")
    await createBox.getByRole("button", { name: "Create box" }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await expect.poll(() => projectThumbnailCount(page)).toBe(1)

    await page.getByRole("button", { name: "Project…" }).click()
    const createdProjectNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    )
    await page
      .getByRole("dialog", { name: "Projects" })
      .getByRole("button", {
        name: "New project",
      })
      .click()
    await createdProjectNavigation
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toHaveCount(0)

    await page.getByRole("button", { name: "Project…" }).click()
    const dialog = page.getByRole("dialog", { name: "Projects" })
    const previousProject = dialog.getByRole("listitem").filter({ hasText: "Revision 3" })
    await expect(previousProject).toHaveCount(1)
    const reopenedProjectNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    )
    await previousProject.getByRole("button", { name: /Open .*revision 3/ }).click()
    await reopenedProjectNavigation

    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: "Project…" }).click()
    const sourceDialog = page.getByRole("dialog", { name: "Projects" })
    const sourceProject = sourceDialog.getByRole("listitem").filter({ hasText: "Revision 3" })
    await sourceProject.getByRole("button", { name: /Duplicate .*revision 3/ }).click()
    const copiedProject = sourceDialog.getByRole("listitem").filter({
      hasText: "Untitled project copy",
    })
    await expect(copiedProject).toContainText("Revision 4")
    await expect(
      copiedProject.getByRole("img", { name: "3D preview of Untitled project copy" }),
    ).toBeVisible()
    const copiedProjectNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    )
    await copiedProject.getByRole("button", { name: /Open .*revision 4/ }).click()
    await copiedProjectNavigation
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible({ timeout: 30_000 })
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("textbox", { name: "Variable name" })).toHaveValue("width")
    await page.getByRole("treeitem", { name: "Box 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Width" }),
    ).toHaveValue("#width")

    await page.getByRole("button", { name: "Project…" }).click()
    const copiedDialog = page.getByRole("dialog", { name: "Projects" })
    const originalProject = copiedDialog.getByRole("listitem").filter({ hasText: "Revision 3" })
    await expect(originalProject).toHaveCount(1)
    await originalProject.getByRole("button", { name: /Delete .*revision 3/ }).click()
    const confirmation = page.getByRole("alertdialog")
    await expect(confirmation).toContainText("Exported .vshape files are not deleted.")
    await confirmation.getByRole("button", { name: "Delete project" }).dblclick()
    await expect(confirmation).toHaveCount(0)
    await expect(originalProject).toHaveCount(0)
    await expect(copiedDialog.getByRole("listitem")).toHaveCount(2)
    await expect.poll(() => projectThumbnailCount(page)).toBe(1)

    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByText("Untitled project copy", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Project…" }).click()
    await expect(page.getByRole("dialog", { name: "Projects" }).getByRole("listitem")).toHaveCount(
      2,
    )
  })
})
