import { existsSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import {
  Client,
  desktopMcpSetupSchema,
  ListToolsResultSchema,
  StdioClientTransport,
  type Transport,
} from "../../apps/desktop/test-support/mcp-client"
import { invokeModelCommand } from "../e2e/model-command-support"
import { createNativeFixture, openNativeEditor } from "./native-fixture"
import { diagnoseWindowsCompilation } from "./windows-compile-diagnostics"

test.skip(process.platform !== "win32", "Windows native acceptance requires Windows.")

test("Windows launches with standard chrome and retains projects after restart", async () => {
  const fixture = await createNativeFixture({
    defaultProfile: Boolean(process.env.VIBESHAPE_PACKAGED_APP),
  })
  try {
    expect(existsSync(fixture.profile)).toBe(false)
    let native = await test.step("Launch the Windows host", () => fixture.launch())
    const profile = await native.evaluate(({ app }) => app.getPath("userData"))
    expect(await realpath(profile)).toBe(await realpath(fixture.profile))
    let page = await test.step("Open the editor", () => openNativeEditor(native))
    await expect(page.locator(".application-bar")).not.toHaveAttribute(
      "data-unified-chrome",
      "true",
    )
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toBeVisible()
    expect(await page.evaluate("window.vibeshapeDesktop.getMcpSetup()")).toMatchObject({
      mcpServers: { vibeshape: { command: expect.stringMatching(/^[A-Za-z]:[\\/]/) } },
    })
    expect(await page.evaluate("typeof globalThis.require")).toBe("undefined")
    await test.step("Create and persist a CAD box", async () => {
      await invokeModelCommand(page, "Primitives", "Box")
      const form = page.getByRole("form", { name: "Create box", exact: true })
      await form.getByRole("button", { name: "Create box", exact: true }).click()
      const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
      await expect(
        page.getByRole("status", { name: "Project save status", exact: true }),
      ).toHaveText("Saved")
    })
    const url = page.url()
    await test.step("Connect the bundled MCP forwarder and enforce project consent", async () => {
      const setup = desktopMcpSetupSchema.parse(
        await page.evaluate("window.vibeshapeDesktop.getMcpSetup()"),
      )
      expect(await realpath(setup.mcpServers.vibeshape.command)).toBe(
        await realpath(fixture.executablePath),
      )
      const client = new Client({ name: "windows-release-acceptance", version: "1.0" })
      let stderr = ""
      try {
        const transport = new StdioClientTransport({
          ...setup.mcpServers.vibeshape,
          stderr: "pipe",
        })
        transport.stderr?.on("data", (data) => {
          stderr = (stderr + data.toString()).slice(-4096)
        })
        await client.connect(transport as Transport)
        const discovery = await client.request({ method: "tools/list" }, ListToolsResultSchema)
        expect(discovery.tools.some((tool) => tool.name === "model_info")).toBe(true)
        expect((await client.callTool({ name: "model_info", arguments: {} })).isError).toBe(true)
        await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
        await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
        expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
          structuredContent: { result: { ok: true } },
        })
        await page.getByRole("button", { name: "Stop AI", exact: true }).click()
        expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
          isError: true,
          structuredContent: { result: { diagnostic: { code: "not-paired" } } },
        })
      } catch (error) {
        console.error(
          "Windows compile probes:",
          await diagnoseWindowsCompilation(setup.mcpServers.vibeshape).catch(() => "unavailable"),
        )
        throw new Error(`Windows MCP acceptance failed. Forwarder stderr: ${stderr}`, {
          cause: error,
        })
      } finally {
        await client.close()
      }
    })
    await test.step("Shut down the host before restart", () => native.close())
    native = await test.step("Restart the Windows host", () => fixture.launch())
    page = await test.step("Reopen the saved project", () =>
      openNativeEditor(native, { projectName: "Untitled project" }))
    await expect(page).toHaveURL(url)
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
  } finally {
    await test.step("Clean up the native fixture", () => fixture.cleanup())
  }
})
