import type {
  AssistantBridge,
  AssistantSnapshot,
} from "../../packages/automation-api/src/assistant"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("retains the canvas and hidden chat while explicitly attaching the current camera view", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => {
    let snapshot: AssistantSnapshot
    const state = { connects: 0, disconnects: 0 }
    const current = async () => ({ ok: true as const, value: snapshot })
    const bridge: AssistantBridge = {
      protocolVersion: 1,
      async connect(input) {
        state.connects++
        snapshot = {
          projectId: input.projectId,
          sessionToken: "fixture-token",
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
      async disconnect() {
        state.disconnects++
        return current()
      },
      respondPermission: current,
      setMode: current,
      setModel: current,
      setConfigOption: current,
      respondQuestion: current,
      authenticate: current,
      onEvent: () => () => {},
    }
    Object.assign(globalThis, { vibeshapeAssistant: bridge, chatOverlayFixture: state })
  })
  await page.goto("/")
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box" })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  const canvas = viewport.locator("canvas")
  await expect(page.getByRole("form", { name: "Create box" })).not.toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  const originalBounds = await canvas.boundingBox()
  await canvas.evaluate((element) => {
    Object.assign(globalThis, { retainedViewportCanvas: element })
  })
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "AI chat", exact: true })
  await panel.getByRole("combobox", { name: "Agent", exact: true }).click()
  await page.getByRole("option", { name: "Codex", exact: true }).click()
  await panel.getByRole("button", { name: "Connect agent", exact: true }).click()
  const message = panel.getByRole("textbox", { name: "Message", exact: true })
  await expect(message).toBeEnabled()
  await message.fill("Inspect the highlighted corner")
  await message.evaluate((element) => {
    const browser = element.ownerDocument.defaultView
    if (!browser) throw new Error("The composer must belong to a browser window.")
    const files = new browser.DataTransfer()
    files.items.add(new browser.File(["width=20 mm"], "dimensions.txt", { type: "text/plain" }))
    element.dispatchEvent(
      new browser.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: files }),
    )
  })
  await expect(
    panel.getByRole("button", { name: "Remove dimensions.txt", exact: true }),
  ).toBeVisible()
  await panel.getByRole("button", { name: "Attach current view", exact: true }).click()
  const thumbnail = panel.locator('img[src^="data:image/png;base64,"]')
  await expect(thumbnail).toBeVisible()
  const first = await thumbnail.getAttribute("src")
  expect(
    await thumbnail.evaluate((element) => Reflect.get(element, "naturalWidth")),
  ).toBeGreaterThan(100)
  await panel.getByRole("button", { name: "Close chat", exact: true }).click()
  await expect(panel).not.toBeVisible()
  expect(await canvas.boundingBox()).toEqual(originalBounds)
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  await expect(message).toHaveValue("Inspect the highlighted corner")
  await expect(thumbnail).toHaveAttribute("src", first ?? "")
  expect(await canvas.boundingBox()).toEqual(originalBounds)
  expect(
    await canvas.evaluate(
      (element) => element === Reflect.get(globalThis, "retainedViewportCanvas"),
    ),
  ).toBe(true)
  expect(await page.evaluate(() => Reflect.get(globalThis, "chatOverlayFixture"))).toEqual({
    connects: 1,
    disconnects: 0,
  })
  await panel.getByRole("button", { name: "Remove viewport.png", exact: true }).click()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The retained viewport must remain visible")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2 + 30, {
    steps: 8,
  })
  await page.mouse.up({ button: "middle" })
  await panel.getByRole("button", { name: "Attach current view", exact: true }).click()
  await expect(thumbnail).toBeVisible()
  expect((await thumbnail.getAttribute("src")) === first).toBe(false)
  await page.screenshot({ path: test.info().outputPath("chat-current-view.png") })
})
