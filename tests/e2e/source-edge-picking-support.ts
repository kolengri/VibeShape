import type { Page } from "@playwright/test"

/** Find a displayed CAD curve using the same hover feedback available to the user. */
export async function pickSourceEdge(page: Page) {
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const bounds = await viewport.locator("canvas").boundingBox()
  if (!bounds) throw new Error("Expected the source-edge picking canvas.")
  const status = viewport
    .getByRole("status")
    .filter({ hasText: /^Source edge: (?:.* · )?Edge \d+$/ })
  const limit = Math.min(360, Math.floor(Math.min(bounds.width, bounds.height) / 2))
  for (let radius = 4; radius < limit; radius += 4) {
    for (const [dx, dy] of [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius, radius],
      [-radius, radius],
      [radius, -radius],
      [-radius, -radius],
    ]) {
      const x = bounds.x + bounds.width / 2 + (dx ?? 0)
      const y = bounds.y + bounds.height / 2 + (dy ?? 0)
      await page.mouse.move(x, y)
      await page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
      if (!(await status.isVisible())) continue
      await page.mouse.click(x, y)
      const overlap = viewport.getByRole("listbox", { name: "Select other reference" })
      if (await overlap.isVisible()) await overlap.getByRole("option").first().click()
      return
    }
  }
  throw new Error("No displayed source edge was available to graphical selection.")
}
