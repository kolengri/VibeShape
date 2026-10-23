import type { Locator, Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("opens model toolbar categories through named icon buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  const toolbar = page.getByRole("toolbar", { name: "Model commands", exact: true })
  await expect(toolbar.getByRole("button", { name: "Create sketch", exact: true })).toHaveText("")
  for (const label of ["Modify", "Primitives"]) {
    const trigger = page.getByRole("button", { name: label, exact: true })
    await expect(trigger).toHaveText("")
    await expect(trigger.locator('svg:not([data-slot="button-dropdown-indicator"])')).toHaveCount(1)
    await expect(trigger).toHaveAttribute("aria-haspopup", /^(menu|dialog)$/)
    await trigger.click()
    await expect(
      page.getByRole("menu").or(page.getByRole("dialog", { name: label, exact: true })),
    ).toBeVisible()
    await page.keyboard.press("Escape")
  }
})

async function expectDesktopChatBounds({
  page,
  draft,
  bounds,
  before,
  regions,
  width,
}: {
  page: Page
  draft: Locator
  bounds: { x: number; y: number; width: number; height: number }
  before: ({ x: number; y: number; width: number; height: number } | null)[]
  regions: Locator[]
  width: number
}) {
  const toolbar = before[1]
  if (!toolbar) throw new Error("Toolbar must be measurable")
  expect(bounds.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height)
  const history = await page.locator("[data-feature-timeline]").boundingBox()
  if (!history) throw new Error("History must be measurable")
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(history.y)
  for (const index of [1, 2]) {
    await expect.poll(() => regions[index]?.boundingBox()).toEqual(before[index])
  }
  if (width >= 1024) {
    await expect(page.locator("#workspace-task")).toHaveAttribute("data-viewport-area", "right")
    const originalTask = before[3]
    if (!originalTask) throw new Error("Task must be measurable")
    const task = await regions[3]?.boundingBox()
    if (!task) throw new Error("Task must remain measurable beside chat")
    expect(task.y).toBe(originalTask.y)
    expect(task.width).toBeGreaterThanOrEqual(280)
    expect(task.width).toBeLessThanOrEqual(originalTask.width)
    expect(task.height).toBeLessThanOrEqual(450)
    const inputHeight = await draft.evaluate((element) => element.getBoundingClientRect().height)
    expect(inputHeight).toBeLessThanOrEqual(28)
  }
}

for (const width of [512, 800, 1024, 1440]) {
  test(`overlays AI chat without resizing the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    const draft = form.getByRole("combobox", { name: "Width", exact: true })
    await draft.fill("77")
    const canvas = page.locator(".workspace-viewport canvas").first()
    const originalCanvas = await canvas.elementHandle()
    const regions = [
      canvas,
      page.locator("nav[data-sketch-mode]"),
      page.locator("[data-feature-timeline]"),
      page.locator(".workspace-panel--task"),
    ]
    const before = await Promise.all(regions.map((region) => region.boundingBox()))
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
    const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
    await expect(chat).toBeVisible()
    expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
      true,
    )
    await expect.poll(() => canvas.boundingBox()).toEqual(before[0])
    for (const region of regions.slice(1)) {
      await expect
        .poll(async () => {
          const a = await region.boundingBox()
          const b = await chat.boundingBox()
          return Boolean(
            a &&
              b &&
              (a.x + a.width <= b.x ||
                b.x + b.width <= a.x ||
                a.y + a.height <= b.y ||
                b.y + b.height <= a.y),
          )
        })
        .toBe(true)
    }
    await expect(draft).toHaveValue("77")
    const bounds = await chat.boundingBox()
    if (!bounds) throw new Error("Chat must have measurable bounds")
    expect(bounds.x + bounds.width).toBe(width - 8)
    if (width >= 640) {
      await expectDesktopChatBounds({ page, draft, bounds, before, regions, width })
    } else {
      const task = await page.locator(".workspace-panel--task").boundingBox()
      if (!task) throw new Error("The task must remain measurable above chat")
      expect(bounds.y).toBeGreaterThanOrEqual(task.y + task.height)
    }
    expect(
      await chat.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return element.contains(
          element.ownerDocument.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ),
        )
      }),
    ).toBe(true)
    if (width === 1440)
      await page.screenshot({ path: test.info().outputPath("chat-over-viewport.png") })
    await chat.getByRole("button", { name: "Collapse AI chat", exact: true }).click()
    await expect(chat).toHaveCount(0)
    await expect(draft).toHaveValue("77")
    await expect
      .poll(() => Promise.all(regions.map((region) => region.boundingBox())))
      .toEqual(before)
  })
}

for (const theme of ["light", "dark"]) {
  test(`fills the editor behind floating tools in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await page.locator("html").evaluate((element, theme) => {
      element.classList.toggle("dark", theme === "dark")
    }, theme)
    const canvas = page.locator(".workspace-viewport canvas").first()
    const header = page.locator(".application-bar")
    const footer = page.locator(".editor-workbench > footer")
    const bounds = await canvas.boundingBox()
    const headerBounds = await header.boundingBox()
    const footerBounds = await footer.boundingBox()
    if (!bounds || !headerBounds || !footerBounds) throw new Error("Editor must be measurable.")
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(1440)
    expect(bounds.y).toBe(headerBounds.y + headerBounds.height)
    expect(bounds.y + bounds.height).toBe(footerBounds.y)
    const toolbar = page.locator("nav[data-sketch-mode]")
    const toolbarBounds = await toolbar.boundingBox()
    if (!toolbarBounds) throw new Error("Toolbar must be measurable.")
    // The gap above the toolbar is rendered by the same interactive canvas.
    expect(
      await page
        .locator("html")
        .evaluate((element, { x, y }) => element.ownerDocument.elementFromPoint(x, y)?.tagName, {
          x: 720,
          y: toolbarBounds.y - 4,
        }),
    ).toBe("CANVAS")
    await page.screenshot({ path: test.info().outputPath(`floating-workspace-${theme}.png`) })
  })
}

