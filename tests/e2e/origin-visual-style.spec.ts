import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { selectIdleOriginPlaneInViewport } from "./sketch-helpers"

type ScreenshotImage = {
  src: string
  width: number
  height: number
  decode: () => Promise<void>
}

type ScreenshotBrowser = {
  Image: new () => ScreenshotImage
  document: {
    createElement: (tag: "canvas") => {
      width: number
      height: number
      getContext: (type: "2d") => {
        drawImage: (image: ScreenshotImage, x: number, y: number) => void
        getImageData: (
          x: number,
          y: number,
          width: number,
          height: number,
        ) => {
          data: Uint8ClampedArray
        }
      } | null
    }
  }
}

async function planeOverlayContrast(page: Page, shown: Buffer, hidden: Buffer) {
  return page.evaluate(
    async ({ shown, hidden }) => {
      const browser = globalThis as unknown as ScreenshotBrowser
      const pixels = async (source: string) => {
        const image = new browser.Image()
        image.src = `data:image/png;base64,${source}`
        await image.decode()
        const canvas = browser.document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Screenshot comparison needs a 2D context.")
        context.drawImage(image, 0, 0)
        // Keep viewport chrome outside the plane-contrast sample.
        return context.getImageData(0, 80, image.width, image.height - 180).data
      }
      const [visible, background] = await Promise.all([pixels(shown), pixels(hidden)])
      let maximum = 0
      let total = 0
      let changed = 0
      for (let index = 0; index < visible.length; index += 4) {
        let difference = 0
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = Math.abs(
            (visible[index + channel] ?? 0) - (background[index + channel] ?? 0),
          )
          maximum = Math.max(maximum, delta)
          difference += delta
        }
        total += difference
        if (difference > 3) changed += 1
      }
      return {
        maximum,
        mean: total / ((visible.length / 4) * 3),
        coverage: changed / (visible.length / 4),
      }
    },
    { shown: shown.toString("base64"), hidden: hidden.toString("base64") },
  )
}

for (const theme of ["light", "dark"] as const) {
  test(`keeps idle origin planes restrained and selectable in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), theme === "dark")
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(
      viewport.getByRole("group", { name: "Origin plane visibility", exact: true }),
    ).toHaveCount(0)
    const browser = page.getByRole("complementary", { name: "Model tree", exact: true })
    await browser.getByRole("treeitem", { name: "Planes", exact: true }).click()
    const canvas = viewport.locator("canvas")
    await expect(viewport).toHaveAttribute("data-origin-plane-visibility", "xy,xz,yz")
    await page.mouse.move(1430, 10)
    const shown = await canvas.screenshot({ mask: [browser] })
    for (const plane of ["XY", "XZ", "YZ"] as const) {
      await browser.getByRole("button", { name: `Hide ${plane}`, exact: true }).click()
    }
    await expect(viewport).toHaveAttribute("data-origin-plane-visibility", "")
    await page.mouse.move(1430, 10)
    const contrast = await planeOverlayContrast(
      page,
      shown,
      await canvas.screenshot({ mask: [browser] }),
    )
    expect(
      contrast.coverage,
      "Visible datums must still differ from the empty background.",
    ).toBeGreaterThan(0.05)
    expect(
      contrast.mean,
      "Idle datums must not wash the working area in saturated color.",
    ).toBeLessThan(12)
    expect(contrast.maximum, "Idle plane borders must remain translucent.").toBeLessThan(100)
    await page.screenshot({ path: test.info().outputPath(`hidden-planes-${theme}.png`) })

    for (const plane of ["XY", "XZ", "YZ"] as const) {
      const show = browser.getByRole("button", { name: `Show ${plane}`, exact: true })
      await show.focus()
      await page.keyboard.press("Space")
      await expect(
        browser.getByRole("button", { name: `Hide ${plane}`, exact: true }),
      ).toHaveAttribute("aria-pressed", "true")
    }
    await expect(viewport.getByRole("img", { name: "World axes" })).toBeVisible()
    await selectIdleOriginPlaneInViewport(page, "xz")
    await expect(page.locator("main footer:visible")).toContainText("Selection: XZ plane")
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    await expect(
      page.getByRole("group", { name: "Origin plane visibility", exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("xz")
    await page.screenshot({ path: test.info().outputPath(`selected-plane-sketch-${theme}.png`) })
  })
}
