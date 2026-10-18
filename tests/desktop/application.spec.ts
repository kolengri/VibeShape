import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, type ElectronApplication, expect, test } from "@playwright/test"
import { z } from "zod"
import { openApplicationMenuItem } from "../e2e/application-menu-support"
import { invokeModelCommand } from "../e2e/model-command-support"

const root = resolve(import.meta.dirname, "../..")
const require = createRequire(join(root, "apps/desktop/package.json"))
const executablePath = z.string().parse(require("electron"))

test("native launch preserves CAD, backups and the profile across window close and app restart", async () => {
  const testInfo = test.info()
  const profile = await mkdtemp(join(tmpdir(), "vibeshape-desktop-"))
  const backup = testInfo.outputPath("desktop-project.vshape")
  const environment = z
    .record(z.string(), z.string())
    .parse({ ...process.env, ELECTRON_ENABLE_SECURITY_WARNINGS: "true" })
  delete environment.ELECTRON_RUN_AS_NODE
  let native: ElectronApplication | undefined
  const launch = () =>
    _electron.launch({
      executablePath,
      args: [join(root, "apps/desktop"), `--user-data-dir=${profile}`],
      env: environment,
    })
  try {
    native = await launch()
    let page = await native.firstWindow()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    expect(await native.evaluate(({ app }) => app.getPath("userData"))).toBe(profile)
    expect(new URL(page.url()).origin).toBe("http://127.0.0.1:43115")
    expect(
      await native.evaluate(({ app, BrowserWindow }) => {
        const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
        return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed
      }),
    ).toBe(true)
    expect(await page.evaluate(() => typeof Reflect.get(globalThis, "require"))).toBe("undefined")
    expect(await page.evaluate(() => typeof Reflect.get(globalThis, "process"))).toBe("undefined")
    await expect(page.getByRole("button", { name: /Enable AI session|Stop AI/ })).toHaveCount(0)
    expect(
      await fetch("http://127.0.0.1:43115/__vibeshape/automation/status").then((r) => r.status),
    ).toBe(404)

    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    await form.getByRole("combobox", { name: "Width", exact: true }).fill("22 mm")
    await form.getByRole("combobox", { name: "Depth", exact: true }).fill("30 mm")
    await form.getByRole("combobox", { name: "Height", exact: true }).fill("40 mm")
    await form.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const projectUrl = page.url()
    expect(new URL(projectUrl).searchParams.get("project")).toBeTruthy()

    await native.evaluate(({ session }, path) => {
      session.defaultSession.once("will-download", (_event, item) => item.setSavePath(path))
    }, backup)
    await openApplicationMenuItem(page, "Files and projects…")
    await page.getByRole("button", { name: "Save project (.vshape)", exact: true }).click()
    await expect
      .poll(async () =>
        readFile(backup)
          .then((b) => b.subarray(0, 4).toString("hex"))
          .catch(() => ""),
      )
      .toBe("504b0304")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Projects", exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("native-editor.png") })

    await page.evaluate(() => {
      const window = globalThis as unknown as {
        open(url: string, target: string): void
        location: { assign(url: string): void }
      }
      window.open("https://example.com", "_blank")
      window.location.assign("https://example.com")
    })
    // Electron cancels navigation before Playwright clears its pending navigation bookkeeping.
    await expect
      .poll(() =>
        native?.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
        ),
      )
      .toBe(projectUrl)
    await expect
      .poll(() =>
        native?.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript("location.href"),
        ),
      )
      .toBe(projectUrl)
    expect(native.windows()).toHaveLength(1)
    await native.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect.poll(() => native?.windows().length).toBe(0)
    expect(await fetch("http://127.0.0.1:43115").then((r) => r.status)).toBe(200)
    const windowReady = native.waitForEvent("window")
    await native.evaluate(({ app }) => app.emit("activate"))
    page = await windowReady
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await expect(page).toHaveURL(projectUrl)
    expect(errors).toEqual([])
    await native.close()
    native = undefined
    await expect
      .poll(() =>
        fetch("http://127.0.0.1:43115")
          .then(() => true)
          .catch(() => false),
      )
      .toBe(false)

    native = await launch()
    page = await native.firstWindow()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await expect(page).toHaveURL(projectUrl)
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(
      page
        .getByRole("form", { name: "Edit box", exact: true })
        .getByRole("combobox", { name: "Width", exact: true }),
    ).toHaveValue("22 mm")
  } finally {
    await native?.close()
    await rm(profile, { recursive: true, force: true })
  }
})
