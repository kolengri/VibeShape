import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStaticEditor } from "./static-editor"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe("local static editor boundary", () => {
  it("scopes native evaluation to a hash-named worker and excludes lookalikes and escaping links", async () => {
    const parent = await mkdtemp(join(tmpdir(), "vibeshape-mcp-static-"))
    roots.push(parent)
    const root = join(parent, "dist")
    await mkdir(join(root, "assets"), { recursive: true })
    await writeFile(join(root, "index.html"), "<html><head></head><body></body></html>")
    await writeFile(join(root, "assets/worker-entry-Abc123_-.js"), "void 0")
    await writeFile(join(root, "assets/worker-entry-lookalike.js"), "void 0")
    await writeFile(join(parent, "private.json"), "{}")
    await symlink(join(parent, "private.json"), join(root, "escape.json"))
    const origin = "http://127.0.0.1:43114"
    const server = await createStaticEditor({ directory: root, origin, api: vi.fn() })
    const get = (path: string) =>
      server(
        new Request(`${origin}${path}`, { method: "HEAD", headers: { Host: "127.0.0.1:43114" } }),
      )
    expect(
      (await get("/assets/worker-entry-Abc123_-.js")).headers.get("content-security-policy"),
    ).toContain("'unsafe-eval'")
    expect(
      (await get("/assets/worker-entry-lookalike.js")).headers.get("content-security-policy"),
    ).not.toContain("'unsafe-eval'")
    expect((await get("/")).headers.get("content-security-policy")).not.toContain("'unsafe-eval'")
    expect((await get("/escape.json")).status).toBe(404)
    expect(
      (await server(new Request(`${origin}/`, { headers: { Host: "attacker.invalid" } }))).status,
    ).toBe(403)
  })
})
