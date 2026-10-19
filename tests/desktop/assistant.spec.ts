import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { z } from "zod"
import {
  Client,
  desktopMcpSetupSchema,
  StdioClientTransport,
  type Transport,
} from "../../apps/desktop/test-support/mcp-client"
import { assistantResultSchema } from "../../packages/automation-api/src/assistant"
import { createNativeFixture, nativeTestRoot, openNativeEditor } from "./native-fixture"

const scopeSchema = z.object({
  projectId: z.string(),
  sessionToken: z.string(),
  sessionId: z.string(),
})
const receiptSchema = z.array(
  z.object({
    event: z.string(),
    pid: z.number(),
    relayPid: z.number().int().positive().optional(),
    sessionId: z.string().optional(),
    optionId: z.string().optional(),
    text: z.string().optional(),
  }),
)
async function agentRecords(receipt: string) {
  return receiptSchema.parse(
    (await readFile(receipt, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  )
}
function fixtureProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ESRCH") return false
    throw error
  }
}
const tabs = (page: Page) => page.getByRole("navigation", { name: "Open projects", exact: true })
const panel = (page: Page) => page.getByRole("complementary", { name: "AI chat", exact: true })
const transcript = (page: Page) =>
  panel(page).getByRole("log", { name: "Project conversation", exact: true })
