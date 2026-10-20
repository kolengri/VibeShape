import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { expect } from "@playwright/test"
import { z } from "zod"
import { assistantResultSchema } from "../../packages/automation-api/src/assistant"
import { createNativeFixture, nativeTestRoot, openNativeEditor } from "./native-fixture"

const pollRequest = z.object({ sequence: z.number().int().positive() })
const agentReceipt = z.object({ event: z.string(), sessionId: z.string().optional() })

/** Exercises the real renderer heartbeat and main broker with the local fake ACP agent. */
export async function probeNativeBackgroundSession() {
  if (process.env.VIBESHAPE_PACKAGED_APP)
    throw new Error("Background session probes require the isolated dynamic-port fixture.")
  const fixture = await createNativeFixture({
    // Suppress startup/license-window flashes in this isolated process only. The acceptance
    // transition below uses showInactive immediately before minimizing the editor.
    bootstrap: `
      const { BrowserWindow } = require("electron");
      BrowserWindow.prototype.show = function () {};
      BrowserWindow.prototype.focus = function () {};
      require(${JSON.stringify(join(nativeTestRoot, "apps/desktop/dist/main.cjs"))});
    `,
  })
  const receipt = join(fixture.directory, "background-agent.jsonl")
  try {
    const native = await fixture.launch()
    const page = await openNativeEditor(native)
    const projectId = new URL(page.url()).searchParams.get("project")
    if (!projectId) throw new Error("The isolated editor has no project identity.")
    const polls: { at: number; status: number; sequence: number }[] = []
    page.on("response", (response) => {
      if (response.url() !== `${fixture.origin}/__vibeshape/automation/poll`) return
      const parsed = pollRequest.safeParse(response.request().postDataJSON())
      if (parsed.success)
        polls.push({
          at: performance.now(),
          status: response.status(),
          sequence: parsed.data.sequence,
        })
    })
    const connected = assistantResultSchema.parse(
      await page.evaluate(
        async (input) => {
          const bridge = Reflect.get(globalThis, "vibeshapeAssistant")
          return bridge.connect(input)
        },
        {
          projectId,
          agent: {
            command: "node",
            args: [
              join(nativeTestRoot, "tests/desktop/fixtures/acp-agent.cjs"),
              receipt,
              "--attach-mcp",
            ],
          },
        },
      ),
    )
    if (!connected.ok) throw new Error(`The fake ACP connection failed: ${connected.code}`)
    const scope = { projectId, sessionToken: connected.value.sessionToken }
    await expect
      .poll(() => polls.filter((entry) => entry.status === 200).length)
      .toBeGreaterThanOrEqual(2)
    const before = assistantResultSchema.parse(
      await page.evaluate(
        async (input) =>
          Reflect.get(globalThis, "vibeshapeAssistant").prompt({ ...input, text: "mcp-info" }),
        scope,
      ),
    )
    if (!before.ok) throw new Error(`The foreground fake ACP read failed: ${before.code}`)
    const editor = await native.evaluate(({ BrowserWindow }, origin) => {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().startsWith(`${origin}/?`),
      )
      if (!window) throw new Error("Missing isolated editor window.")
      return {
        id: window.id,
        initiallyVisible: window.isVisible(),
        backgroundThrottling: window.webContents.getBackgroundThrottling(),
        electron: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
      }
    }, fixture.origin)
    const opened = native.waitForEvent("window")
    await native.evaluate(({ Menu }) => {
      const licenses = Menu.getApplicationMenu()
        ?.items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.label === "Licenses and Source Code")
      if (!licenses) throw new Error("Missing license window action.")
      licenses.click()
    })
    const licenses = await opened
    await licenses.waitForURL(`${fixture.origin}/sources/index.html`)
    const licensePolicy = await native.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().endsWith("/sources/index.html"),
      )
      if (!window) throw new Error("Missing isolated license window.")
      const policy = {
        backgroundThrottling: window.webContents.getBackgroundThrottling(),
        visible: window.isVisible(),
      }
      window.close()
      return policy
    })
    await native.evaluate(async ({ BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id)
      if (!window) throw new Error("Missing isolated editor window.")
      await new Promise<void>((resolve) => {
        window.once("minimize", resolve)
        window.showInactive()
        window.minimize()
      })
    }, editor.id)
    const started = performance.now()
    // Do not evaluate renderer JavaScript or drive its UI during the observation interval.
    await delay(21_000)
    const ended = performance.now()
    const minimized = await native.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isMinimized(),
      editor.id,
    )
    const hiddenPolls = polls.filter((entry) => entry.at >= started && entry.at <= ended)
    const boundaries = [
      started,
      ...hiddenPolls.filter((entry) => entry.status === 200).map((entry) => entry.at),
      ended,
    ]
    const maxGapMs = Math.max(
      ...boundaries.slice(1).map((at, index) => at - (boundaries[index] ?? started)),
    )
    const after = assistantResultSchema.parse(
      await page.evaluate(
        async (input) =>
          Reflect.get(globalThis, "vibeshapeAssistant").prompt({ ...input, text: "mcp-info" }),
        scope,
      ),
    )
    const records = (await readFile(receipt, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentReceipt.parse(JSON.parse(line)))
    return {
      ...editor,
      origin: fixture.origin,
      isolatedProfile:
        (await native.evaluate(({ app }) => app.getPath("userData"))) === fixture.profile,
      packaged: fixture.packaged,
      minimized,
      observedMs: ended - started,
      freshSuccessfulPolls: hiddenPolls.filter((entry) => entry.status === 200).length,
      pollStatuses: [...new Set(hiddenPolls.map((entry) => entry.status))],
      sequenceRestarts: hiddenPolls
        .slice(1)
        .filter((entry, index) => entry.sequence <= (hiddenPolls[index]?.sequence ?? 0)).length,
      maxGapMs,
      fakeAcpReadAfterMinimize: after.ok,
      sameAcpSession:
        after.ok &&
        after.value.sessionId === connected.value.sessionId &&
        after.value.sessionToken === connected.value.sessionToken,
      fakeAcpReadCount: records.filter((entry) => entry.event === "mcp-read").length,
      licensePolicy,
    }
  } finally {
    await fixture.cleanup()
  }
}
