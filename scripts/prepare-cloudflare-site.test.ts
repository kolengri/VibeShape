import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDistributionManifest, distributionHash } from "./local-distribution-files"
import { prepareCloudflareSite } from "./prepare-cloudflare-site"

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>()
  return { ...original, cpSync: vi.fn(original.cpSync) }
})

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(overrides: Record<string, string | Uint8Array> = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "vibeshape-cloudflare-"))
  temporary.push(root)
  const source = join(root, "package")
  const files = {
    vibeshape: "launcher",
    "launcher.js": "launcher-code",
    "apps/mcp-server/src/index.js": "local-only-server",
    "apps/web/dist/index.html": "<html><head></head></html>",
    "apps/web/dist/assets/kernel.wasm": "wasm",
    "apps/web/dist/sources/occt-corresponding-source.tar": "occt-source",
    "apps/web/dist/sources/solvespace-corresponding-source.tar.gz": "solver-source",
    "apps/web/dist/sources/LICENSE.txt": "license",
    "apps/web/dist/sources/OCCT-NOTICES.txt": "notices",
    "apps/web/dist/sources/browser-licenses.txt": "browser dependency license texts",
    "apps/web/dist/sources/worker-licenses.txt": "worker dependency license texts",
    "apps/web/dist/sources/shadcn-LICENSE.txt": "copied UI component license text",
    "apps/web/dist/sources/OCCT-REPLACEMENT.txt": "replacement",
    "sources/vibeshape-source.tar": "application-source",
    LICENSE: "license",
    "docs/local-distribution.md": "instructions",
    ...overrides,
  }
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true })
    writeFileSync(join(source, path), bytes)
  }
  writeFileSync(
    join(source, "manifest.json"),
    JSON.stringify(createDistributionManifest(source, "a".repeat(40))),
  )
  return { source, output: join(root, "site") }
}

