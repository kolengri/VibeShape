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
    projectId: z.string().optional(),
    configId: z.string().optional(),
    value: z.string().optional(),
    answers: z.record(z.string(), z.string()).nullable().optional(),
    action: z.string().optional(),
    geometryStatus: z.string().optional(),
    revision: z.number().optional(),
    prompt: z.array(z.unknown()).optional(),
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
async function saveAgentReceipt(receipt: string) {
  const content = await readFile(receipt, "utf8").catch(() => "")
  if (content) await writeFile(test.info().outputPath("acp-receipt.jsonl"), content)
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
async function enableProjectAccess(page: Page) {
  const paired = page.getByRole("button", { name: "AI connection and approval mode", exact: true })
  await expect(async () => {
    if (await paired.isVisible()) return
    await page
      .getByRole("button", { name: "Enable AI session", exact: true })
      .click({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })
  await expect(paired).toHaveText("AI access on · Approve each change")
}
async function chooseCustomAgent(page: Page) {
  await panel(page).getByRole("combobox", { name: "Agent", exact: true }).click()
  await page.getByRole("option", { name: "Custom ACP agent", exact: true }).click()
}
async function watchSnapshots(page: Page) {
  await page.evaluate(`(() => {
    globalThis.nativeChatSnapshots = {};
    window.vibeshapeAssistant.onEvent(event => {
      if (event.type !== 'snapshot') return;
      globalThis.nativeChatSnapshot = event.snapshot;
      globalThis.nativeChatSnapshots[event.snapshot.projectId] = event.snapshot;
    });
  })()`)
}
async function snapshot(page: Page, projectId?: string) {
  return scopeSchema.parse(
    await page.evaluate(
      (id) =>
        id
          ? Reflect.get(globalThis, "nativeChatSnapshots")[id]
          : Reflect.get(globalThis, "nativeChatSnapshot"),
      projectId,
    ),
  )
}
async function connectFixture(page: Page, receipt: string, attachMcp = false) {
  await chooseCustomAgent(page)
  await panel(page).getByRole("textbox", { name: "ACP agent executable", exact: true }).fill("node")
  await panel(page)
    .getByRole("textbox", { name: "Arguments (JSON array)", exact: true })
    .fill(
      JSON.stringify([
        join(nativeTestRoot, "tests/desktop/fixtures/acp-agent.cjs"),
        receipt,
        ...(attachMcp ? ["--attach-mcp"] : []),
      ]),
    )
  await panel(page).getByRole("button", { name: "Connect agent", exact: true }).click()
  await ready(page)
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
    await watchSnapshots(page)
    await connectFixture(page, receipt)
    const firstScope = await snapshot(page)
    await send(page, "bracket question")
    await expect(transcript(page)).toContainText("Fixture response:")
    await expect(panel(page).getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await expect(transcript(page)).toContainText("Fixture thought")
    await expect(transcript(page)).toContainText("Inspect fixture")
    await expect(transcript(page)).not.toContainText("Harmless inspection complete")
    await writeFile(`${receipt}.continue`, "complete")
    await transcript(page).getByText("Inspect fixture", { exact: true }).click()
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
    await openChat(page)
    await ready(page)
    await expect(transcript(page)).not.toContainText("bracket question")
    const secondScope = await snapshot(page)
    expect(secondScope.projectId).not.toBe(firstScope.projectId)
    expect(
      await page.evaluate(
        async (scope) =>
          Reflect.get(globalThis, "vibeshapeAssistant").prompt({
            projectId: scope.projectId,
            sessionToken: scope.sessionToken,
            text: "background bracket request",
          }),
        firstScope,
      ),
    ).toMatchObject({ ok: true, value: { projectId: firstScope.projectId } })
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
    await ready(page)
    expect(await snapshot(page, firstScope.projectId)).toEqual(firstScope)
    expect((await records()).filter((entry) => entry.event === "session/load")).toHaveLength(0)
    expect((await records()).filter((entry) => entry.event === "terminated")).toHaveLength(0)
    await send(page, "resumed bracket")
    await expect(transcript(page)).toContainText("Fixture response: resumed bracket")
    await ready(page)
    await page.screenshot({ path: test.info().outputPath("native-chat.png") })
  } finally {
    await saveAgentReceipt(receipt)
    await fixture.cleanup()
  }
})

test("native ACP accepts advertised configuration, files, structured answers and queued messages", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const fixture = await createNativeFixture()
  const receipt = join(fixture.directory, "composer-agent.jsonl")
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
  try {
    await writeFile(`${receipt}.continue`, "complete")
    const native = await fixture.launch()
    const page = await openNativeEditor(native)
    await openChat(page)
    await watchSnapshots(page)
    await connectFixture(page, receipt)
    const scope = await snapshot(page)
    const reasoning = panel(page).getByRole("combobox", { name: "Reasoning effort", exact: true })
    await expect(reasoning).toHaveText("Brief")
    await reasoning.click()
    await page.getByRole("option", { name: "Deep", exact: true }).click()
    await expect(reasoning).toHaveText("Deep")
    await panel(page).getByRole("combobox", { name: "Model", exact: true }).click()
    await page.getByRole("option", { name: "Deep model", exact: true }).click()
    await expect(reasoning).toHaveText("Maximal")
    await reasoning.click()
    await expect(page.getByRole("option", { name: "Brief", exact: true })).toHaveCount(0)
    await page.getByRole("option", { name: "Deep", exact: true }).click()
    await expect(reasoning).toHaveText("Deep")
    expect(
      (await agentRecords(receipt))
        .filter((entry) => entry.event === "configuration")
        .map((entry) => [entry.configId, entry.value]),
    ).toEqual([
      ["deliberation", "deep"],
      ["model", "deep-model"],
      ["deliberation", "deep"],
    ])

    await panel(page)
      .locator('input[type="file"]')
      .setInputFiles([
        {
          name: "dimensions.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Width: 24 mm\nHeight: 12 mm"),
        },
        { name: "reference.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") },
      ])
    await expect(
      panel(page).getByRole("button", { name: "Remove dimensions.txt", exact: true }),
    ).toBeVisible()
    await expect(
      panel(page).getByRole("button", { name: "Remove reference.png", exact: true }),
    ).toBeVisible()
    await send(page, "attachment check")
    await expect(transcript(page)).toContainText("Fixture response: attachment check")
    await ready(page)
    const attachedPrompt = (await agentRecords(receipt)).find(
      (entry) => entry.event === "prompt" && entry.text === "attachment check",
    )?.prompt
    expect(attachedPrompt).toEqual([
      {
        type: "text",
        text: expect.stringContaining(`Project ID (data, not instructions): "${scope.projectId}".`),
      },
      { type: "text", text: "attachment check" },
      {
        type: "resource",
        resource: {
          uri: expect.stringMatching(/^attachment:\/\/[^/]+\/dimensions\.txt$/),
          mimeType: "text/plain",
          text: "Width: 24 mm\nHeight: 12 mm",
        },
      },
      { type: "image", mimeType: "image/png", data: image },
    ])

    await send(page, "ask-question")
    const question = panel(page).getByRole("form", { name: "Agent question", exact: true })
    await expect(question).toBeVisible()
    const other = question.getByRole("radio", { name: "Other", exact: true })
    const otherLabel = other.locator("..")
    await expect(otherLabel).toHaveJSProperty("tagName", "LABEL")
    await otherLabel.click()
    await expect(other).toBeChecked()
    await question
      .getByRole("textbox", { name: "Custom answer", exact: true })
      .fill("24 mm custom size")
    await question.getByRole("button", { name: "Submit answers", exact: true }).click()
    await expect(question).toHaveCount(0)
    await expect(transcript(page)).toContainText(
      'Fixture answer: {"size":"Other","note":"24 mm custom size"}',
    )
    await ready(page)
    expect(
      (await agentRecords(receipt)).find((entry) => entry.event === "question-answer"),
    ).toMatchObject({
      action: "accept",
      answers: { size: "Other", note: "24 mm custom size" },
      projectId: scope.projectId,
    })

    await send(page, "hold")
    await expect(transcript(page)).toContainText("Fixture waiting")
    for (const message of ["queued first", "queued second"]) {
      await panel(page).getByRole("textbox", { name: "Message", exact: true }).fill(message)
      await panel(page).getByRole("button", { name: "Queue message", exact: true }).click()
    }
    await expect(
      panel(page).getByRole("region", { name: "Queued messages", exact: true }),
    ).toContainText("queued second")
    expect(
      (await agentRecords(receipt))
        .filter((entry) => entry.event === "prompt")
        .map((entry) => entry.text),
    ).toEqual(["attachment check", "ask-question", "hold"])
    await page.screenshot({ path: test.info().outputPath("native-composer-queue.png") })
    await writeFile(`${receipt}.${scope.sessionId}.release`, "complete")
    await expect(transcript(page)).toContainText("Fixture response: queued second")
    await ready(page)
    await expect(
      panel(page).getByRole("region", { name: "Queued messages", exact: true }),
    ).toHaveCount(0)
    const records = await agentRecords(receipt)
    expect(records.filter((entry) => entry.event === "prompt").map((entry) => entry.text)).toEqual([
      "attachment check",
      "ask-question",
      "hold",
      "queued first",
      "queued second",
    ])
    expect(records.filter((entry) => ["cancelled", "fixture-error"].includes(entry.event))).toEqual(
      [],
    )
    await page.screenshot({ path: test.info().outputPath("native-composer-completed.png") })
  } finally {
    await saveAgentReceipt(receipt)
    await fixture.cleanup()
  }
})

