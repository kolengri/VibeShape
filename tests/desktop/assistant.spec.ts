import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { z } from "zod"
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
    sessionId: z.string().optional(),
    optionId: z.string().optional(),
    text: z.string().optional(),
  }),
)
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

test("native project chat streams ACP, reviews permissions, stops work and restores only its project history", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const fixture = await createNativeFixture()
  const receipt = join(fixture.directory, "agent-receipt.jsonl")
  const records = async () =>
    receiptSchema.parse(
      (await readFile(receipt, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
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
