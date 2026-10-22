import type { Page, Route } from "@playwright/test"
import { z } from "zod"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"

const endpoint = "https://api.example.test/v1/chat/completions"
const key = "browser-api-fixture-key"
const featureId = "0195b5ac-b250-7a2c-8c33-000000000801"
const commandId = "0195b5ac-b250-7a2c-8c33-000000000802"
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const requestSchema = z.object({
  model: z.string(),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
  messages: z.array(z.object({ role: z.string(), content: z.string().nullable() })),
})
const resultSchema = z.object({ ok: z.literal(true), value: z.unknown() })
const draftSchema = z.object({ draftId: z.string().uuid(), revision: z.number().int() })

function completion(name: string, args: unknown, sequence: number) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: `call-${sequence}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  }
}
function callCad(name: string, args: unknown, sequence: number) {
  return completion("call_cad_tool", { name, arguments: args }, sequence)
}
function finalStream(content: string) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`
}

async function saved(page: Page) {
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
    { timeout: 30_000 },
  )
}
async function openChat(page: Page) {
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
  await expect(panel).toBeVisible()
  return panel
}
async function connect(page: Page) {
  const panel = await openChat(page)
  await panel.getByRole("combobox", { name: "Provider", exact: true }).click()
  await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
  await panel
    .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
    .fill(endpoint)
  await panel.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
  await panel.getByLabel("API key (optional)", { exact: true }).fill(key)
  await panel
    .getByRole("button", { name: "Connect and enable project access", exact: true })
    .click()
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  return panel
}
async function inspectProject(page: Page) {
  return z
    .object({
      id: z.string().uuid(),
      revision: z.number().int(),
      features: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
    })
    .parse(
      await page.evaluate(`(async () => {
    // Import the running graph's URL, including Vite's current HMR identity.
    const path = performance.getEntriesByType("resource").map(entry => entry.name)
      .reverse().find(url => new URL(url).pathname === "/src/document/document-controller.ts")
    if (!path) throw new Error("The active document module was not loaded.")
    const app = await import(path)
    const report = app.getDocumentControllerState().report
    if (!report) throw new Error("Missing active project.")
    return {
      id: report.snapshot.id,
      revision: report.snapshot.revision,
      features: report.snapshot.features.map(({ id, label }) => ({ id, label })),
    }
  })()`),
    )
}

async function storedValues(page: Page) {
  return z.string().parse(await page.evaluate(`Object.values(localStorage).join("\\n")`))
}

async function reviewBesideChat(page: Page) {
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  const [reviewBounds, chatBounds] = await Promise.all([review.boundingBox(), panel.boundingBox()])
  expect(reviewBounds).not.toBeNull()
  expect(chatBounds).not.toBeNull()
  if (!reviewBounds || !chatBounds) throw new Error("Missing review or chat bounds.")
  expect(reviewBounds.x + reviewBounds.width).toBeLessThanOrEqual(chatBounds.x + 1)
  expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true)
}

async function scriptedBoxApi(page: Page) {
  let calls = 0,
    draftId = "",
    draftRevision = 0
  const results: unknown[] = []
  function nextResponse(previous: unknown) {
    const step = calls++
    let response: unknown
    switch (step) {
      case 0:
        response = completion("discover_cad_tools", { query: "create box", limit: 2 }, step)
        break
      case 1:
        expect(
          z
            .object({ tools: z.array(z.object({ name: z.string() })) })
            .parse(previous)
            .tools.some((tool) => tool.name === "create_box"),
        ).toBe(true)
        response = callCad("model_info", {}, step)
        break
      case 2: {
        const info = z
          .object({ summary: z.object({ revision: z.number().int() }) })
          .parse(resultSchema.parse(previous).value)
        response = callCad("create_draft", { baseRevision: info.summary.revision }, step)
        break
      }
      case 3: {
        const draft = draftSchema.parse(resultSchema.parse(previous).value)
        draftId = draft.draftId
        draftRevision = draft.revision
        response = callCad(
          "create_box",
          {
            draftId,
            baseRevision: draftRevision,
            featureId,
            commandId,
            label: "API review box",
            widthMm: 10,
            depthMm: 20,
            heightMm: 30,
          },
          step,
        )
        break
      }
      case 4:
        resultSchema.parse(previous)
        response = callCad("preview_draft", { draftId }, step)
        break
      case 5:
        expect(
          z
            .object({ geometry: z.object({ status: z.literal("valid") }) })
            .parse(resultSchema.parse(previous).value).geometry.status,
        ).toBe("valid")
        response = callCad("commit_draft", { draftId }, step)
        break
      default:
        resultSchema.parse(previous)
        return {
          contentType: "text/event-stream",
          body: finalStream("The reviewed API box was created."),
        }
    }
    return {
      contentType: "application/json",
      body: JSON.stringify(response),
    }
  }
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers })
      return
    }
    const request = requestSchema.parse(route.request().postDataJSON())
    expect(request.model).toBe("fixture-model")
    expect(request.tools.map((tool) => tool.function.name)).toEqual([
      "discover_cad_tools",
      "call_cad_tool",
      "ask_user_question",
    ])
    expect(route.request().headers().authorization).toBe(`Bearer ${key}`)
    const last = request.messages.at(-1)
    const previous: unknown = last?.role === "tool" ? JSON.parse(last.content ?? "null") : null
    if (previous) results.push(previous)
    await route.fulfill({ status: 200, headers, ...nextResponse(previous) })
  })
  return { calls: () => calls, results }
}