test("shows Thinking by the composer with the wordmark shimmer and respects reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const endpoint = "https://thinking.example.test/v1/chat/completions"
  let pending: Route | undefined
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
    } else pending = route
  })
  await page.goto("/")
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
  await chat.getByRole("button", { name: "AI settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "AI settings", exact: true })
  await settings.getByRole("combobox", { name: "Provider", exact: true }).click()
  await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
  await settings
    .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
    .fill(endpoint)
  await settings.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
  await settings
    .getByRole("button", { name: "Connect and enable project access", exact: true })
    .click()
  await expect(settings).toBeHidden()
  await chat.getByRole("textbox", { name: "Message", exact: true }).fill("Describe the project")
  await chat.getByRole("button", { name: "Send", exact: true }).click()
  const thinking = chat.getByRole("status").filter({ hasText: /^Thinking$/ })
  await expect(thinking).toBeVisible()
  await expect(thinking.locator("svg")).toHaveCount(1)
  await expect(chat.getByRole("heading", { name: "AI chat", exact: true })).toBeVisible()
  await expect(thinking.locator("span")).toHaveCSS("animation-name", "application-print")
  const thinkingBounds = await thinking.boundingBox()
  const composerBounds = await chat
    .getByRole("region", { name: "Message", exact: true })
    .boundingBox()
  if (!thinkingBounds || !composerBounds) throw new Error("Thinking and composer must be visible.")
  expect(thinkingBounds.y + thinkingBounds.height).toBeLessThanOrEqual(composerBounds.y + 1)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(thinking.locator("span")).toHaveCSS("animation-name", "none")
  if (!pending) throw new Error("The fixture model request must be pending.")
  await pending.fulfill({
    status: 200,
    headers,
    contentType: "application/json",
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: Array.from(
              { length: 40 },
              (_, i) =>
                `Review note ${i + 1}: Keep the lid removable and preserve the wall thickness.`,
            ).join("\n\n"),
          },
          finish_reason: "stop",
        },
      ],
    }),
  })
  await expect(thinking).toHaveCount(0)
  const log = chat.getByRole("log")
  await expect(log).toContainText("Review note 40")
  expect(await log.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(300)
  const canvas = page.locator(".workspace-viewport canvas").first()
  const canvasBounds = await canvas.boundingBox()
  const composer = chat.getByRole("region", { name: "Message", exact: true })
  const composerBoundsAfterReply = await composer.boundingBox()
  for (let reopen = 0; reopen < 3; reopen += 1) {
    await chat.getByRole("button", { name: "Collapse AI chat", exact: true }).click()
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
    await expect(log).toContainText("Review note 40")
    expect(await canvas.boundingBox()).toEqual(canvasBounds)
    expect(await composer.boundingBox()).toEqual(composerBoundsAfterReply)
    expect(
      await page.locator("html").evaluate((element) => {
        const browser = element.ownerDocument.defaultView
        if (!browser) throw new Error("The editor must have a browser window")
        return {
          y: browser.scrollY,
          documentOverflow: element.scrollHeight > browser.innerHeight,
          shellScroll: element.ownerDocument.querySelector(".cad-shell")?.scrollTop,
        }
      }),
    ).toEqual({ y: 0, documentOverflow: false, shellScroll: 0 })
  }
  await log.hover()
  await page.mouse.wheel(0, 5000)
  expect(
    await page.locator("html").evaluate((element) => element.ownerDocument.defaultView?.scrollY),
  ).toBe(0)
  await page.screenshot({ path: test.info().outputPath("chat-long-transcript-contained.png") })
})

