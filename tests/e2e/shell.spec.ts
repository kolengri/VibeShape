import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import {
  confirmSketchPlane,
  drawRectangle,
  selectIdleOriginPlaneInViewport,
  selectOriginPlaneInViewport,
} from "./sketch-helpers"

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
    // Variables, Planes and Parts; the empty Sketches group stays hidden (#408).
    await expect(
      page.getByRole("tree", { name: "Project features", exact: true }).getByRole("treeitem"),
    ).toHaveCount(3)
    await expect(
      page
        .getByRole("tree", { name: "Feature history", exact: true })
        .getByRole("button", { name: "Details", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    // The idle onboarding panel is gone (#357); an active task opens the Task panel landmark.
    await expect(page.getByRole("complementary", { name: "Task panel" })).toHaveCount(0)
    await invokeModelCommand(page, "Primitives", "Box")
    await expect(
      page
        .getByRole("complementary", { name: "Task panel" })
        .getByRole("form", { name: "Create box", exact: true }),
    ).toBeVisible()
    await expect(
      page
        .locator("main footer")
        .filter({ has: page.getByRole("status").filter({ hasText: /^Selection: / }) }),
    ).toContainText("Ready")
  })

  test("orbits the 3D viewport with primary drag without accepting a sketch plane", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await page
      .getByRole("toolbar", { name: "Model commands", exact: true })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-origin-plane-selection", "xy")
    await expect(viewport.getByRole("img", { name: "World axes" })).toBeVisible()
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
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })

    const xzPick = await selectIdleOriginPlaneInViewport(page, "xz")
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(page.getByRole("status").filter({ hasText: /^Selection: / })).toContainText(
      "Selection: XZ plane",
    )
    // Per-plane visibility lives in the expanded Planes group of the model tree.
    const modelTree = page.getByRole("complementary", { name: "Model tree" })
    const planes = modelTree.getByRole("treeitem", { name: "Planes", exact: true })
    if ((await planes.getAttribute("aria-expanded")) !== "true") await planes.click()
    await modelTree.getByRole("button", { name: "Hide XZ", exact: true }).click()
    await expect(viewport).not.toHaveAttribute("data-origin-plane-selection")
    await page.mouse.click(xzPick.x, xzPick.y)
    await expect(viewport).not.toHaveAttribute("data-origin-plane-selection", "xz")
    await modelTree.getByRole("button", { name: "Show XZ", exact: true }).click()
    await selectIdleOriginPlaneInViewport(page, "xz")
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()

    await expect(page.getByRole("heading", { name: "Select a sketch plane" })).toHaveCount(0)
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("xz")

    await page.getByRole("button", { name: "Finish sketch" }).click()
    await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("xz")
  })

  test("zooms the 3D viewport toward the pointer", async ({ page }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box", exact: true })
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

    const lastHeaderButton = page
      .getByRole("group", { name: "Geometry workspace", exact: true })
      .getByRole("button", { name: "Assembly", exact: true })
    // Workspace switches left the toolbar; it starts with its creation commands.
    const createSketchButton = page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
    const extrudeButton = page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Extrude", exact: true })
    // Safari uses Option+Tab to include every control in keyboard navigation.
    const enterToolbar = browserName === "webkit" ? "Alt+Tab" : "Tab"

    await expect(lastHeaderButton).toBeEnabled()
    await lastHeaderButton.focus()
    await expect(lastHeaderButton).toBeFocused()
    await page.keyboard.press(enterToolbar)
    await expect(createSketchButton).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(extrudeButton).toBeFocused()
  })

  test("discovers and runs registered commands from the palette and shortcuts", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })

    const commandsButton = page.getByRole("button", { name: "Application menu" })
    await openApplicationMenuItem(page, "Commands Ctrl/Cmd+K")
    const palette = page.getByRole("dialog", { name: "Command palette" })
    await expect(palette).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(commandsButton).toBeFocused()

    await page.keyboard.press("Control+K")
    const search = page.getByRole("combobox", { name: "Search commands" })
    await search.fill("extrude")
    await expect(
      palette
        .getByRole("option", { name: /^Extrude / })
        .getByText("Select a closed sketch profile first."),
    ).toBeVisible()

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
    // Without the idle onboarding panel (#357), an active task owns the compact Task panel.
    await invokeModelCommand(page, "Primitives", "Box")
    const taskPanel = page.getByRole("complementary", { name: "Task panel" })
    await expect(taskPanel).toBeVisible()
    await page.getByRole("button", { name: "Collapse task panel" }).click()
    await expect(taskPanel).toBeHidden()
    await expect(page.getByRole("region", { name: "3D viewport" })).toBeVisible()
    await page.getByRole("button", { name: "Open task panel" }).click()
    await expect(taskPanel).toBeVisible()
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
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })

    await invokeModelCommand(page, "Primitives", "Box")
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

  test("keeps compact sketch creation on the canvas", async ({ page }) => {
    const reactStateWarnings: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Cannot update a component")) {
        reactStateWarnings.push(message.text())
      }
    })
    await page.setViewportSize({ width: 512, height: 360 })
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()
    await expect(page.getByRole("button", { name: "Open task panel" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Sketch task panel" })).toBeHidden()

    await selectOriginPlaneInViewport(page, "xy")
    const drawing = await drawRectangle(page)

    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    const precisionTrigger = page.getByRole("button", { name: /^Set exact Horizontal:/ })
    const precision = page.getByRole("form", { name: "Exact geometry value" })
    const openTaskPanel = page.getByRole("button", { name: "Open task panel" })
    await expect(precisionTrigger).toBeVisible()
    await expect(precision).toHaveCount(0)
    await expect(openTaskPanel).toBeVisible()
    await openTaskPanel.click()
    await expect(page.getByRole("complementary", { name: "Sketch task panel" })).toBeVisible()

    const precisionBounds = await precisionTrigger.boundingBox()
    if (!precisionBounds) throw new Error("The optional exact-value control is not visible.")
    expect(precisionBounds.x).toBeGreaterThanOrEqual(0)
    expect(precisionBounds.x + precisionBounds.width).toBeLessThanOrEqual(512)
    await precisionTrigger.click()
    const expression = precision.getByRole("combobox", { name: "Exact geometry expression" })
    await expression.fill("40 mm")
    await precision.getByRole("button", { name: "Apply dimension" }).click()
    await expect(precision.getByText("Vertical", { exact: true })).toBeVisible()
    await expression.fill("20 mm")
    await precision.getByRole("button", { name: "Apply dimension" }).click()
    await expect(precision).toHaveCount(0)
    expect(reactStateWarnings).toEqual([])
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
