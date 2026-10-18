import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createDesktopUpdateClient,
  type DesktopRelease,
  type DesktopUpdateTransport,
} from "./updates"

const image = Buffer.from("A desktop disk image fixture.\n".repeat(8192))
const repository = "https://github.com/kolengri/VibeShape"
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function desktopRelease(version = "2.0.0", arch = "arm64"): DesktopRelease {
  const fileName = `VibeShape-${version}-mac-${arch}.dmg`
  return {
    version,
    fileName,
    url: `${repository}/releases/download/desktop-v${version}/${fileName}`,
    releaseUrl: `${repository}/releases/tag/desktop-v${version}`,
    sha256: createHash("sha256").update(image).digest("hex"),
    size: image.byteLength,
  }
}

function githubRelease(version = "2.0.0", arch = "arm64") {
  const release = desktopRelease(version, arch)
  return {
    tag_name: `desktop-v${version}`,
    draft: false,
    prerelease: false,
    html_url: release.releaseUrl,
    name: `Desktop ${version}`,
    assets: [
      {
        name: release.fileName,
        state: "uploaded",
        browser_download_url: release.url,
        digest: `sha256:${release.sha256}`,
        size: release.size,
        download_count: 0,
      },
    ],
  }
}

async function fixture(handler: (url: string, response: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-update-"))
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("logical")
    handler(url ?? "", response)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Missing fixture port.")
  const requests: string[] = []
  const headers: Readonly<Record<string, string>>[] = []
  // Only this explicit test adapter translates logical HTTPS requests onto a local HTTP server.
  const transport: DesktopUpdateTransport = (url, options) => {
    requests.push(url)
    headers.push(options.headers)
    expect(options.redirect).toBe("manual")
    expect(options.credentials).toBe("omit")
    return fetch(`http://127.0.0.1:${address.port}/?logical=${encodeURIComponent(url)}`, {
      ...options,
    })
  }
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
    await rm(directory, { recursive: true, force: true })
  })
  return {
    client: createDesktopUpdateClient(transport),
    directory,
    destination: join(directory, "update.dmg"),
    requests,
    headers,
  }
}

async function metadataFixture(metadata: unknown) {
  return fixture((_url, response) => {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify(metadata))
  })
}

