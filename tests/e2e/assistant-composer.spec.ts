import type { Locator, Page, Route } from "@playwright/test"
import { z } from "zod"
import { openApplicationMenuItem } from "./application-menu-support"
import { saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

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
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
  await panel.getByRole("button", { name: "AI settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "AI settings", exact: true })
  await settings.getByRole("combobox", { name: "Provider", exact: true }).click()
  await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
  await settings
    .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
    .fill(endpoint)
  await settings.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
  await settings.getByLabel("API key (optional)", { exact: true }).fill("fixture-memory-key")
  await settings
    .getByRole("button", { name: "Connect and enable project access", exact: true })
    .click()
  await expect(settings).toBeHidden()
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

test("question choices wrap to readable rows and retain native keyboard selection", async ({
  page,
}) => {
  const standard = "Fit a standard bicycle bottle holder, approximately 74 mm in diameter"
  const custom = "Use the holder dimensions supplied in the instructions below"
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    await fulfill(
      route,
      tool(
        "ask_user_question",
        {
          message: "Choose the container dimensions",
          fields: [
            {
              id: "size",
              label: "Size for the bicycle bottle holder",
              required: true,
              options: [
                {
                  id: "standard",
                  name: standard,
                  description: "Measure the holder before printing.",
                },
                { id: "custom", name: custom },
                { id: "small", name: "Small" },
                { id: "large", name: "Large" },
              ],
            },
          ],
        },
        "choose-size",
      ),
    )
  })
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  const panel = await connect(page)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Choose a size")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const question = panel.getByRole("form", { name: "Agent question", exact: true })
  const field = question.locator('[data-component="choice-field"]')
  await expect(field).toBeVisible()
  for (const width of [280, 340]) {
    await field.evaluate((node, width) => {
      node.style.width = `${width}px`
      node.style.maxWidth = "100%"
    }, width)
    const cards = await field.getByRole("radio").evaluateAll((inputs) =>
      inputs.map((input) => {
        const card = input.closest("label")?.parentElement
        if (!card) throw new Error("The choice must have a card")
        const bounds = card.getBoundingClientRect()
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          overflowing: card.scrollWidth > card.clientWidth,
          inputOpacity: input.ownerDocument.defaultView?.getComputedStyle(input).opacity,
        }
      }),
    )
    const bounds = await field.boundingBox()
    if (!bounds) throw new Error("The question field must have visible bounds")
    expect(cards[1]?.y).toBeGreaterThan(cards[0]?.y ?? 0)
    expect(cards[2]?.y).toBe(cards[3]?.y)
    for (const card of cards) {
      expect(card.x).toBeGreaterThanOrEqual(bounds.x)
      expect(card.x + card.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
      expect(card.height).toBeLessThan(100)
      expect(card.overflowing).toBe(false)
      expect(card.inputOpacity).toBe("0")
    }
  }
  const first = field.getByRole("radio", { name: standard, exact: true })
  const second = field.getByRole("radio", { name: custom, exact: true })
  const firstCard = first.locator("xpath=ancestor::label/..")
  const secondCard = second.locator("xpath=ancestor::label/..")
  await secondCard.click({ position: { x: 2, y: 2 } })
  await expect(second).toBeChecked()
  await field.getByRole("button", { name: `Help for ${standard}`, exact: true }).click()
  const help = page.getByRole("dialog", { name: standard, exact: true })
  await expect(help).toContainText("Measure the holder before printing.")
  await expect(second).toBeChecked()
  await expect(first).not.toBeChecked()
  await help.press("Escape")
  await firstCard.click({ position: { x: 2, y: 2 } })
  await expect(first).toBeChecked()
  await first.focus()
  await first.press("Space")
  const background = await firstCard.evaluate(
    (node) => node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor,
  )
  expect(
    await secondCard.evaluate(
      (node) => node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor,
    ),
  ).not.toBe(background)
  expect(
    await firstCard.evaluate(
      (node) => node.ownerDocument.defaultView?.getComputedStyle(node).boxShadow ?? "none",
    ),
  ).not.toBe("none")
  await first.press("ArrowDown")
  await expect(second).toBeChecked()
  await expect(second).toBeFocused()
  await expect(first).not.toBeChecked()
  await page.emulateMedia({ forcedColors: "active" })
  await second.evaluate((node) => node.blur())
  const checkedOutline = await secondCard.evaluate((node) => {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    return { style: style?.outlineStyle, width: style?.outlineWidth, offset: style?.outlineOffset }
  })
  expect(checkedOutline).toEqual({ style: "solid", width: "2px", offset: "-3px" })
  expect(
    await firstCard.evaluate(
      (node) => node.ownerDocument.defaultView?.getComputedStyle(node).outlineStyle,
    ),
  ).toBe("none")
  await second.focus()
  const focusedOutline = await secondCard.evaluate((node) => {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    return { style: style?.outlineStyle, width: style?.outlineWidth, offset: style?.outlineOffset }
  })
  expect(focusedOutline).toEqual({ style: "dashed", width: "2px", offset: "2px" })
})

test("keeps previous project chats after reload and continues the selected conversation", async ({
  page,
}) => {
  const requests: z.infer<typeof requestSchema>[] = []
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    requests.push(requestSchema.parse(route.request().postDataJSON()))
    await fulfill(route, answer("Saved conversation reply."))
  })
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  let panel = await connect(page)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Design a removable lid")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(panel.getByText("Saved conversation reply.", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "New chat", exact: true }).click()
  await expect(panel.getByText("Design a removable lid", { exact: true })).toHaveCount(0)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Design a separate hinge")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(panel.getByText("Saved conversation reply.", { exact: true })).toBeVisible()
  await page.reload()
  panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
  await panel.getByRole("button", { name: "Chat history", exact: true }).click()
  const list = panel.getByRole("region", { name: "Chat history", exact: true })
  await expect(
    list.getByRole("button", { name: "Design a removable lid", exact: true }),
  ).toBeVisible()
  for (const theme of ["light", "dark"] as const) {
    for (const zoom of [1, 2]) {
      await page.locator("html").evaluate(
        (root, { theme, zoom }) => {
          root.classList.toggle("dark", theme === "dark")
          root.style.zoom = String(zoom)
          const shell = root.querySelector<typeof root>(".cad-shell")
          if (shell) shell.style.height = `${800 / zoom}px`
        },
        { theme, zoom },
      )
      await contained(page, list)
      await panel.screenshot({
        path: `artifacts/project-chat-history/history-${theme}-${zoom}x.png`,
      })
    }
  }
  await page.locator("html").evaluate((root) => {
    root.style.zoom = "1"
    const shell = root.querySelector<typeof root>(".cad-shell")
    if (shell) shell.style.height = "800px"
  })
  await list.getByRole("button", { name: "Design a removable lid", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(list).toBeHidden()
  await expect(panel.getByRole("button", { name: "Chat history", exact: true })).toBeFocused()
  await expect(panel.getByText("Design a removable lid", { exact: true })).toBeVisible()
  await expect(panel.getByText("Design a separate hinge", { exact: true })).toHaveCount(0)
  panel = await connect(page)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Continue the lid")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => requests.length).toBe(3)
  expect(requests[2]?.messages.some(({ content }) => content === "Design a removable lid")).toBe(
    true,
  )
  expect(requests[2]?.messages.some(({ content }) => content === "Design a separate hinge")).toBe(
    false,
  )
  await panel.getByRole("button", { name: "Chat history", exact: true }).click()
  await expect(
    list.getByRole("button", { name: "Design a separate hinge", exact: true }),
  ).toBeVisible()
})

for (const theme of ["light", "dark"] as const) {
  test(`distinguishes human message bubbles from assistant prose in ${theme} theme`, async ({
    page,
  }) => {
    await page.route(endpoint, async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers })
        return
      }
      await fulfill(route, answer("The model will keep these dimensions."))
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/")
    await page
      .locator("html")
      .evaluate((root, dark) => root.classList.toggle("dark", dark), theme === "dark")
    const panel = await connect(page)
    await panel
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep the lid removable and use a 2 mm wall.")
    await panel.getByRole("button", { name: "Send", exact: true }).click()
    await expect(panel.getByRole("log")).toContainText("The model will keep these dimensions.")
    const human = panel.locator('[data-message-role="user"]')
    await expect(human).toHaveCSS("border-top-left-radius", "16px")
    expect(
      await human.evaluate(
        (node) => node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)")
    await contained(page, human)
    await panel.screenshot({ path: test.info().outputPath(`human-bubble-${theme}.png`) })
  })
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
  await question.getByRole("radio", { name: "Fillet", exact: true }).check()
  await expect(question.getByRole("radio", { name: "Fillet", exact: true })).toBeChecked()
  await question.getByRole("button", { name: "Next", exact: true }).click()
  await question
    .getByRole("textbox", { name: "Custom instructions", exact: true })
    .fill("Use a 2 mm radius")
  await question.getByRole("button", { name: "Submit answers", exact: true }).click()
  await expect(panel.getByRole("log")).toContainText(
    "The requested dimensions and corner treatment are ready.",
  )
  const tools = panel.getByRole("log").locator(":scope > details")
  await expect(tools).toHaveCount(2)
  for (const row of await tools.all()) {
    await expect(row).not.toHaveAttribute("open")
    await expect(
      row.getByRole("region", { name: "Tool details", exact: true, includeHidden: true }),
    ).not.toBeVisible()
  }
  await tools.last().locator(":scope > summary").click()
  const details = tools.last().getByRole("region", { name: "Tool details", exact: true })
  const parameters = details.getByRole("region", { name: "Parameters", exact: true })
  await expect(parameters.getByText("Query", { exact: true })).toBeVisible()
  await expect(parameters.getByText("model info", { exact: true })).toBeVisible()
  const result = details.getByRole("region", { name: "Result", exact: true })
  await expect(result).toBeVisible()
  await expect(result.getByText("Tools", { exact: true })).toBeVisible()
  const technical = details.locator("details")
  await expect(technical).not.toHaveAttribute("open")
  await technical.getByText("Technical details", { exact: true }).click()
  await expect(technical.locator("pre")).toContainText('"query": "model info"')
  await expect(technical.locator("pre")).toContainText('"result"')
  await contained(page, composer)
  await expect(panel.locator('[data-slot="spinner"]')).toHaveCount(0)
  await page.screenshot({
    path: `artifacts/placement-drag-continuity/assistant-ui/composer-${test.info().project.name}-dark.png`,
    animations: "disabled",
  })
  await composer.getByRole("textbox", { name: "Message", exact: true }).fill("Hold the active turn")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => Boolean(held)).toBe(true)
  const activity = panel.locator("header").getByRole("status").filter({ hasText: "AI working…" })
  await expect(activity).toHaveCount(0)
  const stop = panel.getByRole("button", { name: "Stop", exact: true })
  await expect(stop).toBeVisible()
  await panel.getByRole("button", { name: "Collapse AI chat", exact: true }).click()
  await expect(panel).not.toBeVisible()
  await expect(stop).not.toBeVisible()
  await expect(page.locator(".application-bar")).not.toContainText("AI working…")
  await contained(page, page.locator(".application-bar"))
  await page.screenshot({ path: test.info().outputPath("assistant-working-chat-closed.png") })
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(activity).toHaveCount(0)
  await expect(stop).toBeVisible()
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
  await stop.click()
  await expect(
    panel.getByRole("button", { name: "Resume queued messages", exact: true }),
  ).toBeVisible()
  await expect(activity).toHaveCount(0)
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

