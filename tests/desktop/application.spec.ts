import { readFile } from "node:fs/promises"
import { type ElectronApplication, expect, test } from "@playwright/test"
import { openApplicationMenuItem } from "../e2e/application-menu-support"
import { invokeModelCommand } from "../e2e/model-command-support"

import { createNativeFixture, openNativeEditor } from "./native-fixture"

test("native launch preserves CAD, backups and the profile across window close and app restart", async () => {
  const testInfo = test.info()
  const fixture = await createNativeFixture()
  const { profile, origin, packaged } = fixture
  const backup = testInfo.outputPath("desktop-project.vshape")
  let native: ElectronApplication | undefined
  const launch = fixture.launch
  try {
    native = await launch()
    let page = await openNativeEditor(native)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    expect(await native.evaluate(({ app }) => app.getPath("userData"))).toBe(profile)
    expect(await native.evaluate(({ app }) => app.isPackaged)).toBe(packaged)
    if (packaged) {
      for (const asset of [
        "desktop-licenses.txt",
        "Electron-LICENSE.txt",
        "Electron-LICENSES.chromium.html",
        "desktop-macos.md",
      ]) {
        const response = await fetch(`${origin}/sources/${asset}`)
        expect(response.status).toBe(200)
        await response.body?.cancel()
      }
    }
    expect(new URL(page.url()).origin).toBe(origin)
    expect(
      await native.evaluate(({ app, BrowserWindow }) => {
        const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
        return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed
      }),
    ).toBe(true)
    expect(await page.evaluate(() => typeof Reflect.get(globalThis, "require"))).toBe("undefined")
    expect(await page.evaluate(() => typeof Reflect.get(globalThis, "process"))).toBe("undefined")
    await expect(
      page.getByRole("button", { name: "Enable AI session", exact: true }),
    ).toBeDisabled()
    expect(await fetch(`${origin}/__vibeshape/automation/status`).then((r) => r.status)).toBe(403)

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
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    const projectUrl = page.url()
    expect(new URL(projectUrl).searchParams.get("project")).toBeTruthy()

    await native.evaluate(({ session }, path) => {
      session.defaultSession.once("will-download", (_event, item) => item.setSavePath(path))
    }, backup)
    await openApplicationMenuItem(page, "Save project (.vshape)")
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
    expect(await fetch(origin).then((r) => r.status)).toBe(200)
    const windowReady = native.waitForEvent("window")
    await native.evaluate(({ app }) => app.emit("activate"))
    await windowReady
    page = await openNativeEditor(native, { projectName: "Untitled project" })
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
        fetch(origin)
          .then(() => true)
          .catch(() => false),
      )
      .toBe(false)

    native = await launch()
    page = await openNativeEditor(native, { projectName: "Untitled project" })
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
    await fixture.cleanup()
  }
})
