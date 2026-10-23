import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  Client,
  DESKTOP_MCP_DESCRIPTOR_NAME,
  desktopMcpSetupSchema,
  ListToolsResultSchema,
  StdioClientTransport,
  type Transport,
} from "../../apps/desktop/test-support/mcp-client"
import { nativeSlicerChooseResultSchema } from "../../packages/slicer-handoff/src/native"

import {
  createNativeFixture,
  nativeElectronExecutable,
  nativeTestRoot,
  openNativeEditor,
} from "./native-fixture"

const root = nativeTestRoot
const executablePath = nativeElectronExecutable
async function launchIsolatedNative() {
  const fixture = await createNativeFixture()
  return { ...fixture, native: await fixture.launch() }
}

test("external stdio MCP automatically attaches to the open native editor and respects Stop AI", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const { native, profile, origin, cleanup } = await launchIsolatedNative()
  const client = new Client({ name: "native-stdio-acceptance", version: "1.0" })
  let stderr = ""
  try {
    const page = await openNativeEditor(native)
    expect(new URL(page.url()).origin).toBe(origin)
    expect(
      await page.evaluate(`({
        platform: window.vibeshapeDesktop?.platform,
        chrome: window.vibeshapeDesktop?.windowChrome,
        require: typeof window.require,
      })`),
    ).toEqual({ platform: "darwin", chrome: "unified", require: "undefined" })
    expect(
      await native.evaluate(
        async ({ BrowserWindow }, { origin, preload }) => {
          const unowned = new BrowserWindow({
            show: false,
            webPreferences: {
              preload,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          })
          try {
            await unowned.loadURL(`${origin}/sources/index.html`)
            return await unowned.webContents.executeJavaScript(
              `Promise.all([
                window.vibeshapeDesktop.getMcpSetup().then(() => false, () => true),
                window.vibeshapeAssistant.cancel({projectId:"unowned",sessionToken:"unowned"}),
                window.vibeshapeSlicer.listApplications()
              ])`,
            )
          } finally {
            unowned.destroy()
          }
        },
        { origin: origin, preload: join(root, "apps/desktop/dist/preload.cjs") },
      ),
    ).toEqual([true, { ok: false, code: "forbidden" }, { ok: false, reason: "forbidden" }])
    await page.evaluate(`(async () => {
      const frame = document.createElement("iframe");
      frame.name = "untrusted-plugin";
      frame.sandbox.add("allow-scripts");
      frame.srcdoc = "<!doctype html><body>Opaque plugin boundary</body>";
      await new Promise(done => {
        frame.onload = () => done();
        document.body.append(frame);
      });
    })()`)
    expect(
      await page
        .frameLocator('iframe[name="untrusted-plugin"]')
        .locator("body")
        .evaluate(`(() => [
          typeof window.vibeshapeDesktop,
          typeof window.vibeshapeAssistant,
          typeof window.vibeshapeSlicer,
        ])()`),
    ).toEqual(["undefined", "undefined", "undefined"])
    const setup = desktopMcpSetupSchema.parse(
      await page.evaluate("window.vibeshapeDesktop?.getMcpSetup()"),
    )
    const configuration = setup.mcpServers.vibeshape
    expect(configuration.command).toBe(executablePath)
    expect(JSON.stringify(configuration)).not.toMatch(/Bearer|token|http:\/\//)
    const descriptor = JSON.parse(
      await readFile(join(profile, DESKTOP_MCP_DESCRIPTOR_NAME), "utf8"),
    )
    expect(JSON.stringify(setup)).not.toContain(descriptor.token)
    const transport = new StdioClientTransport({
      ...configuration,
      env: { PATH: "/usr/bin:/bin", ...configuration.env },
      stderr: "pipe",
    })
    transport.stderr?.on("data", (data) => {
      stderr += data.toString()
    })
    await client.connect(transport as Transport)
    const discovery = await client.request({ method: "tools/list" }, ListToolsResultSchema)
    expect(discovery.tools.some((tool) => tool.name === "model_info")).toBe(true)
    expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      structuredContent: { result: { ok: true } },
    })
    await expect(page.getByRole("button", { name: "Enable AI session", exact: true })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole("button", { name: "Local MCP connection and approval mode", exact: true }),
    ).toHaveText("AI access on · Approve each change")
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
    await client.close()
    await expect
      .poll(async () => {
        const response = await page.request.post(`${origin}/__vibeshape/automation/status`, {
          headers: { Origin: origin },
          data: {},
        })
        return response.json()
      })
      .toMatchObject({ client: null, paired: false })
    expect(stderr).toBe("")
  } finally {
    await client.close()
    await cleanup()
  }
})