describe("desktop release selection", () => {
  test("skips unrelated source releases and the latest wrong architecture, then compares semver", async () => {
    const source = { ...githubRelease("900.0.0"), tag_name: "cloudflare-occt-0c007be" }
    const draft = { ...githubRelease("50.0.0"), draft: true }
    const prerelease = { ...githubRelease("60.0.0"), prerelease: true }
    const context = await metadataFixture([
      source,
      githubRelease("70.0.0", "x64"),
      githubRelease("2.9.0"),
      githubRelease("2.10.0"),
      draft,
      prerelease,
      githubRelease("80.0.0-beta.1"),
      githubRelease("2.8.0"),
    ])
    expect(await context.client.findDesktopUpdate("2.9.0", "arm64")).toEqual(
      desktopRelease("2.10.0"),
    )
    expect(context.requests).toEqual([
      "https://api.github.com/repos/kolengri/VibeShape/releases?per_page=100&page=1",
    ])
    expect(context.headers[0]).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "VibeShape-Desktop",
    })
  })

  test("selects x64 independently and accepts a stable version above the current prerelease", async () => {
    const context = await metadataFixture([githubRelease("2.0.0"), githubRelease("2.0.0", "x64")])
    expect(await context.client.findDesktopUpdate("2.0.0-beta.1", "x64")).toEqual(
      desktopRelease("2.0.0", "x64"),
    )
  })

  test.each([
    { releases: [] },
    { releases: [{ ...githubRelease(), tag_name: "cloudflare-occt-0c007be" }] },
    { releases: [githubRelease("0.9.0"), githubRelease("1.0.0")] },
    { releases: [githubRelease("10.0.0", "x64")] },
  ])(
    "returns no update when there is no newer compatible desktop release: %j",
    async ({ releases }) => {
      const context = await metadataFixture(releases)
      expect(await context.client.findDesktopUpdate("1.0.0", "arm64")).toBeNull()
    },
  )

  test("rejects invalid current versions before requesting metadata", async () => {
    const context = await metadataFixture([])
    await expect(context.client.findDesktopUpdate("one.two.three", "arm64")).rejects.toThrow(
      "current desktop version is invalid",
    )
    expect(context.requests).toEqual([])
  })

  test("ignores malformed releases and unsafe assets while retaining a valid older update", async () => {
    const good = githubRelease()
    const asset = good.assets[0]
    if (!asset) throw new Error("Missing asset fixture.")
    const invalidAssets = [
      { ...asset, digest: null },
      { ...asset, digest: `sha256:${"g".repeat(64)}` },
      { ...asset, digest: `sha512:${"a".repeat(64)}` },
      { ...asset, state: "new" },
      { ...asset, size: 0 },
      { ...asset, size: -1 },
      { ...asset, size: 1.5 },
      { ...asset, size: 1024 ** 3 + 1 },
      { ...asset, size: "123" },
      {
        ...asset,
        browser_download_url: `http://github.com/kolengri/VibeShape/releases/download/desktop-v2.0.0/${asset.name}`,
      },
      { ...asset, browser_download_url: `https://evil.test/${asset.name}` },
      { ...asset, browser_download_url: `${asset.browser_download_url}?token=secret` },
      { ...asset, browser_download_url: `${asset.browser_download_url}#fragment` },
      {
        ...asset,
        browser_download_url:
          "https://github.com/another/repo/releases/download/desktop-v2.0.0/update.dmg",
      },
      { ...asset, name: "../update.dmg" },
    ]
    const context = await metadataFixture([
      null,
      { ...good, draft: "false" },
      { ...good, tag_name: "desktop-v02.0.0" },
      { ...good, tag_name: "desktop-v2.0.0+build" },
      { ...good, html_url: "https://evil.test/release" },
      { ...good, assets: invalidAssets },
      { ...good, assets: Array.from({ length: 101 }, () => null) },
      githubRelease("1.5.0"),
    ])
    expect(await context.client.findDesktopUpdate("1.0.0", "arm64")).toEqual(
      desktopRelease("1.5.0"),
    )
  })

  test.each([
    { metadata: null },
    { metadata: {} },
    { metadata: Array.from({ length: 101 }, () => null) },
  ])("rejects an invalid or unbounded release list: %j", async ({ metadata }) => {
    const context = await metadataFixture(metadata)
    await expect(context.client.findDesktopUpdate("1.0.0", "arm64")).rejects.toThrow(
      "release list is invalid",
    )
  })

  test("bounds streamed metadata even without a content length", async () => {
    const context = await fixture((_url, response) => {
      response.write(" ".repeat(2 * 1024 * 1024))
      response.end("[]")
    })
    await expect(context.client.findDesktopUpdate("1.0.0", "arm64")).rejects.toThrow(
      "metadata exceeds its size limit",
    )
  })

  test("rejects invalid JSON and does not include response bodies in errors", async () => {
    const context = await fixture((_url, response) => response.end("private response body"))
    await expect(context.client.findDesktopUpdate("1.0.0", "arm64")).rejects.toThrow(
      "metadata is not valid JSON",
    )
  })

  test("does not follow release API redirects", async () => {
    const context = await fixture((_url, response) => {
      response.writeHead(302, { Location: "http://127.0.0.1/private" })
      response.end()
    })
    await expect(context.client.findDesktopUpdate("1.0.0", "arm64")).rejects.toThrow("HTTP 302")
    expect(context.requests).toHaveLength(1)
  })
})

