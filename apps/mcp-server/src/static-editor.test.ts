import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "../../../tests/unit/support/bun-test"
import { createStaticEditor } from "./static-editor"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe("local static editor boundary", () => {
  it("streams injected file bodies and opens CORS only for the built opaque-panel runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibeshape-static-runtime-"))
    roots.push(root)
    await mkdir(join(root, "assets"))
    await writeFile(join(root, "index.html"), "<html><head></head><body>Editor</body></html>")
    await writeFile(join(root, "assets/ui-panel-runtime-Abc123_-.js"), "void 0")
    await writeFile(join(root, "assets/ui-panel-runtime-lookalike.js"), "void 0")
    await writeFile(join(root, "assets/untrusted.js"), "void 0")
    await symlink(
      join(root, "assets/untrusted.js"),
      join(root, "assets/ui-panel-runtime-Alias123.js"),
    )
    await writeFile(join(root, "assets/kernel.wasm"), new Uint8Array([0, 97, 115, 109]))
    const fileBody = vi.fn(() => new Blob([new Uint8Array([0, 97, 115, 109])]).stream())
    const origin = "http://127.0.0.1:43115"
    const serve = await createStaticEditor({ directory: root, origin, fileBody })
    const get = (path: string, requestedOrigin = "null", method = "GET") =>
      serve(
        new Request(`${origin}${path}`, {
          method,
          headers: { Host: "127.0.0.1:43115", Origin: requestedOrigin },
        }),
      )
    const panel = await get("/assets/ui-panel-runtime-Abc123_-.js")
    expect(panel.status).toBe(200)
    expect(panel.headers.get("access-control-allow-origin")).toBe("*")
    expect(panel.headers.get("cross-origin-resource-policy")).toBe("cross-origin")
    const alias = await get("/assets/ui-panel-runtime-Alias123.js")
    expect(alias.status).toBe(200)
    expect(alias.headers.get("access-control-allow-origin")).toBeNull()
    expect(alias.headers.get("cross-origin-resource-policy")).toBe("same-origin")
    expect(
      (await get("/assets/ui-panel-runtime-Abc123_-.js", "https://attacker.invalid")).status,
    ).toBe(403)
    expect((await get("/assets/ui-panel-runtime-lookalike.js")).status).toBe(403)
    expect((await get("/")).status).toBe(403)
    const document = await get("/", origin)
    expect(document.headers.get("content-security-policy")).toContain("frame-src 'self'")
    expect(document.headers.get("access-control-allow-origin")).toBeNull()
    const wasm = await get("/assets/kernel.wasm", origin)
    expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]))
    expect(wasm.headers.get("cross-origin-resource-policy")).toBe("same-origin")
    expect(wasm.headers.get("access-control-allow-origin")).toBeNull()
    const bunServe = await createStaticEditor({ directory: root, origin })
    const bunWasm = await bunServe(
      new Request(`${origin}/assets/kernel.wasm`, { headers: { Host: "127.0.0.1:43115" } }),
    )
    expect(new Uint8Array(await bunWasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]))
    fileBody.mockClear()
    expect(await (await get("/assets/kernel.wasm", origin, "HEAD")).text()).toBe("")
    expect(fileBody).not.toHaveBeenCalled()
    expect((await get("/assets/%2e%2e%2fprivate.json", origin)).status).toBe(404)
  })
  it("serves the standalone editor without advertising or exposing automation", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibeshape-editor-only-"))
    roots.push(root)
    const html = "<html><head></head><body>Editor</body></html>"
    await writeFile(join(root, "index.html"), html)
    const origin = "http://127.0.0.1:43114"
    const standalone = await createStaticEditor({ directory: root, origin })
    const request = (path: string) =>
      new Request(`${origin}${path}`, {
        headers: { Host: "127.0.0.1:43114" },
      })
    expect(await (await standalone(request("/"))).text()).toBe(html)
    expect((await standalone(request("/__vibeshape/automation/status"))).status).toBe(404)
    const api = vi.fn(async () => new Response("status"))
    const connected = await createStaticEditor({ directory: root, origin, api })
    expect(await (await connected(request("/"))).text()).toContain(
      'name="vibeshape-local-automation"',
    )
    expect(await (await connected(request("/__vibeshape/automation/status"))).text()).toBe("status")
    expect(api).toHaveBeenCalledTimes(1)
  })
  it("scopes native evaluation to a hash-named worker and excludes lookalikes and escaping links", async () => {
    const parent = await mkdtemp(join(tmpdir(), "vibeshape-mcp-static-"))
    roots.push(parent)
    const root = join(parent, "dist")
    await mkdir(join(root, "assets"), { recursive: true })
    await writeFile(join(root, "index.html"), "<html><head></head><body></body></html>")
    await writeFile(join(root, "assets/worker-entry-Abc123_-.js"), "void 0")
    await writeFile(join(root, "assets/worker-entry-lookalike.js"), "void 0")
    await writeFile(join(root, "assets/sketch-font.ttf"), new Uint8Array([0, 1, 0, 0]))
    await writeFile(join(root, "license.txt"), "Local license notice")
    await writeFile(join(root, "provenance.md"), "# Source provenance")
    await writeFile(join(root, "sources.tar.gz"), "source archive fixture")
    await writeFile(join(parent, "private.json"), "{}")
    await symlink(join(parent, "private.json"), join(root, "escape.json"))
    const origin = "http://127.0.0.1:43114"
    const server = await createStaticEditor({ directory: root, origin, api: vi.fn() })
    const get = (path: string) =>
      server(
        new Request(`${origin}${path}`, { method: "HEAD", headers: { Host: "127.0.0.1:43114" } }),
      )
    const font = await get("/assets/sketch-font.ttf")
    expect(font.status).toBe(200)
    expect(font.headers.get("content-type")).toBe("font/ttf")
    expect(font.headers.get("cross-origin-resource-policy")).toBe("same-origin")
    expect(
      (await get("/assets/worker-entry-Abc123_-.js")).headers.get("content-security-policy"),
    ).toContain("'unsafe-eval'")
    expect(
      (await get("/assets/worker-entry-lookalike.js")).headers.get("content-security-policy"),
    ).not.toContain("'unsafe-eval'")
    expect((await get("/")).headers.get("content-security-policy")).not.toContain("'unsafe-eval'")
    expect((await get("/escape.json")).status).toBe(404)
    expect((await get("/license.txt")).headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    )
    const provenance = await server(
      new Request(`${origin}/provenance.md`, { headers: { Host: "127.0.0.1:43114" } }),
    )
    expect(provenance.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(await provenance.text()).toBe("# Source provenance")
    expect((await get("/sources.tar.gz")).headers.get("content-type")).toBe("application/gzip")
    expect((await get("/sources.tar.gz")).headers.get("x-content-type-options")).toBe("nosniff")
    expect(
      (await server(new Request(`${origin}/`, { headers: { Host: "attacker.invalid" } }))).status,
    ).toBe(403)
  })
})