test("unified Mac chrome reserves native controls and keeps Preferences functional in full screen", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const { native, cleanup } = await launchIsolatedNative()
  try {
    const page = await native.firstWindow()
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects", exact: true }),
    ).toBeVisible()
    await expect
      .poll(() =>
        native.evaluate(({ Menu }) => {
          const menu = Menu.getApplicationMenu()
          return Object.fromEntries(
            ["settings", "faq", "export", "shortcuts", "createBox"].map((id) => [
              id,
              menu?.getMenuItemById(`native-${id}`)?.enabled,
            ]),
          )
        }),
      )
      .toEqual({ settings: true, faq: true, export: false, shortcuts: false, createBox: false })
    const nativeInput = await native.evaluate(async ({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error("Missing test-owned native window.")
      const inputs: { type: string; key: string; meta: boolean }[] = []
      const listener = (_event: unknown, input: { type: string; key: string; meta: boolean }) =>
        inputs.push({ type: input.type, key: input.key, meta: input.meta })
      window.webContents.on("before-input-event", listener)
      window.focus()
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] })
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] })
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      window.webContents.removeListener("before-input-event", listener)
      return {
        focused: window.isFocused(),
        inputs,
        accelerator: Menu.getApplicationMenu()?.getMenuItemById("native-settings")?.accelerator,
      }
    })
    await writeFile(
      test.info().outputPath("native-accelerator-input.json"),
      JSON.stringify(nativeInput, null, 2),
    )
    expect(nativeInput.accelerator).toBe("CmdOrCtrl+,")
    await native.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("native-settings")
      if (!item) throw new Error("Missing native Preferences command.")
      item.click(item, BrowserWindow.getAllWindows()[0], {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: true,
        triggeredByAccelerator: true,
      })
    })
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Done", exact: true }).click()
    await native.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("native-faq")
      if (!item) throw new Error("Missing native FAQ command.")
      item.click(item, BrowserWindow.getAllWindows()[0], {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        triggeredByAccelerator: false,
      })
    })
    const faq = page.getByRole("dialog", { name: "VibeShape FAQ", exact: true })
    await expect(
      faq.getByRole("textbox", { name: "MCP client configuration", exact: true }),
    ).toHaveValue(/mcp\.cjs/)
    await expect(faq.getByRole("textbox", { name: "MCP server URL", exact: true })).toHaveCount(0)
    await faq.getByRole("button", { name: "Close FAQ", exact: true }).click()
    await openNativeEditor(native)
    const header = page.locator("header[data-unified-chrome=true]")
    await expect(header).toBeVisible()
    expect((await header.boundingBox())?.height).toBe(56)
    const menu = page.getByRole("button", { name: "Application menu", exact: true })
    expect((await menu.boundingBox())?.x).toBeGreaterThanOrEqual(88)
    await native.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setFullScreen(true),
    )
    await expect
      .poll(() =>
        native.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()),
      )
      .toBe(true)
    await expect
      .poll(() =>
        native.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("native-settings")?.enabled,
        ),
      )
      .toBe(true)
    await native.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("native-settings")
      if (!item) throw new Error("Missing native Preferences command.")
      item.click(item, BrowserWindow.getAllWindows()[0], {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        triggeredByAccelerator: false,
      })
    })
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await native.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setFullScreen(false),
    )
    await expect
      .poll(() =>
        native.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()),
      )
      .toBe(false)
  } finally {
    await cleanup()
  }
})

test("native slicer sends private mesh bytes to an explicitly chosen fixture executable", async () => {
  test.skip(
    Boolean(process.env.VIBESHAPE_PACKAGED_APP),
    "The installed app keeps its production port.",
  )
  const { native, profile, cleanup } = await launchIsolatedNative()
  const executable = join(profile, "fixture-slicer")
  await writeFile(executable, `#!/bin/sh\nprintf '%s' "$1" > "$0.receipt"\n`, { mode: 0o700 })
  try {
    const page = await native.firstWindow()
    await expect.poll(() => page.evaluate("window.vibeshapeSlicer?.protocolVersion")).toBe(1)
    await native.evaluate(({ dialog, shell }, executable) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] })
      shell.showItemInFolder = (path) => {
        Reflect.set(globalThis, "nativeSlicerRevealed", path)
      }
    }, executable)
    const choice = nativeSlicerChooseResultSchema.parse(
      await page.evaluate("window.vibeshapeSlicer?.chooseApplication()"),
    )
    expect(choice).toMatchObject({ ok: true, target: { name: "fixture-slicer" } })
    if (!choice?.ok || !choice.target)
      throw new Error("Expected a host-selected fixture executable.")
    const targetId = choice.target.id
    const result = await page.evaluate(
      async (slicerId) =>
        Reflect.get(globalThis, "vibeshapeSlicer")?.send({
          slicerId,
          format: "3mf",
          filename: "Native handoff.3mf",
          file: new Uint8Array([80, 75, 3, 4]),
        }),
      targetId,
    )
    expect(result).toMatchObject({ ok: true, slicerName: "fixture-slicer" })
    if (!result?.ok) throw new Error("Expected fixture launch acceptance.")
    await expect.poll(() => readFile(`${executable}.receipt`, "utf8").catch(() => "")).not.toBe("")
    const path = await readFile(`${executable}.receipt`, "utf8")
    expect(path.startsWith(join(profile, "native-workflows/mesh-handoffs/handoff-"))).toBe(true)
    expect(await readFile(path)).toEqual(Buffer.from([80, 75, 3, 4]))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(
      await page.evaluate(
        async (fileId) => Reflect.get(globalThis, "vibeshapeSlicer")?.reveal(fileId),
        result.fileId,
      ),
    ).toBe(true)
    expect(await native.evaluate(() => Reflect.get(globalThis, "nativeSlicerRevealed"))).toBe(path)
    expect(await page.evaluate('window.vibeshapeSlicer?.reveal("/arbitrary/path")')).toBe(false)
    expect((await stat(join(profile, "native-workflows/assistant"))).mode & 0o777).toBe(0o700)
    expect(await page.evaluate("window.vibeshapeAssistant?.protocolVersion")).toBe(1)
  } finally {
    await cleanup()
  }
})
