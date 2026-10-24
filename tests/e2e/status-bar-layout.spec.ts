import { expect, test } from "./fixtures"

for (const theme of ["light", "dark"] as const) {
  test(`keeps the status bar flush with the window in ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript((theme) => {
      localStorage.setItem(
        "vibeshape.viewer-preferences.v1",
        JSON.stringify({
          version: 1,
          theme,
          autoHideConsumedSketches: true,
          preferredExportFormat: "3mf",
        }),
      )
    }, theme)
    await page.goto("/")
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/)
    const footer = page.locator(".editor-workbench > footer")
    await expect(footer).toBeVisible()

    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 720 },
      { width: 720, height: 450 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size)
      await expect
        .poll(() =>
          footer.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return {
              left: bounds.left,
              right: bounds.right,
              bottom: bounds.bottom,
              scrollWidth: element.ownerDocument.documentElement.scrollWidth,
            }
          }),
        )
        .toEqual({ left: 0, right: size.width, bottom: size.height, scrollWidth: size.width })
      if (size.width === 1440) {
        await page.screenshot({ path: `artifacts/status-bar-window-gaps/${theme}.png` })
      }
    }
  })
}