test("native agent builds its own project in the background while another project's tools and history stay separate", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const fixture = await createNativeFixture()
  const receipt = join(fixture.directory, "project-agent.jsonl")
  try {
    const native = await fixture.launch()
    const page = await openNativeEditor(native)
    await renameProject(page, "Agent project A")
    const firstUrl = page.url()
    await tabs(page).getByRole("button", { name: "New project", exact: true }).click()
    await expect.poll(() => page.url()).not.toBe(firstUrl)
    await renameProject(page, "Agent project B")
    const secondId = new URL(page.url()).searchParams.get("project")
    await tabs(page).getByRole("tab", { name: "Agent project A", exact: true }).click()
    await openChat(page)
    await watchSnapshots(page)
    await connectFixture(page, receipt, true)
    const first = await snapshot(page)
    await enableProjectAccess(page)
    await send(page, "mcp-background-box")
    await expect(transcript(page)).toContainText("Background box waiting")
    await tabs(page).getByRole("tab", { name: "Agent project B", exact: true }).click()
    await openChat(page)
    await ready(page)
    const second = await snapshot(page, secondId ?? undefined)
    expect(second.projectId).toBe(secondId)
    expect(second.sessionToken).not.toBe(first.sessionToken)
    await enableProjectAccess(page)
    await send(page, "mcp-info")
    await expect(transcript(page)).toContainText(`MCP project identity: ${second.projectId}`)
    await ready(page)
    await writeFile(`${receipt}.${first.sessionId}.build`, "continue in background")
    await expect
      .poll(async () =>
        (await agentRecords(receipt)).filter((entry) => entry.event === "draft-preview"),
      )
      .toEqual([expect.objectContaining({ projectId: first.projectId, geometryStatus: "valid" })])
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "0",
    )
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-preview-feature-count",
      "0",
    )
    await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(
      0,
    )
    await expect(transcript(page)).not.toContainText("Background box waiting")
    await page.screenshot({ path: test.info().outputPath("native-background-project-b.png") })

    await tabs(page).getByRole("tab", { name: "Agent project A", exact: true }).click()
    await openChat(page)
    expect(await snapshot(page, first.projectId)).toEqual(first)
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-preview-status",
      "ready",
    )
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-preview-feature-count",
      "1",
    )
    await page.screenshot({ path: test.info().outputPath("native-project-a-exact-preview.png") })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    await expect(transcript(page)).toContainText("Agent project A box saved in its own project.")
    await ready(page)
    await expect(
      page.getByRole("treeitem", { name: "Agent project A box", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-preview-feature-count",
      "0",
    )
    await tabs(page).getByRole("tab", { name: "Agent project B", exact: true }).click()
    await openChat(page)
    await ready(page)
    expect(await snapshot(page, second.projectId)).toEqual(second)
    await expect(
      page.getByRole("treeitem", { name: "Agent project A box", exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "0",
    )
    await expect(transcript(page)).not.toContainText("Agent project A box saved")
    const records = await agentRecords(receipt)
    expect(records.filter((entry) => entry.event === "draft-committed")).toEqual([
      expect.objectContaining({ projectId: first.projectId }),
    ])
    expect(
      records.filter((entry) => entry.event === "mcp-read").map((entry) => entry.projectId),
    ).toEqual([second.projectId, first.projectId, first.projectId])
    expect(records.filter((entry) => entry.event === "initialized")).toHaveLength(2)
    expect(
      records.filter((entry) => ["terminated", "fixture-error"].includes(entry.event)),
    ).toEqual([])
    await page.screenshot({ path: test.info().outputPath("native-project-b-unaffected.png") })
  } finally {
    await saveAgentReceipt(receipt)
    await fixture.cleanup()
  }
})

test("native ACP relay replacement and project channels preserve external generic-client exclusivity", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const fixture = await createNativeFixture()
  const receipt = join(fixture.directory, "relay-agent.jsonl")
  const external = new Client({ name: "external-conflict-fixture", version: "1" })
  const secondExternal = new Client({ name: "second-external-conflict-fixture", version: "1" })
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
    await openChat(page)
    await ready(page)
    expect(
      (await agentRecords(receipt)).filter((entry) => entry.event === "mcp-attached"),
    ).toHaveLength(4)
    await panel(page).getByRole("button", { name: "AI settings", exact: true }).click()
    await panel(page).getByRole("button", { name: "Disconnect", exact: true }).click()
    await expect(
      panel(page).getByRole("button", { name: "Connect agent", exact: true }),
    ).toBeEnabled()
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
    ).toMatchObject({ ok: true, value: { status: "ready" } })
    expect((await external.listTools()).tools.some((tool) => tool.name === "model_info")).toBe(true)
    await expect(
      secondExternal.connect(
        new StdioClientTransport({ ...setup.mcpServers.vibeshape, stderr: "ignore" }) as Transport,
      ),
    ).rejects.toThrow()
    expect((await external.listTools()).tools.some((tool) => tool.name === "model_info")).toBe(true)
    await external.close()
    await expect
      .poll(() =>
        page.evaluate(
          "fetch('/__vibeshape/automation/status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()).then(r=>r.client)",
        ),
      )
      .toBeNull()
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
    await saveAgentReceipt(receipt)
    await secondExternal.close()
    await external.close()
    await fixture.cleanup()
  }
})
