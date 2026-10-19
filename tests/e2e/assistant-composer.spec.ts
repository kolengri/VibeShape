import type { Locator, Page, Route } from "@playwright/test"
import { z } from "zod"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"

const endpoint = "https://assistant-composer.example.test/v1/chat/completions"
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string().nullable() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
})
function lastContent(request: z.infer<typeof requestSchema>) {
  const content = request.messages.at(-1)?.content
  if (content == null) throw new Error("Expected a nonempty fixture request message")
  return content
}
function answer(content: string) {
  return { choices: [{ message: { content }, finish_reason: "stop" }] }
}
function tool(name: string, args: unknown, id: string) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  }
}
async function fulfill(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    headers,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  await panel.getByRole("combobox", { name: "Provider", exact: true }).click()
  await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
  await panel
    .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
    .fill(endpoint)
  await panel.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
  await panel.getByLabel("API key (optional)", { exact: true }).fill("fixture-memory-key")
  await panel
    .getByRole("button", { name: "Connect and enable project access", exact: true })
    .click()
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  return panel
}
async function attach(page: Page, panel: Locator, name: string, mimeType: string, content: string) {
  const choosing = page.waitForEvent("filechooser")
  await panel.getByRole("button", { name: "Attach files", exact: true }).click()
  await (await choosing).setFiles({ name, mimeType, buffer: Buffer.from(content) })
}
async function saved(page: Page) {
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
    { timeout: 30_000 },
  )
}
async function contained(page: Page, locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 })
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error("The composer must have visible bounds")
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1)
  expect(
    await page
      .locator("html")
      .evaluate(
        (node) => node.scrollWidth <= (node.ownerDocument.defaultView?.innerWidth ?? 0) + 1,
      ),
  ).toBe(true)
}

