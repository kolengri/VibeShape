import { expect, test } from "@playwright/test"
import { createNativeFixture, openNativeEditor } from "./native-fixture"

test("Jev selects a local argument agent, closes after saving and restores its selection", async () => {
  const fixture = await createNativeFixture()
  try {
    const native = await fixture.launch()
    const page = await openNativeEditor(native)
    await page.getByRole("button", { name: "AI chat", exact: true }).click()
    const chat = page.getByRole("complementary", { name: "AI chat", exact: true })
    await chat.getByRole("button", { name: "AI settings", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "AI settings", exact: true })
    await dialog.getByRole("combobox", { name: "Agent", exact: true }).click()
    await page.getByRole("option", { name: "Jev (TypeSafe)", exact: true }).click()
    const helper = dialog.getByRole("combobox", { name: "Argument model", exact: true })
    await helper.click()
    await expect(page.getByRole("option")).toHaveText([
      "None",
      "Claude Code",
      "Codex",
      "OpenCode",
      "API connection (advanced)",
    ])
    await page.getByRole("option", { name: "Codex", exact: true }).click()
    await expect(dialog.getByLabel("Argument model endpoint", { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel("Argument model API key", { exact: true })).toHaveCount(0)
    // Connecting establishes ACP and model access only; no provider inference is sent.
    await dialog.getByLabel("TypeSafe API key", { exact: true }).fill("offline-test-only")
    await dialog.getByRole("button", { name: "Connect agent", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(chat.getByRole("button", { name: "AI settings", exact: true })).toBeFocused()
    await chat.getByRole("button", { name: "AI settings", exact: true }).click()
    await expect(helper).toHaveText("Codex")
    await expect(helper).toBeDisabled()
    await page.screenshot({ path: test.info().outputPath("jev-local-agent.png") })
  } finally {
    await fixture.cleanup()
  }
})
