import type { Route } from "@playwright/test"
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
    await expect(trigger.locator("svg")).toHaveCount(1)
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu")
    await trigger.click()
    await expect(page.getByRole("menu")).toBeVisible()
    await page.keyboard.press("Escape")
  }
})

for (const width of [800, 1024, 1440]) {
  test(`keeps the task panel beside AI chat at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    const draft = form.getByRole("combobox", { name: "Width", exact: true })
    await draft.fill("77")
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
    const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
    await expect(chat).toBeVisible()
    await expect(form).toBeVisible()
    await expect
      .poll(async () => {
        const taskBounds = await form.boundingBox()
        const chatBounds = await chat.boundingBox()
        if (!taskBounds || !chatBounds) return false
        return taskBounds.x + taskBounds.width <= chatBounds.x + 1
      })
      .toBe(true)
    await expect(draft).toHaveValue("77")
    const timeline = page.locator("[data-feature-timeline]")
    const timelineBounds = await timeline.boundingBox()
    const chatBounds = await chat.boundingBox()
    if (!timelineBounds || !chatBounds) throw new Error("Chat and History must be visible.")
    expect(chatBounds.y + chatBounds.height).toBeLessThanOrEqual(timelineBounds.y + 1)
    expect(timelineBounds.width).toBe(width)
    await timeline.getByRole("treeitem", { name: "History", exact: true }).click()
    await expect
      .poll(async () => {
        const historyBounds = await timeline.boundingBox()
        const bounds = await chat.boundingBox()
        if (!historyBounds || !bounds) return false
        return Math.abs(bounds.y + bounds.height - historyBounds.y) <= 1
      })
      .toBe(true)
    await chat.getByRole("button", { name: "Close chat", exact: true }).click()
    await expect(chat).toHaveCount(0)
    await expect(draft).toHaveValue("77")
  })
}

test("shows Thinking by the composer with the wordmark shimmer and respects reduced motion", async ({
  page,
}) => {
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
  await chat.getByRole("combobox", { name: "Provider", exact: true }).click()
  await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
  await chat
    .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
    .fill(endpoint)
  await chat.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
  await chat.getByRole("button", { name: "Connect and enable project access", exact: true }).click()
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
      choices: [{ message: { content: "A new project." }, finish_reason: "stop" }],
    }),
  })
  await expect(thinking).toHaveCount(0)
})

for (const theme of ["light", "dark"]) {
  test(`keeps the floating task header transparent in ${theme} theme`, async ({ page }) => {
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
    await expect
      .poll(() =>
        header.evaluate((element) => {
          return (
            element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor !==
            "rgba(0, 0, 0, 0)"
          )
        }),
      )
      .toBe(true)
  })
}
