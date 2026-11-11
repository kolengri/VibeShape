import type { Locator, Page, Route } from "@playwright/test"
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
/** Connection fields live in the AI settings dialog opened from the chat panel. */
async function openAiSettings(page: Page, panel: Locator) {
  await panel.getByRole("button", { name: "AI settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "AI settings", exact: true })
  await expect(settings).toBeVisible()
  return settings
}
async function closeAiSettings(settings: Locator) {
  await settings.getByRole("button", { name: "Close AI settings", exact: true }).click()
  await expect(settings).toHaveCount(0)
}
async function connect(page: Page) {
  const panel = await openChat(page)
  const settings = await openAiSettings(page, panel)
  await settings.getByRole("combobox", { name: "Provider", exact: true }).click()
  await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
  await settings
    .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
    .fill(endpoint)
  await settings.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
  await settings.getByLabel("API key (optional)", { exact: true }).fill(key)
  await settings
    .getByRole("button", { name: "Connect and enable project access", exact: true })
    .click()
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  if (await settings.isVisible()) await closeAiSettings(settings)
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

/**
 * Scripts discovery, a draft box, its exact preview and commit. With `holdCommit`, the model
 * response that would request `commit_draft` is held so the test can stop the turn first.
 */
async function scriptedBoxApi(page: Page, { holdCommit = false } = {}) {
  let held: Route | undefined
  let calls = 0,
    draftId = "",
    draftRevision = 0
  const results: unknown[] = []
  function nextResponse(previous: unknown) {
    const step = calls++
    let response: unknown
    switch (step) {
      case 0:
        // Discovery filters in catalog order; the default page holds create_box beside
        // update_box and create_scale.
        response = completion("discover_cad_tools", { query: "create box", limit: 4 }, step)
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
            label: "API box",
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
          body: finalStream("The API box was created."),
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
    const response = nextResponse(previous)
    if (holdCommit && calls === 6) {
      held = route
      return
    }
    await route.fulfill({ status: 200, headers, ...response })
  })
  return {
    calls: () => calls,
    results,
    held: () => held,
    async releaseHeldCommit() {
      await held
        ?.fulfill({
          status: 200,
          headers,
          contentType: "application/json",
          body: JSON.stringify(callCad("commit_draft", { draftId }, 5)),
        })
        .catch(() => undefined)
    },
  }
}

// ADR-0116: connecting built-in chat authorizes validated model writes through the exact preview
// and revision-checked commit, without a per-stage review, and records a turn checkpoint.
test("uses the user endpoint and commits an API-authored box behind an undoable turn checkpoint", async ({
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
    .fill("Create a 10 by 20 by 30 mm box.")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  await expect(panel.getByRole("log")).toContainText("The API box was created.", {
    timeout: 60_000,
  })
  await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(0)
  await saved(page)
  expect(await inspectProject(page)).toEqual({
    ...before,
    revision: before.revision + 1,
    features: [...before.features, { id: featureId, label: "API box" }],
  })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  expect(api.calls()).toBe(7)
  await page.screenshot({
    path: test.info().outputPath("direct-api-commit.png"),
    animations: "disabled",
  })

  await panel.getByRole("button", { name: "Undo agent changes", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  await saved(page)
  expect((await inspectProject(page)).features).toEqual(before.features)
  expect(api.calls()).toBe(7)
  const stored = await storedValues(page)
  expect(stored).not.toContain(key)
  expect(stored).toContain("fixture-model")
})

test("Stop before the commit request discards the private draft and keeps credentials only in memory across project changes", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const api = await scriptedBoxApi(page, { holdCommit: true })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/")
  await saved(page)
  const before = await inspectProject(page)
  const panel = await connect(page)
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Prepare a box.")
  await panel.getByRole("button", { name: "Send", exact: true }).click()
  // The draft and its exact preview exist privately; the model's commit request is in flight.
  await expect.poll(() => Boolean(api.held()), { timeout: 60_000 }).toBe(true)
  expect(api.calls()).toBe(6)
  await panel.getByRole("button", { name: "Stop", exact: true }).click()
  await api.releaseHeldCommit()
  // The stopped turn ignores the late commit request; the composer is idle again.
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeVisible()
  await saved(page)
  await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Undo agent changes", exact: true })).toHaveCount(
    0,
  )
  expect(await inspectProject(page)).toEqual(before)
  expect(api.calls()).toBe(6)
  await openApplicationMenuItem(page, "New project")
  await expect.poll(async () => (await inspectProject(page)).id).not.toBe(before.id)
  await saved(page)
  const next = await openChat(page)
  await expect(next.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  const nextSettings = await openAiSettings(page, next)
  await expect(nextSettings.getByLabel("API key (optional)", { exact: true })).toHaveValue(key)
  await expect(nextSettings.getByRole("textbox", { name: "API model", exact: true })).toHaveValue(
    "fixture-model",
  )
  await closeAiSettings(nextSettings)
  expect((await inspectProject(page)).features).toEqual([])
  expect(api.calls()).toBe(6)
  await page.reload()
  await saved(page)
  const fresh = await openAiSettings(page, await openChat(page))
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