test("preserves the reading position through tool and answer updates and resumes following at the bottom", async ({
  page,
}) => {
  let requests = 0
  let readingTurn: Route | undefined
  let followingTurn: Route | undefined
  const longAnswer = Array.from(
    { length: 70 },
    (_, index) =>
      `Reading line ${index + 1}: Keep these earlier modeling notes available for review.`,
  ).join("\n")
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    const request = requestSchema.parse(route.request().postDataJSON())
    requests += 1
    switch (requests) {
      case 1:
        expect(lastContent(request)).toBe("Write a long report")
        await fulfill(route, answer(longAnswer))
        break
      case 2:
        expect(lastContent(request)).toBe("Inspect while I read")
        readingTurn = route
        break
      case 3:
        expect(JSON.parse(lastContent(request))).toHaveProperty("tools")
        await fulfill(route, answer("Inspection finished while you were reading earlier notes."))
        break
      case 4:
        expect(lastContent(request)).toBe("Continue at the bottom")
        followingTurn = route
        break
      default:
        throw new Error("Unexpected scroll regression fixture request")
    }
  })
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  const panel = await connect(page)
  const log = panel.getByRole("log")
  const input = panel.getByRole("textbox", { name: "Message", exact: true })
  const send = panel.getByRole("button", { name: "Send", exact: true })
  await input.fill("Write a long report")
  await send.click()
  await expect(log).toContainText("Reading line 70:")
  await expect(panel.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  expect(await log.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(500)

  await input.fill("Inspect while I read")
  await send.click()
  await expect.poll(() => Boolean(readingTurn)).toBe(true)
  const readingPosition = await log.evaluate(async (node) => {
    node.scrollTop = Math.max(0, node.scrollTop - 900)
    await new Promise<void>((resolve) =>
      node.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
    )
    return node.scrollTop
  })
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeGreaterThan(48)
  if (!readingTurn) throw new Error("The reading turn must be held until the user scrolls up.")
  await fulfill(
    readingTurn,
    tool("discover_cad_tools", { query: "model info", limit: 1 }, "inspect-while-reading"),
  )
  await expect(log).toContainText("Inspection finished while you were reading earlier notes.")
  await expect(panel.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  const updatedPosition = await log.evaluate(async (node) => {
    await new Promise<void>((resolve) =>
      node.ownerDocument.defaultView?.requestAnimationFrame(() =>
        node.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
      ),
    )
    return node.scrollTop
  })
  expect(Math.abs(updatedPosition - readingPosition)).toBeLessThanOrEqual(1)
  expect(
    await log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
  ).toBeGreaterThan(48)

  await log.evaluate(async (node) => {
    node.scrollTop = node.scrollHeight
    await new Promise<void>((resolve) =>
      node.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
    )
  })
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(1)
  await input.fill("Continue at the bottom")
  await send.click()
  await expect.poll(() => Boolean(followingTurn)).toBe(true)
  if (!followingTurn) throw new Error("The following turn must wait for the bottom position.")
  await fulfill(followingTurn, answer(`${longAnswer}\nThe latest answer is at the bottom.`))
  await expect(log).toContainText("The latest answer is at the bottom.")
  await expect(panel.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(48)
  expect(requests).toBe(4)
})

test("resumes transcript following after closing a scrolled tool result", async ({ page }) => {
  let requests = 0
  let pendingAnswer: Route | undefined
  const longAnswer = Array.from(
    { length: 60 },
    (_, index) => `Updated report line ${index + 1}`,
  ).join("\n")
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    const request = requestSchema.parse(route.request().postDataJSON())
    requests += 1
    if (requests === 1) {
      expect(lastContent(request)).toBe("Inspect available commands")
      await fulfill(route, tool("discover_cad_tools", { limit: 6 }, "inspect-commands"))
    } else if (requests === 2) {
      expect(JSON.parse(lastContent(request))).toHaveProperty("tools")
      await fulfill(route, answer("Inspection finished."))
    } else if (requests === 3) {
      expect(lastContent(request)).toBe("Continue the report")
      pendingAnswer = route
    } else {
      throw new Error("Unexpected tool-scroll regression fixture request")
    }
  })
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  const panel = await connect(page)
  const log = panel.getByRole("log")
  const input = panel.getByRole("textbox", { name: "Message", exact: true })
  const send = panel.getByRole("button", { name: "Send", exact: true })
  await input.fill("Inspect available commands")
  await send.click()
  await expect(log).toContainText("Inspection finished.")
  await expect(panel.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  const summary = log.locator("summary").filter({ hasText: "Discover cad tools" }).first()
  await summary.click()
  const output = log.getByRole("region", { name: "Tool details", exact: true })
  expect(await output.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(
    100,
  )
  await log.evaluate(async (node) => {
    node.scrollTop = node.scrollHeight
    await new Promise<void>((resolve) =>
      node.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
    )
  })
  await output.evaluate(async (node) => {
    node.scrollTop = 100
    await new Promise<void>((resolve) =>
      node.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
    )
  })
  await input.fill("Continue the report")
  await send.click()
  await expect.poll(() => Boolean(pendingAnswer)).toBe(true)
  expect(await output.evaluate((node) => node.scrollTop)).toBe(100)
  await summary.click()
  await expect(output).toBeHidden()
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(48)
  if (!pendingAnswer) throw new Error("The answer must wait until tool details close.")
  await fulfill(pendingAnswer, answer(longAnswer))
  await expect(log).toContainText("Updated report line 60")
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(48)
  expect(requests).toBe(3)
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

test("compares and atomically undoes a connected assistant turn spanning saved stages", async ({
  page,
}) => {
  test.setTimeout(180_000)
  let requests = 0
  let stageGate: Route | undefined
  let nextRevision = 0
  let draftId = ""
  const valueSchema = z.object({ ok: z.literal(true), value: z.record(z.string(), z.unknown()) })
  const draftSchema = z.object({ draftId: z.string(), revision: z.number() })
  const call = (name: string, args: unknown) =>
    tool("call_cad_tool", { name, arguments: args }, `step-${requests}`)
  const savedStageCommand = (step: number, result: Record<string, unknown>) => {
    if (step === 3 || step === 6) {
      const draft = draftSchema.parse(result)
      draftId = draft.draftId
      const part = step === 3 ? 1 : 2
      return call("create_box", {
        draftId,
        baseRevision: draft.revision,
        commandId: `0195b5ac-b250-7a2c-8c33-00000000080${part}`,
        featureId: `0195b5ac-b250-7a2c-8c33-00000000081${part}`,
        label: `Assistant stage ${part}`,
        widthMm: 10 + part * 5,
        depthMm: 12,
        heightMm: 20 + part * 10,
      })
    }
    if (step === 4 || step === 7) return call("commit_draft", { draftId })
    return null
  }
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    const request = requestSchema.parse(route.request().postDataJSON())
    requests += 1
    if (requests === 1) {
      await fulfill(route, call("model_info", {}))
      return
    }
    const result = valueSchema.parse(JSON.parse(lastContent(request))).value
    const stage = savedStageCommand(requests, result)
    if (stage) {
      await fulfill(route, stage)
    } else if (requests === 2) {
      const summary = z.object({ revision: z.number() }).parse(result.summary)
      await fulfill(route, call("create_draft", { baseRevision: summary.revision }))
    } else if (requests === 5) {
      nextRevision = z.number().parse(result.revision)
      stageGate = route
    } else if (requests === 8) {
      await fulfill(route, answer("Both saved stages are complete."))
    } else throw new Error(`Unexpected assistant fixture request ${requests}`)
  })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await saved(page)
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  const panel = await connect(page)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Build two saved stages")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
  await expect.poll(() => Boolean(stageGate)).toBe(true)
  await expect(panel.getByRole("button", { name: "Undo agent changes", exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(0)
  if (!stageGate) throw new Error("Expected the second construction stage gate")
  await fulfill(stageGate, call("create_draft", { baseRevision: nextRevision }))
  await expect(panel.getByText("Both saved stages are complete.", { exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
  const before = panel.getByRole("button", { name: "View before", exact: true })
  await expect(before).toBeEnabled()
  const log = panel.getByRole("log")
  const readingPosition = await log.evaluate((node) => {
    node.style.flex = "0 0 180px"
    node.style.height = "180px"
    node.scrollTop = node.scrollHeight - node.clientHeight - 24
    node.dispatchEvent(new Event("scroll"))
    return node.scrollTop
  })
  await expect(before).toBeInViewport({ ratio: 1 })
  await before.click()
  await expect(panel.getByRole("button", { name: "View current", exact: true })).toBeEnabled()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  expect(await log.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0)
  await expect(page.getByRole("treeitem", { name: "Assistant stage 1", exact: true })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Assistant stage 2", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("assistant-view-before.png") })
  await panel.getByRole("button", { name: "View current", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
  expect(await log.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0)
  await page.screenshot({ path: test.info().outputPath("assistant-view-current.png") })
  await panel.getByRole("button", { name: "Undo agent changes", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  await expect(page.getByRole("treeitem", { name: "Assistant stage 1", exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByRole("treeitem", { name: "Assistant stage 2", exact: true })).toHaveCount(
    0,
  )
  await expect(before).toHaveCount(0)
  await page
    .getByRole("toolbar", { name: "Model commands", exact: true })
    .getByRole("button", { name: "Redo", exact: true })
    .click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
  await page.reload()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
})

test("confirms a retained assistant preview above scrolled chat without another model request", async ({
  page,
}) => {
  test.setTimeout(180_000)
  let requests = 0
  const valueSchema = z.object({ ok: z.literal(true), value: z.record(z.string(), z.unknown()) })
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    requests += 1
    const request = requestSchema.parse(route.request().postDataJSON())
    const call = (name: string, args: unknown) =>
      tool("call_cad_tool", { name, arguments: args }, `apply-${requests}`)
    if (requests === 1) await fulfill(route, call("model_info", {}))
    else if (requests === 2) {
      const result = valueSchema.parse(JSON.parse(lastContent(request))).value
      const summary = z.object({ revision: z.number() }).parse(result.summary)
      await fulfill(route, call("create_draft", { baseRevision: summary.revision }))
    } else if (requests === 3) {
      const result = valueSchema.parse(JSON.parse(lastContent(request))).value
      const draft = z.object({ draftId: z.string(), revision: z.number() }).parse(result)
      await fulfill(
        route,
        call("create_box", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: "0195b5ac-b250-7a2c-8c33-000000000901",
          featureId: "0195b5ac-b250-7a2c-8c33-000000000902",
          label: "Chat approved box",
          widthMm: 20,
          depthMm: 15,
          heightMm: 30,
        }),
      )
    } else if (requests === 4)
      await fulfill(
        route,
        answer(
          [
            "## Model changes",
            "Wall thickness is **2.0 mm** instead of *2.4 mm*.[^1]",
            "- Preserve the lid\n- Preserve the neck",
            "| Dimension | Value |\n| --- | --- |\n| Wall | 2.0 mm |",
            "```ts\nconst wallThickness = 2.0\n```",
            ...Array.from(
              { length: 30 },
              (_, index) => `Draft note ${index + 1}: Review the box dimensions before confirming.`,
            ),
            "[^1]: Confirm print strength with a physical test.",
          ].join("\n\n"),
        ),
      )
    else throw new Error("Applying the preview must not send another model request.")
  })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await saved(page)
  const panel = await connect(page)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Prepare a box preview")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const apply = panel.getByRole("button", { name: "Confirm changes", exact: true })
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  const log = panel.getByRole("log")
  await expect(log.getByRole("heading", { name: "Model changes", level: 2 })).toBeVisible()
  await expect(log.locator("strong")).toHaveText("2.0 mm")
  await expect(log.getByRole("table")).toContainText("Wall")
  await expect(log.locator("pre > code")).toHaveText("const wallThickness = 2.0\n")
  await log.evaluate((node) => {
    node.scrollTop = 0
    node.dispatchEvent(new Event("scroll"))
  })
  await expect(log.getByRole("button", { name: "Confirm changes", exact: true })).toHaveCount(0)
  await expect(apply).toBeInViewport({ ratio: 1 })
  await expect(apply).toHaveText("")
  await log.getByRole("heading", { name: "Model changes", level: 2 }).evaluate((node) => {
    node.scrollIntoView({ block: "start" })
  })
  await page.screenshot({ path: test.info().outputPath("assistant-markdown-dark.png") })
  await openApplicationMenuItem(page, "Settings…")
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
  await page.getByRole("option", { name: "Light", exact: true }).click()
  await settings.getByRole("button", { name: "Done", exact: true }).click()
  await expect(apply).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: test.info().outputPath("assistant-markdown-light.png") })
  const reference = log.locator("a[data-footnote-ref]")
  const pageCount = page.context().pages().length
  await reference.click()
  await expect(log.locator("[data-footnotes]")).toBeInViewport()
  await log.locator("a[data-footnote-backref]").click()
  await expect(reference).toBeInViewport()
  expect(page.context().pages()).toHaveLength(pageCount)
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(0)
  await apply.focus()
  await page.keyboard.press("Enter")
  await expect(apply).toHaveCount(0)
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(1)
  expect(requests).toBe(4)
  await expect(panel.getByRole("button", { name: "View before", exact: true })).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath("assistant-applied-preview.png") })
  await page.reload()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(1)
  await expect(page.getByRole("treeitem", { name: "Chat approved box", exact: true })).toBeVisible()
})
