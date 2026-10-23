import { expect, test } from "./fixtures"
import { expandHistoryDetails, invokeModelCommand } from "./model-command-support"

for (const theme of ["dark", "light"] as const) {
  test(`suppresses History hover while scrolling and rounds highlights in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 720 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    await page.locator("html").evaluate((element, theme) => {
      element.classList.toggle("dark", theme === "dark")
    }, theme)
    for (let index = 0; index < 5; index++) {
      await invokeModelCommand(page, "Primitives", "Box")
      await page
        .getByRole("form", { name: "Create box" })
        .getByRole("button", { name: "Create box", exact: true })
        .click()
    }
    await expandHistoryDetails(page)
    const history = page.getByRole("region", { name: "Feature history", exact: true })
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const track = history.locator("[data-history-track]")
    const firstRow = history.locator('[data-history-kind="feature"]').first()
    const firstId = await firstRow.getAttribute("data-history-id")
    if (!firstId) throw new Error("Expected a stable History feature identity")
    await track.evaluate((element) => {
      element.scrollLeft = 0
    })
    await page.waitForTimeout(200)
    await firstRow.getByRole("treeitem").hover()
    await expect(viewport).toHaveAttribute("data-preselected-feature", firstId)
    await expect(firstRow).toHaveAttribute("data-history-source-highlighted", "true")
    expect(
      await firstRow.evaluate((element) =>
        Number.parseFloat(
          element.ownerDocument.defaultView?.getComputedStyle(element).borderTopLeftRadius ?? "0",
        ),
      ),
    ).toBeGreaterThan(0)

    await page.mouse.wheel(500, 0)
    await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await expect(viewport).not.toHaveAttribute("data-preselected-feature")
    await page.waitForTimeout(400)
    await expect(viewport).not.toHaveAttribute("data-preselected-feature")

    const fourthRow = history.locator('[data-history-kind="feature"]').nth(3)
    const fourthId = await fourthRow.getAttribute("data-history-id")
    if (!fourthId) throw new Error("Expected the fourth History feature")
    await fourthRow.getByRole("treeitem").hover()
    await expect(viewport).toHaveAttribute("data-preselected-feature", fourthId)
    await page.getByRole("button", { name: "Application menu", exact: true }).hover()
    await expect(viewport).not.toHaveAttribute("data-preselected-feature")
    await fourthRow.getByRole("treeitem").focus()
    await expect(viewport).toHaveAttribute("data-preselected-feature", fourthId)

    await fourthRow.getByRole("treeitem").click({ modifiers: ["ControlOrMeta"] })
    const selected = history.locator('[data-folder-selected="true"]').first()
    await expect(selected).toBeVisible()
    expect(
      await selected.evaluate((element) =>
        Number.parseFloat(
          element.ownerDocument.defaultView?.getComputedStyle(element).borderTopLeftRadius ?? "0",
        ),
      ),
    ).toBeGreaterThan(0)
    await history.screenshot({ path: `artifacts/history-hover/history-${theme}.png` })
    const details = history.getByRole("button", { name: "Details", exact: true })
    await details.click()
    await expect(details).toHaveAttribute("aria-expanded", "false")
    expect(
      await selected.evaluate((element) =>
        Number.parseFloat(
          element.ownerDocument.defaultView?.getComputedStyle(element).borderTopLeftRadius ?? "0",
        ),
      ),
    ).toBeGreaterThan(0)
  })
}