test("transfers selected files, answers structured model questions, collapses tools, and preserves a stopped queue", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const requests: z.infer<typeof requestSchema>[] = []
  let held: Route | undefined
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    const request = requestSchema.parse(route.request().postDataJSON())
    const content = lastContent(request)
    requests.push(request)
    expect(request.tools.map((entry) => entry.function.name)).toEqual([
      "discover_cad_tools",
      "call_cad_tool",
      "ask_user_question",
    ])
    switch (requests.length) {
      case 1:
        expect(content).toContain("width=42 mm")
        expect(content).toContain("dimensions.txt")
        await fulfill(
          route,
          tool(
            "ask_user_question",
            {
              message: "Choose the corner treatment",
              fields: [
                {
                  id: "finish",
                  label: "Corner treatment",
                  required: true,
                  options: [
                    { id: "fillet", name: "Fillet" },
                    { id: "chamfer", name: "Chamfer" },
                  ],
                },
                { id: "note", label: "Custom instructions", required: false },
              ],
            },
            "choose-finish",
          ),
        )
        break
      case 2:
        expect(JSON.parse(content)).toEqual({
          answers: { finish: "fillet", note: "Use a 2 mm radius" },
        })
        await fulfill(
          route,
          tool("discover_cad_tools", { query: "model info", limit: 1 }, "discover-model"),
        )
        break
      case 3:
        expect(JSON.parse(content)).toHaveProperty("tools")
        await fulfill(route, answer("The requested dimensions and corner treatment are ready."))
        break
      case 4:
        held = route
        break
      case 5:
        expect(content).toContain("Add the hole later")
        expect(content).toContain("hole=5 mm")
        await fulfill(route, answer("The queued message was received."))
        break
      default:
        throw new Error("Unexpected fixture model request")
    }
  })
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" })
  await page.goto("/")
  await saved(page)
  const panel = await connect(page)
  const composer = panel.getByRole("region", { name: "Message", exact: true })
  await expect(composer.getByText("fixture-model", { exact: true })).toBeVisible()
  await expect(
    panel.getByText("Model access is enabled for this project.", { exact: false }),
  ).toHaveCount(0)
  await attach(page, panel, "drawing.pdf", "application/pdf", "%PDF")
  await expect(panel.getByRole("alert")).toHaveText(
    "drawing.pdf: this file type is not supported by this agent.",
  )
  await panel.getByRole("button", { name: "Remove drawing.pdf", exact: true }).click()
  await attach(page, panel, "dimensions.txt", "text/plain", "width=42 mm")
  await composer
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Use these dimensions and ask about the corners")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const question = panel.getByRole("form", { name: "Agent question", exact: true })
  await expect(question).toBeVisible()
  await question.getByText("Fillet", { exact: true }).click()
  await expect(question.getByRole("radio", { name: "Fillet", exact: true })).toBeChecked()
  await question
    .getByRole("textbox", { name: "Custom instructions", exact: true })
    .fill("Use a 2 mm radius")
  await question.getByRole("button", { name: "Submit answers", exact: true }).click()
  await expect(panel.getByRole("log")).toContainText(
    "The requested dimensions and corner treatment are ready.",
  )
  const tools = panel.getByRole("log").locator("details")
  await expect(tools).toHaveCount(2)
  for (const row of await tools.all()) {
    await expect(row).not.toHaveAttribute("open")
    await expect(row.locator("section")).not.toBeVisible()
  }
  await tools.last().locator("summary").click()
  await expect(
    tools.last().getByRole("region", { name: "Tool details", exact: true }),
  ).toContainText('"query": "model info"')
  await expect(
    tools.last().getByRole("region", { name: "Tool details", exact: true }),
  ).toContainText('"result"')
  await contained(page, composer)
  await expect(panel.locator('[data-slot="spinner"]')).toHaveCount(0)
  await page.screenshot({
    path: `artifacts/placement-drag-continuity/assistant-ui/composer-${test.info().project.name}-dark.png`,
    animations: "disabled",
  })
  await composer.getByRole("textbox", { name: "Message", exact: true }).fill("Hold the active turn")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => Boolean(held)).toBe(true)
  await attach(page, panel, "hole.txt", "text/plain", "hole=5 mm")
  await composer.getByRole("textbox", { name: "Message", exact: true }).fill("Add the hole later")
  await panel.getByRole("button", { name: "Queue message", exact: true }).click()
  await expect(panel.getByRole("region", { name: "Queued messages", exact: true })).toContainText(
    "Add the hole later",
  )
  await composer
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Remove this queued item")
  await panel.getByRole("button", { name: "Queue message", exact: true }).click()
  await panel.getByRole("button", { name: "Remove queued message", exact: true }).last().click()
  expect(requests).toHaveLength(4)
  await panel.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(
    panel.getByRole("button", { name: "Resume queued messages", exact: true }),
  ).toBeVisible()
  await expect(panel.locator('[data-slot="spinner"]')).toHaveCount(0)
  await held
    ?.fulfill({
      status: 200,
      headers,
      contentType: "application/json",
      body: JSON.stringify(answer("Late answer")),
    })
    .catch(() => undefined)
  await panel.getByRole("button", { name: "Resume queued messages", exact: true }).click()
  await expect(panel.getByRole("log")).toContainText("The queued message was received.")
  await expect(panel.getByRole("region", { name: "Queued messages", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("log")).not.toContainText("Late answer")
  expect(requests).toHaveLength(5)
  const stored = await page.evaluate(() => Object.values(localStorage).join("\n"))
  expect(stored).not.toContain("width=42 mm")
  expect(stored).not.toContain("hole=5 mm")
  expect(stored).not.toContain("fixture-memory-key")
})

test("retains an oversized draft before any request and keeps the light composer usable at 200 percent", async ({
  page,
}) => {
  let requests = 0
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") await route.fulfill({ status: 204, headers })
    else {
      requests += 1
      await fulfill(route, answer("Unexpected request"))
    }
  })
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  const panel = await connect(page)
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
  await page.getByRole("option", { name: "Light", exact: true }).click()
  await settings.getByRole("button", { name: "Done", exact: true }).click()
  await page.locator("html").evaluate((node) => {
    node.style.setProperty("zoom", "2")
  })
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await attach(page, panel, "large.txt", "text/plain", "x".repeat(280_000))
  const composer = panel.getByRole("region", { name: "Message", exact: true })
  const input = composer.getByRole("textbox", { name: "Message", exact: true })
  await input.fill("Keep this draft")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "This conversation is too large" }),
  ).toBeVisible()
  await expect(input).toHaveValue("Keep this draft")
  await expect(panel.getByRole("button", { name: "Remove large.txt", exact: true })).toBeVisible()
  expect(requests).toBe(0)
  await contained(page, composer)
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(panel.locator('[data-slot="spinner"]')).toHaveCount(0)
  await page.screenshot({
    path: `artifacts/placement-drag-continuity/assistant-ui/composer-${test.info().project.name}-light-200.png`,
    animations: "disabled",
  })
})
