import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDesktopUpdateClient } from "./updates"

test("Windows selects and verifies its ZIP while ignoring newer Mac-only releases", async () => {
  const bytes = Buffer.from("Windows ZIP fixture")
  const digest = createHash("sha256").update(bytes).digest("hex")
  const repository = "https://github.com/kolengri/VibeShape"
  const release = (version: string, suffix: string) => ({
    tag_name: `desktop-v${version}`,
    draft: false,
    prerelease: false,
    html_url: `${repository}/releases/tag/desktop-v${version}`,
    assets: [
      {
        name: `VibeShape-${version}-${suffix}`,
        state: "uploaded",
        size: bytes.length,
        digest: `sha256:${digest}`,
        browser_download_url: `${repository}/releases/download/desktop-v${version}/VibeShape-${version}-${suffix}`,
      },
    ],
  })
  const metadata = [
    release("9.0.0", "mac-x64.dmg"),
    release("2.0.0", "win-x64.zip"),
    release("8.0.0", "win-arm64.zip"),
  ]
  const client = createDesktopUpdateClient(
    async (url) => (url.includes("api.github.com") ? Response.json(metadata) : new Response(bytes)),
    "win32",
  )
  const selected = await client.findDesktopUpdate("1.0.0", "x64")
  expect(selected?.fileName).toBe("VibeShape-2.0.0-win-x64.zip")
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-windows-update-"))
  try {
    if (!selected) throw new Error("Missing Windows update")
    const destination = join(directory, selected.fileName)
    await client.downloadDesktopUpdate(selected, destination)
    expect(await readFile(destination)).toEqual(bytes)
    await expect(
      client.downloadDesktopUpdate(
        { ...selected, sha256: "0".repeat(64) },
        join(directory, "bad.zip"),
      ),
    ).rejects.toMatchObject({ failure: { kind: "integrity" } })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  await expect(client.findDesktopUpdate("1.0.0", "arm64")).rejects.toThrow("unsupported")
})
