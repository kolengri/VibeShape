import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

for (const theme of ["light", "dark"] as const) {
  test(`folds workspace cards by their headings and retains drafts in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await page
      .locator("html")
      .evaluate((element, theme) => element.classList.toggle("dark", theme === "dark"), theme)
    await invokeModelCommand(page, "Primitives", "Cylinder")
    const form = page.getByRole("form", { name: "Create cylinder", exact: true })
    const radius = form.getByRole("combobox", { name: "Radius", exact: true })
    await radius.fill("23 mm")
    const originalField = await radius.elementHandle()
    const canvas = page.locator(".workspace-viewport canvas").first()
    const originalCanvas = await canvas.elementHandle()
    const canvasBounds = await canvas.boundingBox()
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
    const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
    await chat.getByRole("button", { name: "AI settings", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "AI settings", exact: true })
    await settings.getByRole("combobox", { name: "Provider", exact: true }).click()
    await page.getByRole("option", { name: "Custom endpoint", exact: true }).click()
    await settings
      .getByRole("textbox", { name: "Chat Completions endpoint URL", exact: true })
      .fill("https://collapse.example.test/v1/chat/completions")
    await settings.getByRole("textbox", { name: "API model", exact: true }).fill("fixture-model")
    await settings
      .getByRole("button", { name: "Connect and enable project access", exact: true })
      .click()
    await expect(settings).toBeHidden()
    const composer = chat.getByRole("textbox", { name: "Message", exact: true })
    await composer.fill("Keep this unsent draft")
    const originalComposer = await composer.elementHandle()
    const tree = page.getByRole("complementary", { name: "Model tree", exact: true })
    for (const [panel, title, content] of [
      [form, "Create cylinder", form.locator('[data-slot="task-panel-content"]')],
      [chat, "AI chat", chat.locator(".assistant-panel__body")],
      [tree, "Model tree", tree.locator('[data-slot="model-tree-content"]')],
    ] as const) {
      const heading = panel.getByRole("heading", { name: title, exact: true })
      const toggle = heading.getByRole("button")
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
      await toggle.click()
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      await expect(content).toBeHidden()
      const folded = await panel.boundingBox()
      if (!folded) throw new Error("Folded window must retain its heading")
      expect(folded.height).toBeLessThanOrEqual(48)
      await toggle.press("Enter")
      await expect(content).toBeVisible()
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
    }
    await expect(radius).toHaveValue("23 mm")
    await expect(composer).toHaveValue("Keep this unsent draft")
    expect(await radius.evaluate((element, original) => element === original, originalField)).toBe(
      true,
    )
    expect(
      await composer.evaluate((element, original) => element === original, originalComposer),
    ).toBe(true)
    expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
      true,
    )
    await expect.poll(() => canvas.boundingBox()).toEqual(canvasBounds)
    await page.screenshot({ path: `artifacts/right-column-chat-layout/${theme}-workspace.png` })
  })
}
