import type {
  AssistantBridge,
  AssistantEvent,
  AssistantSnapshot,
} from "../../packages/automation-api/src/assistant"
import { LOCAL_AUTOMATION_PATH } from "../../packages/automation-api/src/local-session"
import { createEditorProject, expect, test } from "./fixtures"

test.use({ autoCreateProject: false })

async function installAgent(page: Page) {
  const client = { name: "Composer layout fixture", version: "1" }
  await page.route(`**${LOCAL_AUTOMATION_PATH}/*`, async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = path.endsWith("/status")
      ? { protocolVersion: 1, client, paired: false }
      : ["/connect", "/resume", "/renew"].some((endpoint) => path.endsWith(endpoint))
        ? {
            protocolVersion: 1,
            token: "l".repeat(43),
            actor: {
              type: "mcp",
              clientId: "org.vibeshape.composer-layout",
              sessionId: "01900000-0000-7000-8000-000000000001",
            },
            expiresAt: Date.now() + 60 * 60_000,
            client,
          }
        : path.endsWith("/poll")
          ? { protocolVersion: 1, work: null, cancelledRequestIds: [] }
          : { ok: true }
    await route.fulfill({ json: body })
  })
  await page.addInitScript(() => {
    let snapshot: AssistantSnapshot
    let turns = 0
    const listeners = new Set<(event: AssistantEvent) => void>()
    const current = async () => ({ ok: true as const, value: snapshot })
    const bridge: AssistantBridge = {
      protocolVersion: 1,
      async connect(input) {
        snapshot = {
          projectId: input.projectId,
          sessionToken: "layout-token",
          sessionId: "layout-session",
          canResume: true,
          status: "ready",
          modes: [{ id: "review", name: "Auto review" }],
          currentModeId: "review",
          models: [{ id: "sol", name: "6.1 Sol" }],
          currentModelId: "sol",
          configOptions: [
            {
              id: "collaboration",
              name: "Collaboration mode",
              currentValue: "default",
              options: [{ id: "default", name: "Default" }],
            },
            {
              id: "effort",
              name: "Reasoning effort",
              currentValue: "xhigh",
              options: [{ id: "xhigh", name: "Xhigh" }],
            },
            {
              id: "speed",
              name: "Fast mode",
              currentValue: "off",
              options: [{ id: "off", name: "Off" }],
            },
          ],
          authMethods: [],
          attachmentCapabilities: { text: true, images: true },
        }
        return current()
      },
      async prompt() {
        turns += 1
        for (const listener of listeners)
          listener({
            type: "text",
            projectId: snapshot.projectId,
            sessionToken: snapshot.sessionToken,
            text:
              turns === 1
                ? Array.from(
                    { length: 40 },
                    (_, i) =>
                      `Review note ${i + 1}: Keep the lid removable and preserve the wall thickness.`,
                  ).join("\n\n")
                : "Latest answer.",
          })
        return current()
      },
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
    Object.assign(globalThis, { vibeshapeAssistant: bridge })
  })
}

async function connect(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await createEditorProject(page)
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  await panel.getByRole("button", { name: "Configure AI", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "AI settings", exact: true })
  await settings.getByRole("combobox", { name: "Agent", exact: true }).click()
  await page.getByRole("option", { name: "Codex", exact: true }).click()
  await settings.getByRole("button", { name: "Connect agent", exact: true }).click()
  await expect(settings).toBeHidden()
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  return panel
}