describe("Cloudflare static staging", () => {
  it("allows only the configured relay and Turnstile on editor documents", () => {
    const { source, output } = fixture()
    prepareCloudflareSite(source, output, "https://vibeshape-mcp.example.com/mcp")
    const headers = readFileSync(join(output, "_headers"), "utf8")
    const sections = headers.split("\n\n")
    const editor = sections.find((section) => section.startsWith("/\n"))
    expect(editor).toContain(
      "connect-src 'self' https://vibeshape-mcp.example.com wss://vibeshape-mcp.example.com",
    )
    expect(editor).toContain("frame-src https://challenges.cloudflare.com")
    expect(
      sections.find((section) => section.startsWith("/assets/worker-entry-*\n")),
    ).not.toContain("example.com")
    expect(headers).not.toContain("*.workers.dev")
  })

  it.each([
    "http://example.com/mcp",
    "https://example.com/wrong",
    "https://example.com/mcp?token=1",
    "https://user@example.com/mcp",
    "https://example.com:8443/mcp",
  ])("rejects an unsafe relay URL: %s", (url) => {
    const { source, output } = fixture()
    expect(() => prepareCloudflareSite(source, output, url)).toThrow("HTTPS /mcp URL")
    expect(existsSync(output)).toBe(false)
  })

  it("stages read-only installed source archives without rewriting them", () => {
    const { source, output } = fixture({ "apps/web/dist/sources/index.html": "source index" })
    const names = ["occt-corresponding-source.tar", "solvespace-corresponding-source.tar.gz"]
    chmodSync(join(source, "apps/web/dist/sources/index.html"), 0o444)
    for (const name of names) chmodSync(join(source, "apps/web/dist/sources", name), 0o444)
    const report = prepareCloudflareSite(source, output)
    for (const name of names) {
      expect(readFileSync(join(output, "sources", name))).toEqual(
        readFileSync(join(source, "apps/web/dist/sources", name)),
      )
      expect(report.archives.find(({ file }) => file === name)?.paths).toEqual([name])
    }
    expect(readFileSync(join(source, "apps/web/dist/sources/index.html"), "utf8")).toBe(
      "source index",
    )
    expect(readFileSync(join(output, "sources/index.html"), "utf8")).toContain(
      "Corresponding source and licenses",
    )
  })

  it("keeps complete reconstructable source while excluding the local MCP server", () => {
    const archive = Buffer.alloc(26 * 1024 * 1024, 37)
    const { source, output } = fixture({
      "apps/web/dist/sources/occt-corresponding-source.tar": archive,
    })
    const report = prepareCloudflareSite(source, output)
    const entry = report.archives.find(({ file }) => file === "occt-corresponding-source.tar")
    expect(entry?.paths).toHaveLength(2)
    const reconstructed = Buffer.concat(
      (entry?.paths ?? []).map((path) => readFileSync(join(output, "sources", path))),
    )
    expect(distributionHash(reconstructed)).toBe(distributionHash(archive))
    expect(existsSync(join(output, "sources/occt-corresponding-source.tar"))).toBe(false)
    expect(readFileSync(join(output, "sources/vibeshape-source.tar"), "utf8")).toBe(
      "application-source",
    )
    expect(report.files.every(({ bytes }) => bytes <= 25 * 1024 * 1024)).toBe(true)
    expect(existsSync(join(output, "apps/mcp-server"))).toBe(false)
    expect(readFileSync(join(output, "_headers"), "utf8")).toContain("/assets/worker-entry-*")
    expect(readFileSync(join(output, "404.html"), "utf8")).toContain("Not found")
  })

  it("rejects a modified input before creating an output", () => {
    const { source, output } = fixture()
    writeFileSync(join(source, "apps/web/dist/assets/kernel.wasm"), "changed")
    expect(() => prepareCloudflareSite(source, output)).toThrow("does not match")
    expect(existsSync(output)).toBe(false)
  })

  it("rejects application source changed after initial verification", () => {
    const { source, output } = fixture()
    const originalCopy = vi.mocked(cpSync).getMockImplementation()
    if (!originalCopy) throw new Error("The filesystem copy mock is missing.")
    vi.mocked(cpSync).mockImplementation((from, to, options) => {
      if (String(from) === join(source, "sources/vibeshape-source.tar"))
        writeFileSync(from, "replaced application source")
      originalCopy(from, to, options)
    })
    try {
      expect(() => prepareCloudflareSite(source, output)).toThrow("source changed while staging")
      expect(existsSync(output)).toBe(false)
    } finally {
      vi.mocked(cpSync).mockImplementation(originalCopy)
    }
  })

  it("refuses publication without bundled third-party notices", () => {
    const { source, output } = fixture({ "apps/web/dist/sources/browser-licenses.txt": " " })
    expect(() => prepareCloudflareSite(source, output)).toThrow("missing third-party notices")
    expect(existsSync(output)).toBe(false)
  })

  it("rejects oversized executable assets and removes only its new staging directory", () => {
    const { source, output } = fixture({
      "apps/web/dist/assets/kernel.wasm": Buffer.alloc(26 * 1024 * 1024, 1),
    })
    expect(() => prepareCloudflareSite(source, output)).toThrow("asset limits")
    expect(existsSync(output)).toBe(false)
    expect(existsSync(source)).toBe(true)
  })

  it("preserves an existing destination and refuses staging inside its source", () => {
    const { source, output } = fixture()
    mkdirSync(output)
    writeFileSync(join(output, "keep.txt"), "keep")
    expect(() => prepareCloudflareSite(source, output)).toThrow("must be new")
    expect(readFileSync(join(output, "keep.txt"), "utf8")).toBe("keep")
    expect(() => prepareCloudflareSite(source, join(source, "nested"))).toThrow("outside")
  })

  it("refuses local automation bootstrap and reserved staging manifests", () => {
    const bootstrap = fixture({
      "apps/web/dist/index.html": '<meta name="vibeshape-local-automation" content="1">',
    })
    expect(() => prepareCloudflareSite(bootstrap.source, bootstrap.output)).toThrow("local MCP")
    const manifest = fixture({ "apps/web/dist/site-manifest.json": "{}" })
    expect(() => prepareCloudflareSite(manifest.source, manifest.output)).toThrow("reserved")
  })
})
