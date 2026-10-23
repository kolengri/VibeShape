import type { Locator, Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function expectSeparate(first: Locator, second: Locator) {
  await expect
    .poll(async () => {
      const a = await first.boundingBox()
      const b = await second.boundingBox()
      if (!a || !b) return false
      return (
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
      )
    })
    .toBe(true)
}

function taskWidthFor(page: Page) {
  return page
    .locator("#workspace-task")
    .evaluate((element) => element.getBoundingClientRect().width)
}

async function expectWorkspaceLayout(page: Page, chat: Locator, size: { width: number }) {
  await expect(page.locator("#workspace-task")).toHaveAttribute(
    "data-viewport-area",
    size.width === 1920 ? "right" : "bottom",
  )
  if (size.width === 1024 || size.width === 720 || size.width === 390) {
    await page.getByRole("button", { name: "Show model tree", exact: true }).click()
    await expectSeparate(chat, page.locator(".workspace-panel--tree"))
    await page.getByRole("button", { name: "Hide model tree", exact: true }).click()
  }
  if (size.width === 1024) {
    await openApplicationMenuItem(page, "Settings…")
    const settings = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Settings", exact: true }) })
    await settings.getByRole("tab", { name: "Workspace", exact: true }).click()
    for (const name of [
      "Model tree width",
      "Task panel width",
      "Model tree background opacity",
      "Task panel background opacity",
    ]) {
      await expect(settings.getByRole("slider", { name, exact: true })).toBeDisabled()
    }
    await expect(
      settings.getByRole("button", { name: "Hide Model tree", exact: true }),
    ).toBeDisabled()
    await expect(
      settings.getByRole("button", { name: "Hide Task panel", exact: true }),
    ).toBeDisabled()
    await page.keyboard.press("Escape")
  }
  for (const surface of [
    page.locator(".workspace-panel--task"),
    page.locator("nav[data-sketch-mode]"),
    page.locator(".workspace-history"),
    page.locator(".editor-workbench > footer"),
  ])
    await expectSeparate(chat, surface)
  await expect
    .poll(() =>
      page.locator(".editor-workbench").evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const root = element.ownerDocument.documentElement
        return bounds.width > 0 && bounds.height > 0 && root.scrollWidth <= root.clientWidth
      }),
    )
    .toBe(true)
}

async function expectStableTaskTransitions(
  page: Page,
  form: Locator,
  chat: Locator,
  canvas: Locator,
) {
  for (const viewportWidth of [1920, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 })
    await expect(page.locator("#workspace-task")).toHaveAttribute(
      "data-viewport-area",
      viewportWidth === 1920 ? "right" : "bottom",
    )
    if (viewportWidth === 1920) {
      await expect.poll(() => taskWidthFor(page)).toBe(320)
    }
    const chatBounds = await chat.boundingBox()
    const canvasBounds = await canvas.boundingBox()
    if (viewportWidth === 1920) {
      const separator = page.getByRole("separator", { name: "Task panel width", exact: true })
      await separator.press("ArrowLeft")
      await expect.poll(() => taskWidthFor(page)).toBeGreaterThan(320)
      await expect.poll(() => chat.boundingBox()).toEqual(chatBounds)
      await expect.poll(() => canvas.boundingBox()).toEqual(canvasBounds)
      await separator.dblclick()
    }
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(form).toBeHidden()
    await expect.poll(() => chat.boundingBox()).toEqual(chatBounds)
    await expect.poll(() => canvas.boundingBox()).toEqual(canvasBounds)
    await invokeModelCommand(page, "Primitives", "Box")
    await expect(form).toBeVisible()
    await expect.poll(() => chat.boundingBox()).toEqual(chatBounds)
    await expect.poll(() => canvas.boundingBox()).toEqual(canvasBounds)
    await form.getByRole("combobox", { name: "Width", exact: true }).fill("77")
    await expectSeparate(chat, page.locator(".workspace-panel--task"))
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`shares space with task panels, chrome, and History in ${theme} theme`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.setViewportSize({ width: 1920, height: 1080 })
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
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    const width = form.getByRole("combobox", { name: "Width", exact: true })
    await width.fill("77")
    const formElement = await form.elementHandle()
    const canvas = page.locator(".workspace-viewport canvas").first()
    const canvasElement = await canvas.elementHandle()
    const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
    await expect(chat).toBeVisible()

    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1024, height: 720 },
      { width: 720, height: 450 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size)
      await expect(form).toBeVisible()
      await expect(width).toHaveValue("77")
      await expectWorkspaceLayout(page, chat, size)
      await form.getByRole("button", { name: "Cancel", exact: true }).click({ trial: true })
      await chat
        .getByRole("button", { name: "Collapse AI chat", exact: true })
        .click({ trial: true })
      expect(await form.evaluate((element, original) => element === original, formElement)).toBe(
        true,
      )
      expect(
        await canvas.evaluate((element, original) => element === original, canvasElement),
      ).toBe(true)
      if (size.width === 1920 || size.width === 1440 || size.width === 1024) {
        await page.screenshot({ path: `artifacts/ai-chat-panel-layout/${theme}-${size.width}.png` })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator("#workspace-task")).toHaveAttribute("data-viewport-area", "bottom")
    await expectStableTaskTransitions(page, form, chat, canvas)
    await chat.getByRole("button", { name: "Collapse AI chat", exact: true }).click()
    await expect(chat).toBeHidden()
    await expect(page.locator(".workspace-panel--task")).toHaveAttribute("data-collapsed", "false")
    await expect(width).toHaveValue("77")
    expect(await canvas.evaluate((element, original) => element === original, canvasElement)).toBe(
      true,
    )
  })
}