async function checkControls(panel: Locator) {
  const composer = panel.getByRole("region", { name: "Message", exact: true })
  const send = composer.getByRole("button", { name: "Send", exact: true })
  const attach = composer.getByRole("button", { name: "Attach files", exact: true })
  for (const name of [
    "Agent mode",
    "Model",
    "Collaboration mode",
    "Reasoning effort",
    "Fast mode",
    "Send",
    "Attach files",
    "Attach current view",
  ]) {
    const control = composer.getByRole("button", { name, exact: true })
    await expect(control).toBeInViewport({ ratio: 1 })
    const inside = await control.evaluate((node) => {
      const parent = node.closest("section")?.getBoundingClientRect()
      const rect = node.getBoundingClientRect()
      return (
        parent &&
        rect.left >= parent.left &&
        rect.right <= parent.right &&
        rect.top >= parent.top &&
        rect.bottom <= parent.bottom
      )
    })
    expect(inside).toBe(true)
  }
  const sendBox = await send.boundingBox()
  const attachBox = await attach.boundingBox()
  expect(sendBox?.y).toBe(attachBox?.y)
  const inputSurface = await composer
    .getByRole("textbox", { name: "Message", exact: true })
    .locator("..")
    .boundingBox()
  const settingsTray = await composer.locator(":scope > div").last().boundingBox()
  const mode = await composer.getByRole("button", { name: "Agent mode", exact: true }).boundingBox()
  if (!inputSurface || !settingsTray || !mode)
    throw new Error("The input surface and session settings must have bounds.")
  const inputBottom = inputSurface.y + inputSurface.height
  expect(settingsTray.x).toBeGreaterThan(inputSurface.x)
  expect(settingsTray.x + settingsTray.width).toBeLessThan(inputSurface.x + inputSurface.width)
  expect(settingsTray.y).toBeLessThan(inputBottom)
  expect(settingsTray.y + settingsTray.height).toBeGreaterThan(inputBottom)
  expect(mode.y).toBeGreaterThanOrEqual(inputBottom)
  expect(await composer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
}

async function checkLayout(page: Page, panel: Locator) {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ["light", "dark"]) {
      for (const zoom of [1, 2]) {
        await page.locator("html").evaluate(
          (root, { theme, zoom }) => {
            root.classList.toggle("dark", theme === "dark")
            root.style.zoom = String(zoom)
            // CSS zoom scales svh; keep the shell within the simulated browser viewport.
            const shell = root.querySelector<typeof root>(".cad-shell")
            if (shell) shell.style.height = `${900 / zoom}px`
          },
          { theme, zoom },
        )
        await checkControls(panel)
        if (["1440-dark-1", "1024-light-2"].includes(`${width}-${theme}-${zoom}`))
          await page.screenshot({
            path: test.info().outputPath(`composer-${theme}-${zoom}x.png`),
          })
      }
    }
  }
}

test("fits compact session controls and returns to the latest turn when sending from older messages", async ({
  page,
}) => {
  await installAgent(page)
  const panel = await connect(page)
  await panel.getByRole("button", { name: "Model", exact: true }).click()
  await expect(page.getByRole("menuitemradio", { name: "6.1 Sol", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel.getByRole("button", { name: "Model", exact: true })).toBeFocused()
  await checkLayout(page, panel)
  const composer = panel.getByRole("region", { name: "Message", exact: true })
  const input = composer.getByRole("textbox", { name: "Message", exact: true })
  const send = composer.getByRole("button", { name: "Send", exact: true })
  await page.locator("html").evaluate((root) => {
    root.style.zoom = "1"
    root.querySelector<typeof root>(".cad-shell")?.style.removeProperty("height")
  })
  const emptyHeight = await input.evaluate((node) => node.clientHeight)
  await input.fill(Array.from({ length: 30 }, () => "A longer message line.").join("\n"))
  const expandedHeight = await input.evaluate((node) => node.clientHeight)
  expect(expandedHeight).toBeGreaterThan(emptyHeight)
  expect(expandedHeight).toBeLessThanOrEqual(160)
  expect(await input.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  await input.fill("Review the model")
  await send.click()
  const log = panel.getByRole("log")
  await expect(log).toContainText("Review note 40")
  await log.evaluate((node) => {
    node.scrollTop = 0
    node.dispatchEvent(new Event("scroll"))
  })
  expect(
    await log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
  ).toBeGreaterThan(300)
  await input.fill("Now check the lid")
  await input.press("Control+Enter")
  await expect(log).toContainText("Latest answer.")
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(1)
  await expect(input).toHaveValue("")
})

import type { Locator, Page } from "@playwright/test"