for (const theme of ["light", "dark"]) {
  test(`keeps the fixed task header transparent without body overlap in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    await page.locator("html").evaluate((element, theme) => {
      element.classList.toggle("dark", theme === "dark")
    }, theme)
    const form = page.getByRole("form", { name: "Create box", exact: true })
    const header = form.locator("header")
    await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.locator("#workspace-task")).toHaveAttribute("data-viewport-area", "bottom")
    await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(page.locator(".workspace-panel--task")).not.toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    )
    const body = form.locator('[data-slot="task-panel-content"]')
    let headerBounds = await header.boundingBox()
    const bodyBounds = await body.boundingBox()
    if (!headerBounds || !bodyBounds) throw new Error("Task header and body must have bounds.")
    expect(bodyBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height)
    await body.evaluate((element) => {
      const extra = element.ownerDocument.createElement("div")
      extra.style.height = "1200px"
      extra.textContent = "Additional parameter rows"
      element.append(extra)
    })
    await expect
      .poll(() =>
        page
          .locator(".workspace-panel--task")
          .evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBe(450)
    headerBounds = await header.boundingBox()
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await header.boundingBox()).toEqual(headerBounds)
    await expect(form.locator('[data-slot="task-panel-footer"]')).toBeInViewport()
  })
}

for (const theme of ["light", "dark"]) {
  test(`keeps History metadata and Shell faces out of the main layout in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), theme === "dark")
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box", exact: true })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    const history = page.getByRole("region", { name: "Feature history", exact: true })
    const disclosure = history.getByRole("button", { name: "Details", exact: true })
    await expect(disclosure).toHaveText("")
    await expect(disclosure).toHaveAttribute("aria-expanded", "false")
    await expect(history.getByRole("status", { name: "History position", exact: true })).toHaveText(
      "1 / 1",
    )
    await disclosure.click()
    await expect(disclosure).toHaveAttribute("aria-expanded", "true")
    const row = history.locator("[data-history-id]").first()
    expect((await row.boundingBox())?.height).toBeLessThanOrEqual(48)
    const info = history.getByRole("button", { name: "Information about Box 1", exact: true })
    await info.focus()
    await expect(page.getByRole("tooltip")).toContainText("Depends on")
    await page.mouse.move(700, 400)
    await info.blur()
    await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
    await page.getByRole("button", { name: "Shell", exact: true }).click()
    const form = page.getByRole("form", { name: "Shell", exact: true })
    const list = form.locator("details")
    await expect(list).not.toHaveAttribute("open", "")
    await expect(list.locator("summary")).toHaveText("0 / 6 faces selected")
    await expect(form.getByRole("radio", { name: "Inward", exact: true })).toBeChecked()
    expect(
      (await form.getByRole("group", { name: "Thickness direction", exact: true }).boundingBox())
        ?.height,
    ).toBeLessThanOrEqual(64)
    await page.screenshot({ path: test.info().outputPath(`history-shell-${theme}.png`) })
    await list.locator("summary").click()
    const face = form.getByRole("checkbox").first()
    await face.focus()
    await expect(page.getByRole("tooltip")).toContainText("center (")
    await face.check()
    await expect(list.locator("summary")).toHaveText("1 / 6 faces selected")
    expect(
      await list.locator("div").evaluate((element) => element.clientHeight),
    ).toBeLessThanOrEqual(192)
  })
}

