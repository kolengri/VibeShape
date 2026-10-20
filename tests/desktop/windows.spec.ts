import { expect, test } from "@playwright/test"
import { invokeModelCommand } from "../e2e/model-command-support"
import { createNativeFixture, openNativeEditor } from "./native-fixture"

test.skip(process.platform !== "win32", "Windows native acceptance requires Windows.")

test("Windows launches with standard chrome and retains projects after restart", async () => {
  const fixture = await createNativeFixture()
  try {
    let native = await fixture.launch()
    let page = await openNativeEditor(native)
    await expect(page.locator(".application-bar")).not.toHaveAttribute(
      "data-unified-chrome",
      "true",
    )
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toBeVisible()
    expect(await page.evaluate("window.vibeshapeDesktop.getMcpSetup()")).toMatchObject({
      mcpServers: { vibeshape: { command: expect.stringMatching(/^[A-Za-z]:[\\/]/) } },
    })
    expect(await page.evaluate("typeof globalThis.require")).toBe("undefined")
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    await form.getByRole("button", { name: "Create box", exact: true }).click()
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    const url = page.url()
    await native.close()
    native = await fixture.launch()
    page = await openNativeEditor(native, { projectName: "Untitled project" })
    await expect(page).toHaveURL(url)
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
  } finally {
    await fixture.cleanup()
  }
})
