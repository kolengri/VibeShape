import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

async function createBox(page: Page) {
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Box", exact: true }).click()
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
}

async function dragHistoryItem(page: Page, source: string, destination: string) {
  const sourceBounds = await page.getByRole("treeitem", { name: source, exact: true }).boundingBox()
  const targetBounds = await page
    .getByRole("treeitem", { name: destination, exact: true })
    .boundingBox()
  if (!sourceBounds || !targetBounds) throw new Error("History rows are not visible")
  await page.mouse.move(
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2,
    { steps: 15 },
  )
  await page.mouse.up()
}

test("reorders independent History items with undo, redo, and reload persistence", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await createBox(page)
  await createBox(page)

  const viewport = page.getByRole("region", { name: "3D viewport" })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  const featureRows = page.locator('[data-history-kind="feature"] [role="treeitem"]')
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await expect(featureRows).toHaveText(["Box 1", "Box 2"])

  await dragHistoryItem(page, "Box 2", "Box 1")
  await expect(page.getByText("Moved Box 2 to position 1", { exact: true })).toBeAttached()
  await expect(featureRows).toHaveText(["Box 2", "Box 1"])
  await expect(page.getByRole("form", { name: "Edit box" })).toHaveCount(0)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(featureRows).toHaveText(["Box 1", "Box 2"])
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(featureRows).toHaveText(["Box 2", "Box 1"])

  await page.reload()
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await expect(page.locator('[data-history-kind="feature"] [role="treeitem"]')).toHaveText([
    "Box 2",
    "Box 1",
  ])
  await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
    "data-rendered-feature-count",
    "2",
  )
})

test("reorders History by keyboard and cancels a second drag without changing the order", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await createBox(page)
  await createBox(page)
  const rows = page.locator('[data-history-kind="feature"] [role="treeitem"]')
  const row = page.getByRole("treeitem", { name: "Box 2", exact: true })
  await row.focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowUp")
  await expect(row).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByText("Moved Box 2 to position 1", { exact: true })).toBeAttached()
  await expect(rows).toHaveText(["Box 2", "Box 1"])
  await expect(row).toBeFocused()
  await expect(page.locator('[data-history-id][tabindex="0"]')).toHaveCount(0)
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Escape")
  await expect(rows).toHaveText(["Box 2", "Box 1"])
  await expect(row).toBeFocused()
  await expect(page.getByRole("form", { name: "Edit box" })).toHaveCount(0)
  await page.reload()
  await expect(rows).toHaveText(["Box 2", "Box 1"], { timeout: 30_000 })
  await row.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("form", { name: "Edit box" })).toBeVisible()
  await expect(page.locator('[data-history-id][aria-disabled="true"]')).toHaveCount(0)
})

test("keeps row clicks, small pointer movement, rename, and visibility independent of dragging", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await createBox(page)
  await createBox(page)
  const rows = page.locator('[data-history-kind="feature"] [role="treeitem"]')
  const row = page.getByRole("treeitem", { name: "Box 2", exact: true })
  await expect(page.getByRole("button", { name: "Reorder Box 2", exact: true })).toHaveCount(0)

  const visibility = page.getByRole("button", { name: "Hide Box 2", exact: true })
  const control = await visibility.boundingBox()
  if (!control) throw new Error("Expected a visible visibility control")
  await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2)
  await page.mouse.down()
  await page.mouse.move(control.x + control.width / 2, control.y - 45, { steps: 8 })
  await page.mouse.up()
  await expect(rows).toHaveText(["Box 1", "Box 2"])
  await expect(page.getByText(/Picked up Box 2/)).toHaveCount(0)
  await visibility.click()
  await expect(page.getByRole("button", { name: "Show Box 2", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Rename Box 2", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Rename feature" })).toBeVisible()
  await page.keyboard.press("Escape")

  const bounds = await row.boundingBox()
  if (!bounds) throw new Error("Expected a visible History row")
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 2, y)
  await page.mouse.up()
  await expect(page.getByRole("form", { name: "Edit box" })).toBeVisible()
  await expect(rows).toHaveText(["Box 1", "Box 2"])
})

test("rejects moving a dependent feature before its source without leaving a visual reorder", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await createBox(page)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Fillet", exact: true })
    .click()
  const form = page.getByRole("form", { name: "Create fillet" })
  await form.getByRole("radio", { name: "All edges", exact: true }).check()
  await form.getByRole("button", { name: "Create fillet", exact: true }).click()
  const rows = page.locator('[data-history-kind="feature"] [role="treeitem"]')
  await expect(rows).toHaveText(["Box 1", "Fillet 1"])
  await dragHistoryItem(page, "Fillet 1", "Box 1")
  await expect(rows).toHaveText(["Box 1", "Fillet 1"])
  await page.getByRole("button", { name: "Move Fillet 1", exact: true }).click()
  await expect(
    page.getByRole("menuitem", { name: "Move Fillet 1 to position 1", exact: true }),
  ).toBeDisabled()
  await page.keyboard.press("Escape")
  await page.reload()
  await expect(rows).toHaveText(["Box 1", "Fillet 1"], { timeout: 30_000 })
})

test("reorders a History row after a touch long press", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch input uses the Chromium input protocol")
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await createBox(page)
  await createBox(page)
  const source = await page.getByRole("treeitem", { name: "Box 2", exact: true }).boundingBox()
  const target = await page.getByRole("treeitem", { name: "Box 1", exact: true }).boundingBox()
  if (!source || !target) throw new Error("Expected visible History rows")
  const client = await page.context().newCDPSession(page)
  const x = source.x + source.width / 2
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: source.y + source.height / 2 }],
  })
  await expect(page.getByText(/^(Picked up )?Box 2, position 2 of 2$/)).toBeAttached()
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: target.y + target.height / 2 }],
  })
  await expect(page.getByText("Box 2, position 1 of 2", { exact: true })).toBeAttached()
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect(page.locator('[data-history-kind="feature"] [role="treeitem"]')).toHaveText([
    "Box 2",
    "Box 1",
  ])
  await expect(page.getByRole("form", { name: "Edit box" })).toHaveCount(0)
  await client.detach()
})

test("opens searchable shortcut help and keeps modeling shortcuts out of dialogs", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page.keyboard.press("F1")
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true })
  await expect(dialog).toBeVisible()
  const search = dialog.getByRole("textbox", { name: "Search shortcuts…" })
  await search.fill("Extrude")
  await expect(dialog.getByText("Extrude", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Close keyboard shortcuts" }).focus()
  await page.keyboard.press("Shift+S")
  await expect(dialog).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Sketch task panel" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press("Shift+S")
  await expect(page.getByRole("complementary", { name: "Sketch task panel" })).toBeVisible()
})

test("transfers focus from command palette to shortcut help and back to a visible control", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("button", { name: "Commands", exact: true }).click()
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Keyboard shortcuts")
  await palette.getByRole("option", { name: /Keyboard shortcuts/ }).click()
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true })
  await expect(help.getByRole("textbox", { name: "Search shortcuts…" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(help).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Keyboard shortcuts", exact: true })).toBeFocused()
})
