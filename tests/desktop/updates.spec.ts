import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"

import { createNativeFixture, nativeTestRoot, openNativeEditor } from "./native-fixture"

const root = nativeTestRoot

test("the native update menu downloads a verified image once and releases its action lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-native-update-"))
  const destination = join(directory, "update.dmg")
  const bytes = "Native update download fixture"
  const digest = createHash("sha256").update(bytes).digest("hex")
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
        digest: `sha256:${digest}`,
        size: Buffer.byteLength(bytes),
        browser_download_url: `https://github.com/kolengri/VibeShape/releases/download/desktop-v0.1.1/${fileName}`,
      },
    ],
  }
  const bootstrap = `
const {dialog} = require('electron');
globalThis.desktopUpdateFixture = {dialogs: [], apiCalls: 0, downloads: 0, saves: 0, choice: 1};
dialog.showMessageBox = async options => {
  const receipt = globalThis.desktopUpdateFixture;
  receipt.dialogs.push(options.message);
  return {response: options.buttons?.includes('Download') ? receipt.choice : 1, checkboxChecked: false};
};
dialog.showSaveDialog = async () => {
  globalThis.desktopUpdateFixture.saves++;
  return {canceled: false, filePath: ${JSON.stringify(destination)}};
};
globalThis.fetch = async (url, options) => {
  if (options.redirect !== 'manual' || options.credentials !== 'omit') throw new Error('Unsafe transport options');
  const receipt = globalThis.desktopUpdateFixture;
  if (url === 'https://api.github.com/repos/kolengri/VibeShape/releases?per_page=100&page=1') {
    receipt.apiCalls++;
    return new Response(JSON.stringify(${JSON.stringify([release])}));
  }
  if (url === ${JSON.stringify(release.assets[0]?.browser_download_url)}) {
    receipt.downloads++;
    return new Response(${JSON.stringify(bytes)});
  }
  throw new Error('Unexpected native update request');
};
require(${JSON.stringify(join(root, "apps/desktop/dist/main.cjs"))});
`
  const fixture = await createNativeFixture({ directory, bootstrap })
  const native = await fixture.launch()
  try {
    const page = await openNativeEditor(native)
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    const enabled = () =>
      native.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("check-for-updates")?.enabled,
      )
    const receipt = () => native.evaluate(() => Reflect.get(globalThis, "desktopUpdateFixture"))
    await expect.poll(receipt).toMatchObject({
      apiCalls: 1,
      downloads: 0,
      saves: 0,
      dialogs: ["VibeShape 0.1.1 is available"],
    })
    await expect.poll(enabled).toBe(true)
    await native.evaluate(({ Menu }) => {
      Reflect.get(globalThis, "desktopUpdateFixture").choice = 0
      const item = Menu.getApplicationMenu()?.getMenuItemById("check-for-updates")
      item?.click()
      item?.click()
    })
    await expect.poll(() => readFile(destination, "utf8").catch(() => "")).toBe(bytes)
    await expect.poll(enabled).toBe(true)
    expect(await receipt()).toMatchObject({
      apiCalls: 2,
      downloads: 1,
      saves: 1,
      dialogs: [
        "VibeShape 0.1.1 is available",
        "VibeShape 0.1.1 is available",
        "The update is ready",
      ],
    })
  } finally {
    await fixture.cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})
