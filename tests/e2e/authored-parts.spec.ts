import type { Locator, Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("uses uniform browser rows and keeps full-row selection visible beneath child controls", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await createSolids(page)
  await invokeModelCommand(page, "Create", "Datum plane")
  const form = page.getByRole("form", { name: "Create datum plane", exact: true })
  await form.getByRole("button", { name: "Create datum plane", exact: true }).click()
  await saved(page)
  const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
  const origin = tree.getByRole("treeitem", { name: "XY", exact: true })
  const datum = tree.getByRole("treeitem", { name: "Datum plane 1", exact: true })
  const part = tree.getByRole("treeitem", { name: "Part Box 1", exact: true })
  const rowMetrics = (locator: Locator) =>
    locator.evaluate((element) => {
      const browser = element.ownerDocument.defaultView
      if (!browser) throw new Error("Expected the model browser window.")
      return {
        height: element.getBoundingClientRect().height,
        fontSize: browser.getComputedStyle(element).fontSize,
        iconSize: element.querySelector("svg")?.getBoundingClientRect().width,
        iconX: element.querySelector("svg")?.getBoundingClientRect().left,
      }
    })
  expect(await rowMetrics(datum)).toEqual(await rowMetrics(origin))
  expect(await rowMetrics(part)).toEqual(await rowMetrics(origin))
  for (const theme of ["Light", "Dark"]) {
    await setTheme(page, theme)
    await part.click()
    await part.hover()
    await expect(part).toHaveAttribute("aria-selected", "true")
    const presentation = await part.evaluate((button) => {
      const row = button.parentElement
      if (!row) throw new Error("Expected an owning browser row.")
      const browser = button.ownerDocument.defaultView
      if (!browser) throw new Error("Expected the model browser window.")
      const overlay = browser.getComputedStyle(row, "::after")
      return {
        background: browser.getComputedStyle(row).backgroundColor,
        labelBackground: browser.getComputedStyle(button).backgroundColor,
        overlayInset: [overlay.top, overlay.right, overlay.bottom, overlay.left],
        overlayShadow: overlay.boxShadow,
        pointerEvents: overlay.pointerEvents,
      }
    })
    expect(presentation.background).not.toBe("rgba(0, 0, 0, 0)")
    expect(presentation.labelBackground).toBe("rgba(0, 0, 0, 0)")
    expect(presentation.overlayInset).toEqual(["0px", "0px", "0px", "0px"])
    expect(presentation.overlayShadow).not.toBe("none")
    expect(presentation.pointerEvents).toBe("none")
    await tree.screenshot({
      path: test.info().outputPath(`browser-rows-${theme.toLowerCase()}.png`),
    })
    await tree.getByRole("button", { name: "Rename part Box 1", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Rename item", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
  }
})

async function setTheme(page: Page, theme: string) {
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
  await page.getByRole("option", { name: theme, exact: true }).click()
  await settings.getByRole("button", { name: "Done", exact: true }).click()
}

test("reports a visibility save failure without moving model browser rows", async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(`(() => {
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === "readwrite" && Reflect.get(globalThis, "rejectMetadataSave")) {
        throw new DOMException("The fixture rejected the metadata save.", "QuotaExceededError")
      }
      return Reflect.apply(transaction, this, args)
    }
  })()`)
  await page.goto("/")
  await createSolids(page)
  await page.evaluate('Reflect.set(globalThis, "rejectMetadataSave", true)')
  const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
  const box = tree.getByRole("treeitem", { name: "Part Box 1", exact: true })
  const cylinder = tree.getByRole("treeitem", { name: "Part Cylinder 1", exact: true })
  const positions = [await box.boundingBox(), await cylinder.boundingBox()]
  await tree.getByRole("button", { name: /Hide.*Box 1/ }).click()
  const error = page.getByRole("alert").filter({ hasText: /Visibility.*could not be saved/ })
  await expect(error).toBeVisible()
  await expect(error).toContainText("Box 1")
  await page.evaluate('Reflect.set(globalThis, "rejectMetadataSave", false)')
  expect([await box.boundingBox(), await cylinder.boundingBox()]).toEqual(positions)
  await expect(tree.getByRole("alert")).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("visibility-error-stable-rows.png") })
  await error.getByRole("button", { name: "Dismiss notification", exact: true }).click()
  await expect(error).toHaveCount(0)
})

