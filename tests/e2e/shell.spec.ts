import { expect, test } from "./fixtures"
import { confirmSketchPlane, selectIdleOriginPlaneInViewport } from "./sketch-helpers"

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
    await expect(page.getByRole("treeitem")).toHaveCount(4)
    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Task panel" })).toBeVisible()
    await expect(page.locator("footer[role='status']")).toContainText("Ready")
  })

  test("orbits the 3D viewport with primary drag without accepting a sketch plane", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-origin-plane-selection", "xy")
    await expect(viewport.getByRole("img", { name: "World axes" })).toBeVisible()
    await expect(viewport.getByText("XYZ · mm", { exact: true })).toBeVisible()
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The 3D viewport canvas is not visible.")
    const before = await canvas.screenshot()

    await page.mouse.move(bounds.x + bounds.width * 0.18, bounds.y + bounds.height * 0.07)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.07, {
      steps: 8,
    })
    await page.mouse.up()

    await expect(page.getByRole("heading", { name: "Select a sketch plane" })).toBeVisible()
    await expect(viewport).not.toHaveAttribute("data-origin-plane-preselection")
    const after = await canvas.screenshot()
    expect(after.equals(before), "Primary drag must change the rendered camera view.").toBe(false)
  })

  test("starts and reopens a sketch directly from an origin plane selected in 3D", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const xzPick = await selectIdleOriginPlaneInViewport(page, "xz")
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(page.locator("footer[role='status']")).toContainText("Selection: XZ plane")
    await viewport.getByRole("button", { name: "Hide XZ plane" }).click()
    await expect(viewport).not.toHaveAttribute("data-origin-plane-selection")
    await page.mouse.click(xzPick.x, xzPick.y)
    await expect(viewport).not.toHaveAttribute("data-origin-plane-selection", "xz")
    await viewport.getByRole("button", { name: "Show XZ plane" }).click()
    await selectIdleOriginPlaneInViewport(page, "xz")
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch" })
      .click()

    await expect(page.getByRole("heading", { name: "Select a sketch plane" })).toHaveCount(0)
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("xz")

    await page.getByRole("button", { name: "Finish sketch" }).click()
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("xz")
  })

  test("zooms the 3D viewport toward the pointer", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The 3D viewport canvas is not visible.")
    const fit = viewport.getByRole("button", { name: "Fit view" })
    const zoomAt = async (horizontal: number) => {
      await fit.click()
      await page.mouse.move(bounds.x + bounds.width * horizontal, bounds.y + bounds.height * 0.5)
      await page.mouse.wheel(0, -400)
      return canvas.screenshot()
    }

    const leftZoom = await zoomAt(0.15)
    const rightZoom = await zoomAt(0.85)

    expect(
      rightZoom.equals(leftZoom),
      "The wheel position must change the camera target after the same fitted view.",
    ).toBe(false)
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

  test("discovers and runs registered commands from the palette and shortcuts", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const commandsButton = page.getByRole("button", { name: "Commands" })
    await commandsButton.click()
    const palette = page.getByRole("dialog", { name: "Command palette" })
    await expect(palette).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(commandsButton).toBeFocused()

    await page.keyboard.press("Control+K")
    const search = page.getByRole("combobox", { name: "Search commands" })
    await search.fill("extrude")
    await expect(page.getByText("Select a closed sketch profile first.")).toBeVisible()

    await search.fill("new sketch")
    await palette.getByText("Create sketch", { exact: true }).click()
    await expect(page.getByRole("heading", { name: "Select a sketch plane" })).toBeVisible()
    await confirmSketchPlane(page)
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()

    await page.keyboard.press("r")
    await expect(
      page.getByRole("button", { name: "Center rectangle", exact: true }),
    ).toHaveAttribute("aria-pressed", "true")

    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeHidden()
  })

  test("preserves the modeling viewport in the compact desktop layout", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto("/")

    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Task panel" })).toBeHidden()
    await expect(page.getByRole("button", { name: "Open task panel" })).toBeVisible()
    await page.getByRole("button", { name: "Open task panel" }).click()
    await expect(page.getByRole("complementary", { name: "Task panel" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Collapse task panel" })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate<boolean>(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
      )
      .toBe(true)
  })

  test("keeps an active task form reachable and mounted at 200 percent zoom", async ({ page }) => {
    await page.setViewportSize({ width: 512, height: 360 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const form = page.getByRole("form", { name: "Create box" })
    const width = form.getByRole("combobox", { name: "Width" })
    await expect(form).toBeVisible()
    await expect(form.getByRole("button", { name: "Cancel" })).toBeVisible()
    await width.fill("42 mm")

    await page.getByRole("button", { name: "Collapse task panel" }).click()
    await expect(form).toBeHidden()
    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    await page.getByRole("button", { name: "Open task panel" }).click()

    await expect(form).toBeVisible()
    await expect(width).toHaveValue("42 mm")
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
