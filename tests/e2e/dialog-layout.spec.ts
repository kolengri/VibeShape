import type { Locator } from "@playwright/test"
import type { AssistantBridge } from "../../packages/automation-api/src/assistant"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

async function expectWindowLayout(dialog: Locator) {
  const header = dialog.locator("[data-slot=dialog-header]")
  const body = dialog.locator("[data-slot=dialog-body]").first()
  const footer = dialog.locator("[data-slot=dialog-footer]").filter({ visible: true })
  const title = header.getByRole("heading", { level: 2 })
  await expect(title).toHaveCSS("font-size", "16px")
  await expect(title.locator("svg")).toHaveCount(0)
  await expect(header).toBeInViewport({ ratio: 1 })
  await expect(footer).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  const before = await footer.boundingBox()
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  const after = await footer.boundingBox()
  expect(after).toEqual(before)
  await expect(header).toBeInViewport({ ratio: 1 })
  const bodyBounds = await body.boundingBox()
  if (!before || !bodyBounds) throw new Error("The dialog body and footer must have bounds.")
  expect(bodyBounds.y + bodyBounds.height).toBeLessThanOrEqual(before.y + 1)
}

test("native AI settings retain their footer and form association after a failed connection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const unavailable = async () => ({ ok: false as const, code: "request-failed" as const })
    const bridge: AssistantBridge = {
      protocolVersion: 1,
      connect: unavailable,
      prompt: unavailable,
      cancel: unavailable,
      disconnect: unavailable,
      respondPermission: unavailable,
      setMode: unavailable,
      setModel: unavailable,
      setConfigOption: unavailable,
      respondQuestion: unavailable,
      authenticate: unavailable,
      onEvent: () => () => {},
    }
    Object.assign(globalThis, { vibeshapeAssistant: bridge })
  })
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto("/")
  await page.getByRole("button", { name: "AI chat", exact: true }).click()
  const chatBounds = await page
    .getByRole("complementary", { name: "AI chat", exact: true })
    .boundingBox()
  const toolbarBounds = await page.locator("nav[data-sketch-mode]").boundingBox()
  const statusBounds = await page.locator(".cad-shell > footer").boundingBox()
  if (!chatBounds || !toolbarBounds || !statusBounds)
    throw new Error("The editor column and chat must have bounds.")
  expect(chatBounds.y).toBe(toolbarBounds.y)
  expect(chatBounds.y + chatBounds.height).toBe(statusBounds.y + statusBounds.height)
  await page.getByRole("button", { name: "AI settings", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "AI settings", exact: true })
  await dialog.getByRole("combobox", { name: "Agent", exact: true }).click()
  await page.getByRole("option", { name: "Codex", exact: true }).click()
  await dialog.getByText("Advanced connection", { exact: true }).click()
  await dialog.getByRole("button", { name: "Connect agent", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("The agent request failed")
  await expectWindowLayout(dialog)
  await page.screenshot({ path: test.info().outputPath("native-ai-desktop.png") })
  await page.setViewportSize({ width: 512, height: 384 })
  await expectWindowLayout(dialog)
  const body = dialog.locator("[data-slot=dialog-body]")
  expect(
    await body.evaluate((node) => node.scrollHeight > node.clientHeight && node.scrollTop > 0),
  ).toBe(true)
  await page.screenshot({ path: test.info().outputPath("native-ai-compact.png") })
})

for (const theme of ["dark", "light"] as const) {
  for (const width of [1024, 512]) {
    test(`dialog headers and action footers stay visible in ${theme} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 512 ? 384 : 720 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      await page.goto("/")
      await page
        .locator("html")
        .evaluate((node, dark) => node.classList.toggle("dark", dark), theme === "dark")
      await openApplicationMenuItem(page, "Settings…")
      const settings = page.getByRole("dialog", { name: "Settings", exact: true })
      await settings.getByRole("tab", { name: "Workspace", exact: true }).click()
      await expectWindowLayout(settings)
      await page.screenshot({ path: test.info().outputPath(`settings-${theme}-${width}.png`) })
      await settings.getByRole("button", { name: "Done", exact: true }).click()

      await page.getByRole("button", { name: "AI chat", exact: true }).click()
      await page.getByRole("button", { name: "AI settings", exact: true }).click()
      const ai = page.getByRole("dialog", { name: "AI settings", exact: true })
      await ai.getByText("Advanced connection", { exact: true }).click()
      await expectWindowLayout(ai)
      const connect = ai.getByRole("button", {
        name: "Connect and enable project access",
        exact: true,
      })
      expect(await connect.evaluate((node) => Boolean(Reflect.get(node, "form")))).toBe(true)
      await expect(connect).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: test.info().outputPath(`ai-${theme}-${width}.png`) })
      await ai.getByRole("textbox", { name: "API model", exact: true }).fill("layout-fixture")
      await ai.getByRole("button", { name: "Close AI settings", exact: true }).click()
      await expect(page.getByRole("button", { name: "AI settings", exact: true })).toBeFocused()
      if (width === 1024) {
        await invokeModelCommand(page, "Primitives", "Box")
        await expect(page.getByRole("heading", { name: "Create box", exact: true })).toHaveCSS(
          "font-size",
          "16px",
        )
        await page.screenshot({ path: test.info().outputPath(`windows-${theme}-${width}.png`) })
      }
      const titleSizes = await page
        .locator("[data-window-title]:visible")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.ownerDocument.defaultView?.getComputedStyle(node).fontSize),
        )
      expect([...new Set(titleSizes)]).toEqual(["16px"])
      await page.getByRole("button", { name: "Collapse AI chat", exact: true }).click()
      await expect(page.getByRole("button", { name: "AI chat", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false",
      )
      await page.getByRole("button", { name: "AI chat", exact: true }).click()
      await page.getByRole("button", { name: "AI settings", exact: true }).click()
      await expect(ai.getByRole("textbox", { name: "API model", exact: true })).toHaveValue(
        "layout-fixture",
      )
    })
  }
}
