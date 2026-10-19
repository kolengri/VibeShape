import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"

const root = resolve(import.meta.dirname, "../..")
const require = createRequire(join(root, "apps/desktop/package.json"))
const executablePath = z.string().parse(require("electron"))

type EditorClipboard = {
  writeText(value: string): Promise<void>
  readText(): Promise<string>
}

test("clipboard writes require the owned editor main frame and reads remain denied", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-native-clipboard-"))
  const bootstrap = `
const {app, clipboard, ClipboardItem, session} = require('electron');
globalThis.desktopClipboardFixture = {};
app.whenReady().then(() => {
  const fixture = globalThis.desktopClipboardFixture;
  fixture.snapshot = clipboard.read().then(items => Promise.all(items.map(async item =>
    new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type =>
      [type, await item.getType(type)]
    ))))
  )));
  const target = session.defaultSession;
  const request = target.setPermissionRequestHandler.bind(target);
  const check = target.setPermissionCheckHandler.bind(target);
  target.setPermissionRequestHandler = handler => { fixture.request = handler; request(handler); };
  target.setPermissionCheckHandler = handler => { fixture.check = handler; check(handler); };
});
require(${JSON.stringify(join(root, "apps/desktop/dist/main.cjs"))});
`
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "native-clipboard-test", version: "0.1.0", main: "bootstrap.cjs" }),
  )
  await writeFile(join(directory, "bootstrap.cjs"), bootstrap)
  const environment = z
    .record(z.string(), z.string())
    .parse({ ...process.env, VIBESHAPE_DESKTOP_EDITOR: join(root, "apps/web/dist") })
  delete environment.ELECTRON_RUN_AS_NODE
  const native = await _electron.launch({
    executablePath,
    args: [directory, `--user-data-dir=${join(directory, "profile")}`],
    env: environment,
  })
  try {
    const page = await native.firstWindow()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await native.evaluate(async () => {
      await Reflect.get(globalThis, "desktopClipboardFixture").snapshot
    })
    await page.evaluate(() => {
      const document = Reflect.get(globalThis, "document")
      const clipboard = Reflect.get(
        Reflect.get(globalThis, "navigator"),
        "clipboard",
      ) as EditorClipboard
      for (const action of ["write", "read"]) {
        const button = document.createElement("button")
        button.textContent = `Clipboard ${action} test`
        button.style.cssText = `position:fixed;right:12px;top:${action === "write" ? 12 : 45}px;z-index:100000`
        button.onclick = async () => {
          try {
            if (action === "write") await clipboard.writeText("VibeShape clipboard fixture")
            else await clipboard.readText()
            button.dataset.result = "allowed"
          } catch {
            button.dataset.result = "denied"
          }
        }
        document.body.append(button)
      }
      for (const opaque of [false, true]) {
        const frame = document.createElement("iframe")
        frame.name = opaque ? "opaque-panel" : "same-origin-panel"
        frame.style.cssText = `position:fixed;left:${opaque ? 330 : 12}px;bottom:12px;width:300px;height:90px;z-index:100000`
        if (opaque) frame.sandbox.add("allow-scripts")
        frame.srcdoc = "<button>Frame clipboard write</button>"
        document.body.append(frame)
      }
    })
    const write = page.getByRole("button", { name: "Clipboard write test", exact: true })
    await write.click()
    await expect(write).toHaveAttribute("data-result", "allowed")
    expect(await native.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "VibeShape clipboard fixture",
    )
    const read = page.getByRole("button", { name: "Clipboard read test", exact: true })
    await read.click()
    await expect(read).toHaveAttribute("data-result", "denied")
    for (const name of ["same-origin-panel", "opaque-panel"]) {
      const button = page
        .frameLocator(`iframe[name="${name}"]`)
        .getByRole("button", { name: "Frame clipboard write" })
      await button.evaluate((element) => {
        Reflect.set(element, "onclick", async () => {
          try {
            const clipboard = Reflect.get(
              Reflect.get(globalThis, "navigator"),
              "clipboard",
            ) as EditorClipboard
            await clipboard.writeText("Rejected frame write")
            Reflect.get(element, "dataset").result = "allowed"
          } catch {
            Reflect.get(element, "dataset").result = "denied"
          }
        })
      })
      await button.click()
      await expect(button).toHaveAttribute("data-result", "denied")
    }
    expect(await native.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "VibeShape clipboard fixture",
    )
    const permissions = await native.evaluate(({ BrowserWindow }) => {
      const fixture = Reflect.get(globalThis, "desktopClipboardFixture")
      const contents = BrowserWindow.getAllWindows()[0]?.webContents
      if (!contents) throw new Error("The editor window is unavailable.")
      const unowned = new BrowserWindow({ show: false })
      const owned = {
        permission: "clipboard-sanitized-write",
        contents,
        origin: "http://127.0.0.1:43115",
        details: { isMainFrame: true, requestingUrl: contents.getURL() },
      }
      const cases = [
        { name: "owned write", ...owned },
        { ...owned, name: "clipboard read", permission: "clipboard-read" },
        { ...owned, name: "other permission", permission: "notifications" },
        { ...owned, name: "null contents", contents: null },
        { ...owned, name: "unowned window", contents: unowned.webContents },
        { ...owned, name: "subframe", details: { ...owned.details, isMainFrame: false } },
        {
          ...owned,
          name: "opaque frame",
          origin: "null",
          details: { isMainFrame: false, requestingUrl: "about:srcdoc" },
        },
        {
          ...owned,
          name: "remote frame",
          origin: "https://example.com",
          details: { isMainFrame: true, requestingUrl: "https://example.com/" },
        },
        { ...owned, name: "missing frame URL", details: { isMainFrame: true } },
      ]
      try {
        return cases.map((entry) => {
          let request: boolean | undefined
          fixture.request(
            entry.contents,
            entry.permission,
            (allowed: boolean) => {
              request = allowed
            },
            entry.details,
          )
          return {
            name: entry.name,
            request,
            check: fixture.check(entry.contents, entry.permission, entry.origin, entry.details),
          }
        })
      } finally {
        unowned.destroy()
      }
    })
    expect(permissions).toEqual([
      { name: "owned write", request: true, check: true },
      { name: "clipboard read", request: false, check: false },
      { name: "other permission", request: false, check: false },
      { name: "null contents", request: false, check: false },
      { name: "unowned window", request: false, check: false },
      { name: "subframe", request: false, check: false },
      { name: "opaque frame", request: false, check: false },
      { name: "remote frame", request: false, check: false },
      { name: "missing frame URL", request: false, check: false },
    ])
  } finally {
    try {
      await native.evaluate(async ({ clipboard }) => {
        const snapshot = await Reflect.get(globalThis, "desktopClipboardFixture").snapshot
        if (snapshot.length) await clipboard.write(snapshot)
        else clipboard.clear()
        const restored = new Set((await clipboard.read()).flatMap((item) => item.types))
        const complete = snapshot.every((item: Electron.ClipboardItem) =>
          item.types.every((type) => restored.has(type)),
        )
        if (!complete)
          throw new Error("The clipboard fixture could not restore every original format.")
      })
    } finally {
      await native.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
})
