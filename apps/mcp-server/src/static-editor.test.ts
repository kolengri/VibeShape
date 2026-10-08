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
    expect((await get("/sources.tar.gz")).headers.get("content-type")).toBe("application/gzip")
    expect((await get("/sources.tar.gz")).headers.get("x-content-type-options")).toBe("nosniff")
    expect(
      (await server(new Request(`${origin}/`, { headers: { Host: "attacker.invalid" } }))).status,
    ).toBe(403)
  })
})