async function renameItem(page: Page, trigger: string, name: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Rename item", exact: true })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await saved(page)
}
async function createFolder(page: Page) {
  await page.getByRole("button", { name: "New folder", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New folder", exact: true })
  await dialog.getByRole("textbox", { name: "Folder name", exact: true }).fill("Assembly")
  await dialog.getByRole("combobox", { name: "Last History item", exact: true }).click()
  await page.getByRole("option", { name: "2. Cylinder 1", exact: true }).click()
  await dialog.getByRole("button", { name: "New folder", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Folder Assembly", exact: true })).toBeVisible()
  await saved(page)
}

test("keeps independently editable authored parts and folders through Undo, reload, and native Save/Open", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const parts = page.locator("[data-part-id]")
  await expect(parts).toHaveCount(2)
  const ids = await parts.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-part-id")),
  )
  await renameItem(page, "Rename part Box 1", "Housing")
  await page.getByRole("treeitem", { name: "Part Housing", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Part Housing", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await page.getByRole("button", { name: "Hide part Housing", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await createFolder(page)
  await renameItem(page, "Rename folder Assembly", "Fabrication")
  const folder = page.getByRole("treeitem", { name: "Folder Fabrication", exact: true })
  await page.getByRole("button", { name: "Edit items in Fabrication", exact: true }).click()
  const membership = page.getByRole("dialog", { name: "Items in Fabrication", exact: true })
  await membership.getByRole("combobox", { name: "Last History item", exact: true }).click()
  await page.getByRole("option", { name: "1. Box 1", exact: true }).click()
  await membership.getByRole("button", { name: "Save items", exact: true }).click()
  await expect(membership).not.toBeVisible()
  const narrowed = await saveProject(page)
  expect(narrowed.project.snapshot.folders[0]?.items).toEqual(
    narrowed.project.snapshot.history.slice(0, 1),
  )
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const beforeCollapse = await saveProject(page)
  await folder.click()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).not.toBeVisible()
  await folder.click()
  const source = await saveProject(page)
  expect(source.project.snapshot.revision).toBe(beforeCollapse.project.snapshot.revision)
  expect(source.project.snapshot.parts.map((part) => part.id)).toEqual(ids)
  expect(source.project.snapshot.parts.map(({ name, visible }) => ({ name, visible }))).toEqual([
    { name: "Housing", visible: false },
    { name: "Cylinder 1", visible: true },
  ])
  expect(source.project.snapshot.folders[0]?.items).toEqual(source.project.snapshot.history)
  await page.reload()
  await saved(page)
  await expect(page.getByRole("button", { name: "Show part Housing", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await openProject(page, source)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  const copy = await saveProject(page)
  expect(copy.project.snapshot.id).not.toBe(source.project.snapshot.id)
  expect(copy.project.snapshot.parts).toEqual(source.project.snapshot.parts)
  expect(copy.project.snapshot.folders).toEqual(source.project.snapshot.folders)
  await page.getByRole("button", { name: "Show part Housing", exact: true }).click()
  await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit box", exact: true })
  await edit.getByRole("combobox", { name: "Width", exact: true }).fill("27 mm")
  await edit.getByRole("button", { name: "Update box", exact: true }).click()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  expect(
    await parts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-part-id"))),
  ).toEqual(ids)
  await page.getByRole("button", { name: "Remove folder Fabrication", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Ungroup", exact: true }).click()
  await expect(folder).not.toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Cylinder 1", exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(folder).toBeVisible()
  for (const theme of ["Light", "Dark"]) {
    await setTheme(page, theme)
    await page.screenshot({
      path: test.info().outputPath(`authored-parts-native-${theme.toLowerCase()}.png`),
      animations: "disabled",
    })
  }
})

test("keeps authored folder controls usable in compact light and dark layouts", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  for (const width of [512, 390]) {
    await page.setViewportSize({ width, height: width === 512 ? 384 : 844 })
    const showTree = page.getByRole("button", { name: "Show model tree", exact: true })
    if (width === 512) await showTree.click()
    await expect(page.getByRole("button", { name: "Hide model tree", exact: true })).toBeVisible()
    for (const theme of ["Light", "Dark"]) {
      await setTheme(page, theme)
      await page.screenshot({
        path: test.info().outputPath(`authored-parts-${width}-${theme.toLowerCase()}.png`),
        animations: "disabled",
      })
      await page.getByRole("button", { name: "New folder", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "New folder", exact: true })
      await dialog.getByRole("textbox", { name: "Folder name", exact: true }).fill("Compact")
      const create = dialog.getByRole("button", { name: "New folder", exact: true })
      await create.scrollIntoViewIfNeeded()
      await expect(create).toBeInViewport({ ratio: 1 })
      await create.click({ trial: true })
      await page.screenshot({
        path: test.info().outputPath(`authored-folder-${width}-${theme.toLowerCase()}.png`),
        animations: "disabled",
      })
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    }
  }
  await expect(page.locator("[data-folder-id]")).toHaveCount(0)
  await expect(page.locator("[data-part-id]")).toHaveCount(2)
})