test("uses the user endpoint and existing CAD draft review before committing an API-authored box", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const api = await scriptedBoxApi(page)
  await page.goto("/")
  await saved(page)
  const before = await inspectProject(page)
  const panel = await connect(page)
  expect(api.calls()).toBe(0)
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Create a 10 by 20 by 30 mm box and let me review it.")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 60_000 })
  await expect(review.getByText("6,000 mm³", { exact: true })).toBeVisible()
  expect(await inspectProject(page)).toEqual(before)
  expect(api.calls()).toBe(6)
  await reviewBesideChat(page)
  await page.screenshot({
    path: "artifacts/native-assistant-workflows/direct-api-review.png",
    animations: "disabled",
  })
  await page.setViewportSize({ width: 1024, height: 768 })
  await reviewBesideChat(page)
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(review).toHaveCount(0)
  await saved(page)
  await expect(panel.getByRole("log")).toContainText("The reviewed API box was created.")
  expect(await inspectProject(page)).toEqual({
    ...before,
    revision: before.revision + 1,
    features: [...before.features, { id: featureId, label: "API review box" }],
  })
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
    "data-rendered-feature-count",
    "1",
  )
  expect(api.calls()).toBe(7)
  const stored = await storedValues(page)
  expect(stored).not.toContain(key)
  expect(stored).toContain("fixture-model")
})

test("Stop discards a real pending CAD review and keeps credentials only in memory across project changes", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const api = await scriptedBoxApi(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await saved(page)
  const before = await inspectProject(page)
  const panel = await connect(page)
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Prepare a box for review.")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 60_000 })
  await reviewBesideChat(page)
  await panel.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(review.getByRole("status")).toHaveText(
    "This review was cancelled because its session or calculation ended.",
  )
  await expect(review.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
  expect(await inspectProject(page)).toEqual(before)
  await review.getByRole("button", { name: "Close", exact: true }).click()
  await expect(review).toHaveCount(0)
  expect(await inspectProject(page)).toEqual(before)
  expect(api.calls()).toBe(6)
  await openApplicationMenuItem(page, "New project")
  await expect.poll(async () => (await inspectProject(page)).id).not.toBe(before.id)
  await saved(page)
  const next = await openChat(page)
  await expect(next.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  await next.getByRole("button", { name: "AI settings", exact: true }).click()
  await expect(next.getByLabel("API key (optional)", { exact: true })).toHaveValue(key)
  await expect(next.getByRole("textbox", { name: "API model", exact: true })).toHaveValue(
    "fixture-model",
  )
  expect((await inspectProject(page)).features).toEqual([])
  expect(api.calls()).toBe(6)
  await page.reload()
  await saved(page)
  const fresh = await openChat(page)
  await expect(fresh.getByLabel("API key (optional)", { exact: true })).toHaveValue("")
  await expect(
    fresh.getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true }),
  ).toHaveValue(endpoint)
  expect(await storedValues(page)).not.toContain(key)
})

test("ignores a late API response after Stop and switching to another project", async ({
  page,
}) => {
  let held: Route | undefined
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") await route.fulfill({ status: 204, headers })
    else held = route
  })
  await page.goto("/")
  await saved(page)
  const before = await inspectProject(page)
  const panel = await connect(page)
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Inspect the current model")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => Boolean(held)).toBe(true)
  await panel.getByRole("button", { name: "Stop", exact: true }).click()
  await openApplicationMenuItem(page, "New project")
  await expect.poll(async () => (await inspectProject(page)).id).not.toBe(before.id)
  await saved(page)
  const next = await inspectProject(page)
  expect(next.id).not.toBe(before.id)
  await held
    ?.fulfill({
      status: 200,
      headers,
      contentType: "application/json",
      body: JSON.stringify(callCad("create_draft", { baseRevision: next.revision }, 99)),
    })
    .catch(() => undefined)
  await expect.poll(async () => (await inspectProject(page)).features).toEqual([])
  const chat = await openChat(page)
  await expect(chat.getByRole("log")).not.toContainText("Inspect the current model")
})

test("shows actionable CORS and invalid-schema failures without executing model writes or saving credentials", async ({
  page,
}) => {
  await page.goto("/")
  await saved(page)
  const before = await inspectProject(page)
  await page.evaluate(`(() => {
    const url = ${JSON.stringify(endpoint)}
    const original = window.fetch.bind(window)
    let calls = 0
    window.fetch = async (input, init) => {
      if (String(input) !== url) return original(input, init)
      if (++calls === 1) throw new TypeError("CORS fixture private provider detail")
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "invalid",
                    type: "function",
                    function: {
                      name: "call_cad_tool",
                      arguments: JSON.stringify({
                        name: "create_box",
                        arguments: { widthMm: "invalid" },
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    }
  })()`)
  const panel = await connect(page)
  const notices = page.getByRole("region", { name: "Notifications", exact: true })
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Inspect the model")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(notices.getByText(/CORS settings/)).toBeVisible()
  await expect(notices).not.toContainText("private provider detail")
  await expect(panel.getByRole("alert")).toHaveCount(0)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Create a box")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(notices.getByText(/invalid arguments/)).toBeVisible()
  await expect(notices).not.toContainText("private provider detail")
  expect(await inspectProject(page)).toEqual(before)
  expect(await storedValues(page)).not.toContain(key)
})