async function renameProject(page: Page, name: string) {
  await page
    .locator("header")
    .getByRole("button", { name: /^Rename / })
    .click()
  const dialog = page.getByRole("dialog", { name: "Rename project", exact: true })
  await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Rename project", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(tabs(page).getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
}
async function openChat(page: Page) {
  if (!(await panel(page).isVisible()))
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
  await expect(panel(page)).toBeVisible()
}
async function send(page: Page, text: string) {
  await panel(page).getByRole("textbox", { name: "Message", exact: true }).fill(text)
  await panel(page).getByRole("button", { name: "Send", exact: true }).click()
}
async function ready(page: Page) {
  await expect(panel(page).getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  await expect(panel(page).getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
}
async function chooseCustomAgent(page: Page) {
  await panel(page).getByRole("combobox", { name: "Agent", exact: true }).click()
  await page.getByRole("option", { name: "Custom ACP agent", exact: true }).click()
}

test("native project chat streams ACP, reviews permissions, stops work and restores only its project history", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const fixture = await createNativeFixture()
  const receipt = join(fixture.directory, "agent-receipt.jsonl")
  const records = () => agentRecords(receipt)
  try {
    const native = await fixture.launch()
    const page = await openNativeEditor(native)
    await renameProject(page, "Chat bracket")
    await openChat(page)
    await page.evaluate(`(() => {
      window.vibeshapeAssistant.onEvent(event => {
        if (event.type === 'snapshot') globalThis.nativeChatSnapshot = event.snapshot;
      });
    })()`)
    await chooseCustomAgent(page)
    await panel(page)
      .getByRole("textbox", { name: "ACP agent executable", exact: true })
      .fill("node")
    await panel(page)
      .getByRole("textbox", { name: "Arguments (JSON array)", exact: true })
      .fill(JSON.stringify([join(nativeTestRoot, "tests/desktop/fixtures/acp-agent.cjs"), receipt]))
    await panel(page).getByRole("button", { name: "Connect agent", exact: true }).click()
    await ready(page)
    const firstScope = scopeSchema.parse(await page.evaluate("globalThis.nativeChatSnapshot"))
    await send(page, "bracket question")
    await expect(transcript(page)).toContainText("Fixture response:")
    await expect(panel(page).getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await expect(transcript(page)).toContainText("Fixture thought")
    await expect(transcript(page)).toContainText("Inspect fixture")
    await expect(transcript(page)).not.toContainText("Harmless inspection complete")
    await writeFile(`${receipt}.continue`, "complete")
    await expect(transcript(page)).toContainText("Harmless inspection complete")
    await expect(transcript(page)).toContainText("Fixture response: bracket question")
    await ready(page)
    for (const [choice, expected] of [
      ["Deny", "deny-once"],
      ["Allow once", "allow-once"],
    ] as const) {
      await send(page, "permission")
      const permission = panel(page).getByRole("group", {
        name: "Agent permission request",
        exact: true,
      })
      await expect(permission).toContainText("Harmless fixture permission")
      await expect(permission.getByRole("button")).toHaveText(["Deny", "Allow once"])
      await permission.getByRole("button", { name: choice, exact: true }).click()
      await expect(transcript(page)).toContainText(`Permission outcome: ${expected}`)
      await ready(page)
    }
    await send(page, "hold")
    await expect(transcript(page)).toContainText("Fixture waiting")
    await panel(page).getByRole("button", { name: "Stop", exact: true }).click()
    await ready(page)
    await expect
      .poll(async () => (await records()).filter((entry) => entry.event === "cancelled").length)
      .toBe(1)
    await expect(transcript(page)).not.toContainText("Late cancelled output")
    expect(
      (await records())
        .filter((entry) => entry.event === "permission")
        .map((entry) => entry.optionId),
    ).toEqual(["deny-once", "allow-once"])

    const firstProjectUrl = page.url()
    await tabs(page).getByRole("button", { name: "New project", exact: true }).click()
    await expect.poll(() => page.url()).not.toBe(firstProjectUrl)
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await renameProject(page, "Chat enclosure")
    await expect
      .poll(async () => (await records()).filter((entry) => entry.event === "terminated").length)
      .toBe(1)
    await openChat(page)
    await expect(transcript(page)).not.toContainText("bracket question")
    await expect(panel(page).getByRole("textbox", { name: "Message", exact: true })).toBeDisabled()
    expect(
      await page.evaluate(
        async (scope) =>
          Reflect.get(globalThis, "vibeshapeAssistant").prompt({
            projectId: scope.projectId,
            sessionToken: scope.sessionToken,
            text: "obsolete request",
          }),
        firstScope,
      ),
    ).toMatchObject({ ok: false, code: "stale-session" })
    await panel(page).getByRole("button", { name: "Connect agent", exact: true }).click()
    await ready(page)
    await send(page, "enclosure question")
    await expect(transcript(page)).toContainText("Fixture response: enclosure question")
    await ready(page)
    await page.screenshot({ path: test.info().outputPath("chat-before-project-switch.png") })
    await tabs(page).getByRole("tab", { name: "Chat bracket", exact: true }).click()
    await expect(page).toHaveURL(firstProjectUrl)
    await expect(
      tabs(page).getByRole("tab", { name: "Chat bracket", exact: true }),
    ).toHaveAttribute("aria-selected", "true")
    await openChat(page)
    await expect(transcript(page)).toContainText("Fixture response: bracket question")
    await expect(transcript(page)).not.toContainText("enclosure question")
    await expect(transcript(page)).not.toContainText("Obsolete project output")
    await expect(panel(page).getByRole("textbox", { name: "Message", exact: true })).toBeDisabled()
    await panel(page).getByRole("button", { name: "Connect agent", exact: true }).click()
    await ready(page)
    await expect
      .poll(async () =>
        (await records())
          .filter((entry) => entry.event === "session/load")
          .map((entry) => entry.sessionId),
      )
      .toEqual([firstScope.sessionId])
    await send(page, "resumed bracket")
    await expect(transcript(page)).toContainText("Fixture response: resumed bracket")
    await ready(page)
    await page.screenshot({ path: test.info().outputPath("native-chat.png") })
  } finally {
    await fixture.cleanup()
  }
})

test("native ACP reconnect waits for its real MCP relay and preserves an external client", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const fixture = await createNativeFixture()
  const receipt = join(fixture.directory, "relay-agent.jsonl")
  const external = new Client({ name: "external-conflict-fixture", version: "1" })
  try {
    const native = await fixture.launch()
    let page = await openNativeEditor(native)
    const projectUrl = page.url()
    await openChat(page)
    await page.evaluate(`(() => {
      window.vibeshapeAssistant.onEvent(event => {
        if (event.type === 'snapshot') globalThis.nativeChatSnapshot = event.snapshot;
      });
    })()`)
    const agent = {
      command: "node",
      args: [join(nativeTestRoot, "tests/desktop/fixtures/acp-agent.cjs"), receipt, "--attach-mcp"],
    }
    await chooseCustomAgent(page)
    await panel(page)
      .getByRole("textbox", { name: "ACP agent executable", exact: true })
      .fill(agent.command)
    await panel(page)
      .getByRole("textbox", { name: "Arguments (JSON array)", exact: true })
      .fill(JSON.stringify(agent.args))
    await panel(page).getByRole("button", { name: "Connect agent", exact: true }).click()
    await ready(page)
    const first = scopeSchema.parse(await page.evaluate("globalThis.nativeChatSnapshot"))
    const input = { projectId: first.projectId, agent }
    let session = first
    for (let count = 0; count < 2; count++) {
      const result = assistantResultSchema.parse(
        await page.evaluate(
          async (input) => Reflect.get(globalThis, "vibeshapeAssistant").connect(input),
          input,
        ),
      )
      expect(result).toMatchObject({ ok: true, value: { status: "ready" } })
      if (!result.ok) throw new Error("Expected replacement of the owned ACP relay.")
      expect(result.value.sessionToken).not.toBe(session.sessionToken)
      session = scopeSchema.parse(result.value)
    }
    expect(
      (await agentRecords(receipt)).filter((entry) => entry.event === "mcp-attached"),
    ).toHaveLength(3)
    const reopened = native.waitForEvent("window")
    await page.close()
    await native.evaluate(({ app }) => app.emit("activate"))
    await reopened
    page = await openNativeEditor(native, { projectName: "Untitled project" })
    await expect(page).toHaveURL(projectUrl)
    const recreated = assistantResultSchema.parse(
      await page.evaluate(
        async (input) => Reflect.get(globalThis, "vibeshapeAssistant").connect(input),
        input,
      ),
    )
    expect(recreated).toMatchObject({ ok: true, value: { status: "ready" } })
    if (!recreated.ok) throw new Error("Expected the recreated window to wait for prior cleanup.")
    await page.evaluate(
      async (scope) => Reflect.get(globalThis, "vibeshapeAssistant").disconnect(scope),
      {
        projectId: recreated.value.projectId,
        sessionToken: recreated.value.sessionToken,
      },
    )
    const setup = desktopMcpSetupSchema.parse(
      await page.evaluate("window.vibeshapeDesktop.getMcpSetup()"),
    )
    await external.connect(
      new StdioClientTransport({ ...setup.mcpServers.vibeshape, stderr: "ignore" }) as Transport,
    )
    expect(
      await page.evaluate(
        async (input) => Reflect.get(globalThis, "vibeshapeAssistant").connect(input),
        input,
      ),
    ).toEqual({ ok: false, code: "mcp-client-conflict" })
    expect((await external.listTools()).tools.some((tool) => tool.name === "model_info")).toBe(true)
    await external.close()
    await expect
      .poll(() =>
        page.evaluate(
          "fetch('/__vibeshape/automation/status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()).then(r=>r.client)",
        ),
      )
      .toBeNull()
    expect(
      await page.evaluate(
        async (input) => Reflect.get(globalThis, "vibeshapeAssistant").connect(input),
        input,
      ),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
    await native.close()
    const records = await agentRecords(receipt)
    expect(records.filter((entry) => entry.event === "mcp-attached")).toHaveLength(5)
    const parents = records
      .filter((entry) => entry.event === "initialized")
      .map((entry) => entry.pid)
    const relays = records.flatMap((entry) => (entry.relayPid ? [entry.relayPid] : []))
    expect(new Set(parents).size).toBe(5)
    expect(new Set(relays).size).toBe(5)
    for (const pid of [...parents, ...relays]) expect(fixtureProcessRunning(pid)).toBe(false)
  } finally {
    await external.close()
    await fixture.cleanup()
  }
})