// Cover a fit boundary where category indicators add width beyond ordinary action icons.
test("keeps every toolbar action inside its measured budget near category fit thresholds", async ({
  page,
}) => {
  await page.goto("/")
  for (const width of [412, 420, 428, 436, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    const toolbar = page.locator("[data-responsive-model-toolbar]")
    await expect
      .poll(() =>
        toolbar.evaluate((root) => {
          const bounds = root.getBoundingClientRect()
          return [...root.querySelectorAll("button")]
            .filter((button) => !button.closest("[data-toolbar-measure]"))
            .every((button) => {
              const item = button.getBoundingClientRect()
              return item.left >= bounds.left && item.right <= bounds.right + 1
            })
        }),
      )
      .toBe(true)
    for (const category of await toolbar.locator("button[data-has-indicator=true]").all()) {
      const icon = category.locator("svg").first()
      const indicator = category.locator("[data-slot=button-dropdown-indicator]")
      expect((await icon.boundingBox())?.x ?? 0).toBeLessThan(
        (await indicator.boundingBox())?.x ?? 0,
      )
      const main = await icon.boundingBox(),
        arrow = await indicator.boundingBox()
      if (!main || !arrow) throw new Error("Category icon and indicator must be measurable")
      expect(main.x + main.width).toBeLessThanOrEqual(arrow.x)
    }
  }
})

test("keeps symmetric History spacing and a separate scrollbar lane below operation controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  const history = page.getByRole("region", { name: "Feature history", exact: true })
  const track = history.locator("[data-history-track]")
  // Overlay scrollbars paint without consuming layout space; reserve their lane explicitly.
  await page.addStyleTag({ content: "[data-history-track] { scrollbar-width: none; }" })
  await track.evaluate((element) => {
    element.style.maxWidth = "48px"
  })
  for (const detailed of [false, true]) {
    if (detailed) await history.getByRole("button", { name: "Details", exact: true }).click()
    expect(await track.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await expect
      .poll(async () => {
        const rail = await track.boundingBox()
        const row = await history.locator("[data-history-id]").first().boundingBox()
        if (!rail || !row) throw new Error("History track and operation must be measurable")
        return { top: row.y - rail.y, bottom: rail.y + rail.height - (row.y + row.height) }
      })
      .toEqual({ top: 8, bottom: 8 })
    const control = history.getByRole("treeitem", { name: "Box 1", exact: true })
    if (!detailed) {
      const bounds = await control.boundingBox()
      if (!bounds) throw new Error("History operation control must be measurable")
      expect(
        await control.evaluate(
          (element, point) =>
            element.contains(element.ownerDocument.elementFromPoint(point.x, point.y)),
          {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height - 2,
          },
        ),
      ).toBe(true)
    }
    await track.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    expect(await track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await track.evaluate((element) => {
      element.scrollLeft = 0
    })
  }
})

test("keeps browser icons uniform without an Operations heading or a History hover outline", async ({
  page,
}) => {
  await page.goto("/")
  const browser = page.getByRole("complementary", { name: "Model tree", exact: true })
  await expect(browser.getByRole("heading", { name: "Model tree", exact: true })).toBeVisible()
  await expect(browser.getByRole("heading", { name: "Operations", exact: true })).toHaveCount(0)
  for (const name of ["Variables", "Planes", "Parts"]) {
    const row = browser.getByRole("treeitem", { name: new RegExp(`^${name}(?: \\d+)?$`) })
    const icon = await row.locator("svg").last().boundingBox()
    expect(icon?.width).toBe(16)
    expect(icon?.height).toBe(16)
  }
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  const row = page.locator("[data-history-id]").first()
  await row.getByRole("treeitem", { name: "Box 1", exact: true }).hover()
  await expect(row).toHaveAttribute("data-history-source-highlighted", "true")
  await expect(row).toHaveCSS("box-shadow", "none")
  const operation = row.getByRole("treeitem", { name: "Box 1", exact: true })
  await operation.focus()
  await expect(operation).toBeFocused()
})
