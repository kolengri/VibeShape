import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"

const root = resolve(import.meta.dirname, "../..")
const require = createRequire(join(root, "apps/desktop/package.json"))
const executablePath = z.string().parse(require("electron"))

test("native update failures use catalog copy and keep diagnostics out of dialogs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-native-update-errors-"))
  const destination = join(directory, "update.dmg")
  const bytes = "Verified image fixture"
  const fileName = `VibeShape-0.1.1-mac-${process.arch}.dmg`
  const release = {
    tag_name: "desktop-v0.1.1",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/kolengri/VibeShape/releases/tag/desktop-v0.1.1",
    assets: [
      {
        name: fileName,
        state: "uploaded",
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: Buffer.byteLength(bytes),
        browser_download_url: `https://github.com/kolengri/VibeShape/releases/download/desktop-v0.1.1/${fileName}`,
      },
    ],
  }
  const bootstrap = `
const {dialog} = require('electron');
globalThis.desktopUpdateErrors = {mode: 'network', dialogs: [], apiCalls: 0};
dialog.showMessageBox = async options => {
  globalThis.desktopUpdateErrors.dialogs.push(options);
  return {response: 0, checkboxChecked: false};
};
dialog.showSaveDialog = async () => {
  if (globalThis.desktopUpdateErrors.mode === 'unknown') throw new Error('fixture-secret-token from a native diagnostic');
  return {canceled: false, filePath: ${JSON.stringify(destination)}};
};
globalThis.fetch = async url => {
  const state = globalThis.desktopUpdateErrors;
  if (url.startsWith('https://api.github.com/')) {
    state.apiCalls++;
    if (state.mode === 'network') throw new TypeError('fixture-secret-token from a transport diagnostic');
    if (state.mode === 'http') return new Response('fixture-secret-token from the server', {status: 503});
    if (state.mode === 'response') return new Response('fixture-secret-token invalid JSON');
    return new Response(JSON.stringify(${JSON.stringify([release])}));
  }
  return new Response(state.mode === 'integrity' ? 'Corrupted image bytes!' : ${JSON.stringify(bytes)});
};
require(${JSON.stringify(join(root, "apps/desktop/dist/main.cjs"))});
`
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "native-update-errors", version: "0.1.0", main: "bootstrap.cjs" }),
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
    const receipt = () => native.evaluate(() => Reflect.get(globalThis, "desktopUpdateErrors"))
    const enabled = () =>
      native.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("check-for-updates")?.enabled,
      )
    await expect.poll(receipt).toMatchObject({ apiCalls: 1, dialogs: [] })
    await expect.poll(enabled).toBe(true)
    const cases = [
      {
        mode: "network",
        detail:
          "The update service could not be reached. Check your internet connection and try again.",
      },
      {
        mode: "http",
        detail: "The update service returned HTTP 503. Try Check for Updates again later.",
      },
      {
        mode: "response",
        detail:
          "The update service returned an invalid response. Try Check for Updates again later.",
      },
      {
        mode: "integrity",
        detail:
          "The downloaded update failed its integrity check and was not saved. Try downloading it again.",
      },
      {
        mode: "destination",
        detail:
          "The update could not be saved. Choose a writable folder and a new file name, then try again.",
      },
      {
        mode: "unknown",
        detail: "The update could not be completed. Try Check for Updates again.",
      },
    ]
    for (const [index, scenario] of cases.entries()) {
      await test.step(scenario.mode, async () => {
        if (scenario.mode === "destination") await writeFile(destination, "Existing user file")
        await native.evaluate(({ Menu }, mode) => {
          const state = Reflect.get(globalThis, "desktopUpdateErrors")
          state.mode = mode
          state.dialogs = []
          const item = Menu.getApplicationMenu()?.getMenuItemById("check-for-updates")
          item?.click()
          item?.click()
        }, scenario.mode)
        await expect.poll(receipt).toMatchObject({
          apiCalls: index + 2,
          dialogs: expect.arrayContaining([
            {
              type: "error",
              message: "VibeShape could not complete the update",
              detail: scenario.detail,
            },
          ]),
        })
        await expect.poll(enabled).toBe(true)
        expect(JSON.stringify(await receipt())).not.toContain("fixture-secret-token")
      })
    }
  } finally {
    await native.close()
    await rm(directory, { recursive: true, force: true })
  }
})
