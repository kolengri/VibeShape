import type {
  AssistantBridge,
  AssistantEvent,
  AssistantSnapshot,
} from "../../packages/automation-api/src/assistant"
import { expect, test } from "./fixtures"

test("keeps recovery copy and retry above message actions in compact chat", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ reducedMotion: "reduce" })
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
  await expect(settings.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Close AI settings", exact: true }).click()
  const message = panel.getByRole("textbox", { name: "Message", exact: true })
  await expect(message).toBeEnabled()
  await message.fill("Keep this draft through recovery")
  await page.clock.install()
  await page.evaluate("globalThis.interruptAssistant()")
  await expect(panel.getByRole("button", { name: "Cancel reconnect" })).toBeVisible()
  await page.clock.runFor(25_000)
  const retry = panel.getByRole("button", { name: "Retry connection", exact: true })
  await expect(retry).toBeVisible()
  const status = panel.getByRole("status").filter({ hasText: "Connection recovery stopped" })
  await expect(status).toContainText("5 attempts")
  const send = panel.getByRole("button", { name: "Send", exact: true })
  const composer = panel.getByRole("region", { name: "Message", exact: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ["light", "dark"]) {
      await page.locator("html").evaluate((root, dark) => {
        root.classList.toggle("dark", dark)
      }, theme === "dark")
      for (const zoom of [1, 2]) {
        await page.locator("html").evaluate((root, value) => {
          root.style.zoom = String(value)
        }, zoom)
        const bounds = await composer.boundingBox()
        const copyBounds = await status.boundingBox()
        const recoveryBounds = await status.locator("..").boundingBox()
        const retryBounds = await retry.boundingBox()
        const sendBounds = await send.boundingBox()
        if (!bounds || !copyBounds || !recoveryBounds || !retryBounds || !sendBounds)
          throw new Error("Recovery feedback and message actions must have visible bounds.")
        expect(recoveryBounds.width).toBeGreaterThan(bounds.width * 0.8)
        expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(retryBounds.y)
        expect(retryBounds.y + retryBounds.height).toBeLessThanOrEqual(sendBounds.y)
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
  await expect(message).toBeEnabled()
  await expect(message).toHaveValue("Keep this draft through recovery")
})