describe("verified desktop downloads", () => {
  test("streams a GitHub redirect into an exclusively published verified file", async () => {
    const release = desktopRelease()
    const redirect =
      "https://release-assets.githubusercontent.com/github-production-release-asset/1/image?signature=test"
    const context = await fixture((url, response) => {
      if (url === release.url) {
        response.writeHead(302, { Location: redirect })
        response.end()
        return
      }
      response.write(image.subarray(0, image.length / 2))
      setTimeout(() => response.end(image.subarray(image.length / 2)), 5)
    })
    const progress: number[] = []
    await context.client.downloadDesktopUpdate(release, context.destination, {
      onProgress: (fraction) => progress.push(fraction),
    })
    expect(await readFile(context.destination)).toEqual(image)
    expect(await readdir(context.directory)).toEqual(["update.dmg"])
    expect(context.requests).toEqual([release.url, redirect])
    expect(progress.length).toBeGreaterThan(1)
    expect(progress[0]).toBeGreaterThan(0)
    expect(progress[0]).toBeLessThan(1)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((value, index) => value >= (progress[index - 1] ?? 0))).toBe(true)
  })

  test.each([
    "http://release-assets.githubusercontent.com/image",
    "https://release-assets.githubusercontent.com.evil.test/image",
    "https://evil.test/image",
    "http://127.0.0.1/private",
    "https://user:password@release-assets.githubusercontent.com/image",
    "https://release-assets.githubusercontent.com:8443/image",
    "https://release-assets.githubusercontent.com/image#fragment",
    "/kolengri/VibeShape/releases/download/desktop-v2.0.0/elsewhere.dmg",
    "file:///tmp/update.dmg",
    "not a url",
  ])("blocks an unsafe redirect without contacting its destination: %s", async (location) => {
    const context = await fixture((_url, response) => {
      response.writeHead(302, { Location: location })
      response.end()
    })
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), context.destination),
    ).rejects.toThrow("redirect")
    expect(context.requests).toHaveLength(1)
    expect(await readdir(context.directory)).toEqual([])
  })

  test("rejects a second redirect even to the allowed release-assets host", async () => {
    const context = await fixture((_url, response) => {
      response.writeHead(302, { Location: "https://release-assets.githubusercontent.com/image" })
      response.end()
    })
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), context.destination),
    ).rejects.toThrow("HTTP 302")
    expect(context.requests).toHaveLength(2)
    expect(await readdir(context.directory)).toEqual([])
  })

  test.each([
    { sha256: "invalid" },
    { sha256: "a".repeat(65) },
    { size: 0 },
    { size: Number.NaN },
    { size: Number.POSITIVE_INFINITY },
    { size: 1024 ** 3 + 1 },
    { version: "2.0.0-beta.1" },
    { fileName: "../payload.dmg" },
    { url: "http://github.com/kolengri/VibeShape/releases/download/desktop-v2.0.0/update.dmg" },
    {
      url: "https://user:password@github.com/kolengri/VibeShape/releases/download/desktop-v2.0.0/update.dmg",
    },
    { releaseUrl: "https://evil.test/release" },
    { unexpected: "field" },
  ])("validates the descriptor again before downloading: %j", async (change) => {
    const context = await fixture((_url, response) => response.end(image))
    await expect(
      context.client.downloadDesktopUpdate({ ...desktopRelease(), ...change }, context.destination),
    ).rejects.toThrow("metadata is invalid")
    expect(context.requests).toEqual([])
    expect(await readdir(context.directory)).toEqual([])
  })

  test("rejects relative destinations without a request or file", async () => {
    const context = await fixture((_url, response) => response.end(image))
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), "update.dmg"),
    ).rejects.toThrow("destination is invalid")
    expect(context.requests).toEqual([])
  })

  test.each(["hash mismatch", "oversized body", "short body", "interrupted connection"])(
    "removes every partial and does not publish after %s",
    async (failure) => {
      const context = await fixture((_url, response) => {
        if (failure === "hash mismatch") {
          response.end(Buffer.alloc(image.length))
        } else if (failure === "oversized body") {
          response.write(image)
          response.end("extra")
        } else if (failure === "short body") {
          response.write(image.subarray(0, image.length / 4))
          response.end(image.subarray(image.length / 4, image.length / 2))
        } else {
          response.write(image.subarray(0, image.length / 2))
          setTimeout(() => response.destroy(), 5)
        }
      })
      await expect(
        context.client.downloadDesktopUpdate(desktopRelease(), context.destination),
      ).rejects.toThrow()
      expect(await readdir(context.directory)).toEqual([])
    },
  )

  test("rejects an inconsistent advertised content length before publishing", async () => {
    const context = await fixture((_url, response) => {
      response.setHeader("Content-Length", image.length + 1)
      response.end(image)
    })
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), context.destination),
    ).rejects.toThrow("size does not match")
    expect(await readdir(context.directory)).toEqual([])
  })

  test("cancels a streaming transfer and removes its partial file", async () => {
    const controller = new AbortController()
    const context = await fixture((_url, response) => {
      response.write(image.subarray(0, image.length / 2))
    })
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), context.destination, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toThrow()
    expect(controller.signal.aborted).toBe(true)
    expect(await readdir(context.directory)).toEqual([])
  })

  test("does not start a check or download with an already canceled signal", async () => {
    const context = await metadataFixture([])
    const signal = AbortSignal.abort()
    await expect(context.client.findDesktopUpdate("1.0.0", "arm64", signal)).rejects.toThrow()
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), context.destination, { signal }),
    ).rejects.toThrow()
    expect(context.requests).toEqual([])
    expect(await readdir(context.directory)).toEqual([])
  })

  test("never overwrites an existing destination and cleans the verified partial", async () => {
    const context = await fixture((_url, response) => response.end(image))
    await writeFile(context.destination, "the user's existing file")
    await expect(
      context.client.downloadDesktopUpdate(desktopRelease(), context.destination),
    ).rejects.toThrow("EEXIST")
    expect(await readFile(context.destination, "utf8")).toBe("the user's existing file")
    expect(await readdir(context.directory)).toEqual(["update.dmg"])
  })
})
