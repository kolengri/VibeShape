import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { extrusionFeatureParametersV5Schema } from "../../packages/domain/src/part-design"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

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

async function writerLeaseCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = (globalThis as unknown as BrowserGlobal).indexedDB.open(
          "vibeshape-product-v0",
        )
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction("leases", "readonly")
          const count = transaction.objectStore("leases").count()
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
    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
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
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await expect.poll(() => projectThumbnailCount(page)).toBe(1)

    await openApplicationMenuItem(page, "Files and projects…")
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
    await projectsDialog.getByRole("button", { name: "Save project (.vshape)" }).dblclick()
    const download = await backupDownload
    expect(download.suggestedFilename()).toBe("Calibration bracket.vshape")
    const backupPath = await download.path()
    if (!backupPath) throw new Error("Playwright did not retain the .vshape download.")
    const backupBytes = await readFile(backupPath)
    expect(backupBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const decodedBackup = await readAuthoredVShape(new Uint8Array(backupBytes))
    expect(decodedBackup).toMatchObject({
      ok: true,
      value: {
        version: 3,
        project: {
          manifest: { historyMode: "complete", promotionRevision: 0, upgradeRevision: 2 },
          versionedEvents: { length: 5 },
        },
      },
    })
    if (!decodedBackup.ok || decodedBackup.value.version !== 3)
      throw new Error("Expected replay-validated authored V3 history.")
    const authoredEvents = decodedBackup.value.project.versionedEvents
    expect(authoredEvents[0]).toMatchObject({
      schemaVersion: 1,
      type: "org.vibeshape.document.created",
      baseRevision: 0,
      revision: 1,
    })
    expect(authoredEvents[1]).toMatchObject({
      schemaVersion: 2,
      type: "org.vibeshape.document.upgraded-v2",
      baseRevision: authoredEvents[0]?.revision,
      revision: 2,
    })
    expect(authoredEvents.filter((event) => event.schemaVersion === 1)).toHaveLength(1)
    expect(
      authoredEvents.filter((event) => event.type === "org.vibeshape.document.upgraded-v2"),
    ).toHaveLength(1)
    expect(
      authoredEvents.flatMap((event) =>
        event.type === "org.vibeshape.document.model-changed"
          ? [event.modelEvent]
          : event.schemaVersion === 1
            ? [event]
            : [],
      ),
    ).toHaveLength(4)

    await openApplicationMenuItem(page, "Files and projects…")
    const currentProjectDialog = page.getByRole("dialog", { name: "Projects" })
    const originalProjectId = await page.evaluate(() =>
      (
        globalThis as unknown as { localStorage: { getItem(key: string): string | null } }
      ).localStorage.getItem("vibeshape-active-document-id"),
    )
    await currentProjectDialog.getByLabel("Choose VibeShape project file").setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/octet-stream",
      buffer: backupBytes,
    })
    await expect(
      page.locator("header").first().getByText("Calibration bracket imported", { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    const copiedProjectId = await page.evaluate(() =>
      (
        globalThis as unknown as { localStorage: { getItem(key: string): string | null } }
      ).localStorage.getItem("vibeshape-active-document-id"),
    )
    expect(copiedProjectId).not.toBe(originalProjectId)
    await openApplicationMenuItem(page, "Files and projects…")
    const copiedProjectDialog = page.getByRole("dialog", { name: "Projects" })
    await expect(
      copiedProjectDialog.getByRole("listitem").filter({ hasText: "Calibration bracket imported" }),
    ).toHaveCount(1)
    await expect(
      copiedProjectDialog
        .getByRole("listitem")
        .filter({ hasText: "Calibration bracket" })
        .filter({ hasNotText: "imported" }),
    ).toHaveCount(1)
    await copiedProjectDialog.getByRole("button", { name: "Close", exact: true }).click()

    const importedContext = await browser.newContext()
    const importedPage = await importedContext.newPage()
    const runtimeErrors: string[] = []
    importedPage.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`)
    })
    importedPage.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`))

    try {
      await importedPage.goto(new URL(page.url()).origin)
      await expect(importedPage.getByText("Saved in this browser", { exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await openApplicationMenuItem(importedPage, "Files and projects…")
      const transfer = await importedPage.evaluateHandle(
        (bytes) => {
          const browser = globalThis as unknown as {
            DataTransfer: new () => { items: { add: (file: File) => void } }
          }
          const data = new browser.DataTransfer()
          data.items.add(new File([new Uint8Array(bytes)], "Calibration bracket.vshape"))
          return data
        },
        [...backupBytes],
      )
      await importedPage
        .getByLabel("Drop a .vshape project")
        .dispatchEvent("drop", { dataTransfer: transfer })
      await transfer.dispose()

      await expect(
        importedPage.getByText("Calibration bracket imported", { exact: true }),
      ).toBeVisible()
      await expect(importedPage.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible({
        timeout: 30_000,
      })
      const viewport = importedPage.getByRole("region", { name: "3D viewport" })
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
      await importedPage.getByRole("treeitem", { name: "Variables", exact: true }).click()
      await expect(importedPage.getByRole("textbox", { name: "Variable name" })).toHaveValue(
        "width",
      )
      await expect(importedPage.getByRole("combobox", { name: "Variable expression" })).toHaveValue(
        "24 mm",
      )
      await importedPage.getByRole("treeitem", { name: "Box 1", exact: true }).click()
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
    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
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
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await expect.poll(() => projectThumbnailCount(page)).toBe(1)

    await openApplicationMenuItem(page, "Files and projects…")
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
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toHaveCount(0)

    await openApplicationMenuItem(page, "Files and projects…")
    const dialog = page.getByRole("dialog", { name: "Projects" })
    const previousProject = dialog.getByRole("listitem").filter({ hasText: "Revision 3" })
    await expect(previousProject).toHaveCount(1)
    const reopenedProjectNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    )
    await previousProject.getByRole("button", { name: /Open .*revision 3/ }).click()
    await reopenedProjectNavigation

    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await openApplicationMenuItem(page, "Files and projects…")
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
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
    await expect(page.getByRole("textbox", { name: "Variable name" })).toHaveValue("width")
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Width" }),
    ).toHaveValue("#width")
    await expect.poll(() => writerLeaseCount(page)).toBe(1)
    await page
      .getByRole("form", { name: "Edit box" })
      .getByRole("button", { name: "Cancel", exact: true })
      .click()

    await openApplicationMenuItem(page, "Files and projects…")
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
    await openApplicationMenuItem(page, "Files and projects…")
    await expect(page.getByRole("dialog", { name: "Projects" }).getByRole("listitem")).toHaveCount(
      2,
    )
  })
})

