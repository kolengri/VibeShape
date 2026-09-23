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
  const sourceBounds = await page
    .getByRole("button", { name: `Reorder ${source}`, exact: true })
    .boundingBox()
  const targetBounds = await page
    .getByRole("button", { name: `Reorder ${destination}`, exact: true })
    .boundingBox()
  if (!sourceBounds || !targetBounds) throw new Error("History grips are not visible")
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
  const grip = page.getByRole("button", { name: "Reorder Box 2", exact: true })
  await grip.focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Space")
  await expect(page.getByText("Moved Box 2 to position 1", { exact: true })).toBeAttached()
  await expect(rows).toHaveText(["Box 2", "Box 1"])
  await grip.focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Escape")
  await expect(rows).toHaveText(["Box 2", "Box 1"])
  await expect(page.getByRole("form", { name: "Edit box" })).toHaveCount(0)
  await page.reload()
  await expect(rows).toHaveText(["Box 2", "Box 1"], { timeout: 30_000 })
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
