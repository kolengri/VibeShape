import type {
  AssistantBridge,
  AssistantEvent,
  AssistantSnapshot,
} from "../../packages/automation-api/src/assistant"
import { expect, test } from "./fixtures"
import { routeNativeProjectAccess } from "./native-project-access-support"

test("keeps recovery copy and retry in the session tray below message actions in compact chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await routeNativeProjectAccess(
    page,
    { name: "VibeShape assistant", version: "1" },
    "org.vibeshape.recovery-layout",
  )
  await page.addInitScript(() => {
    let snapshot: AssistantSnapshot
    let connects = 0
    const listeners = new Set<(event: AssistantEvent) => void>()
    const current = async () => ({ ok: true as const, value: snapshot })
    const bridge: AssistantBridge = {
      protocolVersion: 1,
      async connect(input) {
        connects += 1
        if (connects > 1 && connects < 7) return { ok: false, code: "agent-exited" }
        snapshot = {
          projectId: input.projectId,
          sessionToken: `fixture-token-${connects}`,
          sessionId: "fixture-session",
          canResume: true,
          status: "ready",
          modes: [],
          currentModeId: null,
          models: [],
          currentModelId: null,
          configOptions: [],
          authMethods: [],
          attachmentCapabilities: { text: true, images: true },
        }
        return current()
      },
      prompt: current,
      cancel: current,
      disconnect: current,
      respondPermission: current,
      setMode: current,
      setModel: current,
      setConfigOption: current,
      respondQuestion: current,
      authenticate: current,
      onEvent(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    Object.assign(globalThis, {
      vibeshapeAssistant: bridge,
      interruptAssistant: () => {
        for (const listener of listeners)
          listener({
            type: "error",
            projectId: snapshot.projectId,
            sessionToken: snapshot.sessionToken,
            code: "agent-exited",
          })
      },
    })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  await panel.getByRole("button", { name: "Configure AI", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "AI settings", exact: true })
  await settings.getByRole("combobox", { name: "Agent", exact: true }).click()
  await page.getByRole("option", { name: "Codex", exact: true }).click()
  await settings.getByRole("button", { name: "Connect agent", exact: true }).click()
  // AI settings closes itself once the agent and its project access are ready.
  await expect(settings).toBeHidden()
  const message = panel.getByRole("textbox", { name: "Message", exact: true })
  await expect(message).toBeEnabled()
  await message.fill("Keep this draft through recovery")
  await page.clock.install()
  await page.evaluate("globalThis.interruptAssistant()")
  await expect(panel.getByRole("button", { name: "Cancel reconnect" })).toBeVisible()
  // Five automatic attempts back off 5, 10, 20, 40 and 60 s (#413) before recovery stops.
  await page.clock.runFor(135_000)
  const retry = panel.getByRole("button", { name: "Retry connection", exact: true })
  await expect(retry).toBeVisible()
  const status = panel.getByRole("status").filter({ hasText: "Connection recovery stopped" })
  await expect(status).toContainText("5 attempts")
  const send = panel.getByRole("button", { name: "Send", exact: true })
  const composer = panel.getByRole("region", { name: "Message", exact: true })
  for (const width of [1440, 1024]) {
    for (const theme of ["light", "dark"]) {
      await page.locator("html").evaluate((root, dark) => {
        root.classList.toggle("dark", dark)
      }, theme === "dark")
      for (const zoom of [1, 2]) {
        // A 200% equivalent viewport; CSS zoom does not scale the viewport units the shell uses.
        await page.setViewportSize({ width: width / zoom, height: 900 / zoom })
        // The viewport grid re-measures in an animation frame; read every box from that layout.
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        const bounds = await composer.boundingBox()
        const copyBounds = await status.boundingBox()
        const recoveryBounds = await status.locator("..").boundingBox()
        const retryBounds = await retry.boundingBox()
        const sendBounds = await send.boundingBox()
        if (!bounds || !copyBounds || !recoveryBounds || !retryBounds || !sendBounds)
          throw new Error("Recovery feedback and message actions must have visible bounds.")
        expect(recoveryBounds.width).toBeGreaterThan(bounds.width * 0.8)
        expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(retryBounds.y)
        // Session controls sit in a tray attached beneath the composer card (#462).
        expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(retryBounds.y)
        expect(retryBounds.x + retryBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        await expect(retry).toBeInViewport({ ratio: 1 })
        await expect(send).toBeInViewport({ ratio: 1 })
        await page.screenshot({
          path: test.info().outputPath(`recovery-${width}-${theme}-${zoom}.png`),
        })
      }
    }
  }
  await retry.focus()
  await page.keyboard.press("Enter")
  await expect(retry).toHaveCount(0)
  // A manual retry restarts the backoff sequence, so its first attempt runs after 5 s.
  await page.clock.runFor(5_000)
  await expect(message).toBeEnabled()
  await expect(message).toHaveValue("Keep this draft through recovery")
})