async function saveNativeProject(page: Page) {
  await openApplicationMenuItem(page, "Files and projects…")
  const downloading = page.waitForEvent("download")
  await page
    .getByRole("dialog", { name: "Projects", exact: true })
    .getByRole("button", { name: "Save project (.vshape)", exact: true })
    .click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("Native project download must be retained.")
  const bytes = await readFile(path)
  const decoded = await readAuthoredVShape(new Uint8Array(bytes))
  if (!decoded.ok || decoded.value.version !== 3)
    throw new Error("Expected a valid authored V3 project archive.")
  return { project: decoded.value.project, bytes, filename: download.suggestedFilename() }
}

async function extrusionVolume(page: Page) {
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Measure", exact: true })
    .click()
  const panel = page.getByRole("complementary", { name: "Measure", exact: true })
  const metric = panel
    .locator("dt", { hasText: /^Volume$/ })
    .locator("..")
    .locator("dd")
  await expect(metric).toContainText("mm³", { timeout: 30_000 })
  const value = (await metric.innerText()).match(/[0-9,.]+/)?.[0]
  if (!value) throw new Error("Exact extrusion volume must be displayed.")
  await panel.getByRole("button", { name: "Close", exact: true }).click()
  return Number(value.replaceAll(",", ""))
}

test("round trips reversed independent V5 extrusion depths through Save and a fresh editable Open copy", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  const saved = page.getByText("Saved in this browser", { exact: true })
  await expect(saved).toBeVisible({ timeout: 30_000 })
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await commands.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await form.getByRole("combobox", { name: "Distance", exact: true }).fill("13 mm")
  await form.getByRole("checkbox", { name: "Reverse first direction", exact: true }).check()
  await form.getByRole("checkbox", { name: "Second direction", exact: true }).check()
  await form.getByRole("combobox", { name: "Second distance", exact: true }).fill("7 mm")
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-preview-status",
    "ready",
    { timeout: 30_000 },
  )
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(saved).toBeVisible()
  const originalVolume = await extrusionVolume(page)
  expect(originalVolume).toBeGreaterThan(0)
  const source = await saveNativeProject(page)
  const sourceFeature = source.project.snapshot.features[0]
  if (!sourceFeature) throw new Error("Extrusion must survive the native archive.")
  expect(sourceFeature.type.schemaVersion).toBe(5)
  expect(extrusionFeatureParametersV5Schema.parse(sourceFeature.parameters)).toMatchObject({
    distance: { value: 13 },
    secondDistance: { value: 7 },
    reversed: true,
    symmetric: false,
  })
  const points =
    source.project.snapshot.sketches[0]?.entities.filter((entity) => entity.type === "point") ?? []
  expect(points).toHaveLength(4)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const expectedVolume =
    (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) * 20
  expect(originalVolume).toBeCloseTo(expectedVolume, 3)

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
  ).toBeVisible({ timeout: 30_000 })
  await expect(saved).toBeVisible()
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
    { timeout: 30_000 },
  )
  expect(await extrusionVolume(page)).toBeCloseTo(expectedVolume, 3)
  await page.getByRole("treeitem", { name: "Extrusion 1", exact: true }).click()
  const reopened = page.getByRole("form", { name: "Edit extrusion", exact: true })
  await expect(reopened.getByRole("combobox", { name: "Distance", exact: true })).toHaveValue(
    "13 mm",
  )
  await expect(
    reopened.getByRole("combobox", { name: "Second distance", exact: true }),
  ).toHaveValue("7 mm")
  await expect(
    reopened.getByRole("checkbox", { name: "Reverse first direction", exact: true }),
  ).toBeChecked()
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click()
  const copy = await saveNativeProject(page)
  expect(copy.project.snapshot.id).not.toBe(source.project.snapshot.id)
  expect(copy.project.snapshot.features).toEqual(source.project.snapshot.features)
  expect(copy.project.snapshot.sketches).toEqual(source.project.snapshot.sketches)
  expect(copy.project.snapshot.history).toEqual(source.project.snapshot.history)
  expect(copy.project.versionedEvents).toHaveLength(source.project.versionedEvents.length + 1)
  const originalCommands = new Set(source.project.versionedEvents.map((event) => event.commandId))
  expect(
    copy.project.versionedEvents.every((event) => !originalCommands.has(event.commandId)),
  ).toBe(true)
  const originalTransactions = new Set(
    source.project.versionedEvents.flatMap((event) =>
      event.transactionId ? [event.transactionId] : [],
    ),
  )
  expect(
    copy.project.versionedEvents.every(
      (event) => event.transactionId === null || !originalTransactions.has(event.transactionId),
    ),
  ).toBe(true)
  expect(
    extrusionFeatureParametersV5Schema.parse(copy.project.snapshot.features[0]?.parameters),
  ).toMatchObject({ distance: { value: 13 }, secondDistance: { value: 7 }, reversed: true })
})
