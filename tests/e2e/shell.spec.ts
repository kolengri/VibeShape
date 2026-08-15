import { expect, test } from "./fixtures"

test.describe("foundation CAD shell", () => {
  test("renders the localized landmark structure", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByRole("main")).toBeVisible()
    await expect(page.getByText("VibeShape", { exact: true })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr")
    await expect(page.getByRole("toolbar", { name: "Model commands" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Model tree" })).toBeVisible()
    await expect(page.getByRole("tree", { name: "Project features" })).toBeVisible()
    await expect(page.getByRole("treeitem")).toHaveCount(5)
    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Task panel" })).toBeVisible()
    await expect(page.locator("footer[role='status']")).toContainText("Ready")
  })

  test("keeps primary commands in a predictable keyboard order", async ({ browserName, page }) => {
    await page.goto("/")

    const exportButton = page.getByRole("button", { name: "Export…" })
    const modelButton = page.getByRole("button", { name: "Model", exact: true })
    const sketchButton = page.getByRole("button", { name: "Sketch", exact: true })
    // Safari uses Option+Tab to include every control in keyboard navigation.
    const enterToolbar = browserName === "webkit" ? "Alt+Tab" : "Tab"

    await exportButton.focus()
    await expect(exportButton).toBeFocused()
    await page.keyboard.press(enterToolbar)
    await expect(modelButton).toBeFocused()
    await expect(modelButton).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("ArrowRight")
    await expect(sketchButton).toBeFocused()
  })

  test("preserves the modeling viewport in the compact desktop layout", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto("/")

    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Task panel" })).toBeHidden()
    await expect
      .poll(() =>
        page.evaluate<boolean>(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
      )
      .toBe(true)
  })

  test("boots without external network requests", async ({ page }) => {
    const externalRequests: string[] = []

    page.on("request", (request) => {
      const requestUrl = new URL(request.url())

      if (requestUrl.hostname !== "127.0.0.1") {
        externalRequests.push(request.url())
      }
    })

    await page.goto("/")
    await expect(page.getByRole("main")).toBeVisible()
    expect(externalRequests, "The local-first shell must not contact external origins").toEqual([])
  })
})
