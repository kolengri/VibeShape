import type { Locator, Page, TestInfo } from "@playwright/test"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { expandHistoryDetails, invokeModelCommand } from "./model-command-support"

async function createBoxes(page: Page) {
  for (let index = 0; index < 3; index += 1) {
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    await form.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(form).toHaveCount(0)
    await saved(page)
  }
}
async function elementEvidence(element: Locator, attributes: readonly string[]) {
  if ((await element.count()) === 0) return null
  const [rect, values] = await Promise.all([
    element.boundingBox(),
    Promise.all(attributes.map((attribute) => element.getAttribute(attribute))),
  ])
  return {
    rect,
    attributes: Object.fromEntries(
      attributes.map((attribute, index) => [attribute, values[index]]),
    ),
  }
}
async function evidence(page: Page, info: TestInfo, name: string) {
  const rows = await page.locator("[data-history-index]").all()
  const [cursor, track, observedRows, statuses, geometry] = await Promise.all([
    elementEvidence(page.locator("[data-history-cursor]"), [
      "aria-valuenow",
      "aria-valuetext",
      "aria-disabled",
      "aria-busy",
      "data-history-cursor-draft",
      "style",
    ]),
    elementEvidence(page.locator("[data-history-track]"), ["style"]),
    Promise.all(
      rows.map((row) =>
        elementEvidence(row, [
          "data-history-index",
          "data-history-id",
          "data-history-kind",
          "data-history-rolled-back",
          "style",
        ]),
      ),
    ),
    page.getByRole("status").allTextContents(),
    page
      .getByRole("region", { name: "3D viewport", exact: true })
      .getAttribute("data-rendered-feature-count"),
  ])
  const value = { url: page.url(), cursor, track, rows: observedRows, statuses, geometry }
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: "application/json" })
  return value
}
async function boundaryCoordinate(rows: Locator, position: number) {
  const boxes = await Promise.all((await rows.all()).map((row) => row.boundingBox()))
  const before = boxes[position - 1]
  const after = boxes[position]
  if (before && after) return (before.x + before.width + after.x) / 2
  if (before) return before.x + before.width
  if (after) return after.x
  throw new Error("The requested boundary requires a visible operation.")
}
async function dragDivider(page: Page, position: number, cancel = false) {
  const cursor = page.getByRole("separator", { name: "History rollback divider", exact: true })
  await expect(cursor).toHaveAttribute("aria-disabled", "false")
  const handle = await cursor.boundingBox()
  if (!handle || handle.height <= 0)
    throw new Error("The rollback divider must have a real pointer hit area.")
  const target = await boundaryCoordinate(page.locator("[data-history-index]"), position)
  await page.mouse.move(handle.x + handle.width / 2, handle.y + Math.min(12, handle.height / 2))
  await page.mouse.down()
  await page.mouse.move(target, handle.y + Math.min(12, handle.height / 2), { steps: 12 })
  if (cancel) await page.keyboard.press("Escape")
  await page.mouse.up()
}
async function reorder(page: Page, source: string, target: string) {
  const from = await page.getByRole("treeitem", { name: source, exact: true }).boundingBox()
  const to = await page.getByRole("treeitem", { name: target, exact: true }).boundingBox()
  if (!from || !to) throw new Error("History reorder requires visible rows.")
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
  await page.mouse.up()
}
for (const detailed of [false, true])
  test(`keeps the rollback divider working after reordering during History traversal (${detailed ? "Details" : "compact"})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    const consoleMessages: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        consoleMessages.push(`${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.stack}`))
    await page.goto("/")
    await saved(page)
    await createBoxes(page)
    const original = await saveProject(page)
    const ids = original.project.snapshot.features.map(({ id }) => id).sort()
    if (detailed) await expandHistoryDetails(page)
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const cursor = page.getByRole("separator", { name: "History rollback divider", exact: true })
    try {
      await expect(cursor).toHaveAttribute("aria-valuenow", "3")
      await page.getByRole("button", { name: "Step back one item", exact: true }).click()
      await expect(cursor).toHaveAttribute("aria-valuenow", "2")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
      await evidence(page, info, "before-reorder")
      await reorder(page, "Box 2", "Box 1")
      await saved(page)
      await expect(page.locator('[data-history-index="0"]')).toHaveAttribute(
        "data-history-id",
        original.project.snapshot.features[1]?.id ?? "missing",
      )
      await evidence(page, info, "after-reorder-before-divider")
      await dragDivider(page, 2)
      await evidence(page, info, "after-middle-divider-release")
      await expect(cursor).toHaveAttribute("aria-valuenow", "2")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
      await dragDivider(page, 0)
      await expect(cursor).toHaveAttribute("aria-valuenow", "0")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
      await dragDivider(page, 3)
      await expect(cursor).toHaveAttribute("aria-valuenow", "3")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
      await cursor.focus()
      await page.keyboard.press("Home")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
      await page.keyboard.press("ArrowRight")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
      await page.keyboard.press("End")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
      await dragDivider(page, 0, true)
      await expect(cursor).toHaveAttribute("aria-valuenow", "3")
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
      await invokeModelCommand(page, "Primitives", "Box")
      const invalid = page.getByRole("form", { name: "Create box", exact: true })
      await invalid.getByRole("combobox", { name: "Width", exact: true }).fill("0 mm")
      await dragDivider(page, 0)
      await expect(
        page.getByText("Could not move through History. Resolve the active edit and try again.", {
          exact: true,
        }),
      ).toBeVisible()
      await expect(cursor).toHaveAttribute("aria-valuenow", "3")
      await expect(invalid.getByRole("combobox", { name: "Width", exact: true })).toHaveValue(
        "0 mm",
      )
      await invalid.getByRole("button", { name: "Cancel", exact: true }).click()
      const after = await saveProject(page)
      expect(after.project.snapshot.features.map(({ id }) => id).sort()).toEqual(ids)
      expect(after.project.snapshot.revision).toBe(original.project.snapshot.revision + 1)
    } finally {
      await evidence(page, info, "final-divider-state")
      await info.attach("browser-console", {
        body: consoleMessages.join("\n"),
        contentType: "text/plain",
      })
    }
  })

test("keeps the divider and transport read-only when another tab owns the project", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  await createBoxes(page)
  const other = await page.context().newPage()
  try {
    await other.goto(page.url())
    await saved(other)
    const viewport = other.getByRole("region", { name: "3D viewport", exact: true })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
    await other.getByRole("button", { name: "Application menu", exact: true }).click()
    await expect(
      other.getByRole("menuitem", { name: "Rename project", exact: true }),
    ).toBeDisabled()
    await other.keyboard.press("Escape")
    const activeTab = other
      .getByRole("navigation", { name: "Open projects", exact: true })
      .getByRole("tab", { name: "Untitled project", exact: true, selected: true })
    await activeTab.dblclick()
    await activeTab.press("F2")
    await expect(other.getByRole("dialog", { name: "Rename project", exact: true })).toHaveCount(0)
    const divider = other.getByRole("separator", { name: "History rollback divider", exact: true })
    await expect(divider).toHaveAttribute("aria-disabled", "true")
    const handle = await divider.boundingBox()
    const first = await other.locator('[data-history-index="0"]').boundingBox()
    if (!handle || !first)
      throw new Error("The read-only History requires a visible divider and rows.")
    await other.mouse.move(handle.x + handle.width / 2, handle.y + 12)
    await other.mouse.down()
    await other.mouse.move(first.x, handle.y + 12, { steps: 8 })
    await other.mouse.up()
    await divider.focus()
    await other.keyboard.press("Home")
    await expect(divider).toHaveAttribute("aria-valuenow", "3")
    await expect(
      other.getByRole("button", { name: "Step back one item", exact: true }),
    ).toBeDisabled()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
  } finally {
    await other.close()
  }
})
