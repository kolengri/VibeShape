import { afterEach, describe, expect, it } from "bun:test"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { DESKTOP_EDITOR_ORIGIN, startEditorServer } from "./editor-server"

const roots: string[] = []
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-desktop-http-"))
  roots.push(root)
  await mkdir(join(root, "assets"))
  await writeFile(join(root, "index.html"), "<html><head></head><body>Desktop editor</body></html>")
  await writeFile(join(root, "assets/kernel.wasm"), new Uint8Array(1024 * 1024).fill(73))
  await writeFile(join(root, "assets/ui-panel-runtime-Abc123_-.js"), "void 0")
  return root
}

function rawStatus(path: string, headers: Record<string, string | string[]> = {}) {
  return new Promise<number | undefined>((resolve, reject) => {
    const call = request({ hostname: "127.0.0.1", port: 43115, path, headers }, (response) => {
      response.resume()
      response.once("end", () => resolve(response.statusCode))
    })
    call.once("error", reject)
    call.end()
  })
}

describe("desktop editor HTTP host", () => {
  it("fails closed on an occupied stable port and releases the port on shutdown", async () => {
    const root = await fixture()
    const occupied = createServer()
    occupied.listen(43115, "127.0.0.1")
    await once(occupied, "listening")
    const closeOccupied = () => new Promise<void>((resolve) => occupied.close(() => resolve()))
    cleanups.push(closeOccupied)
    await expect(startEditorServer(root)).rejects.toThrow("43115")
    await closeOccupied()
    cleanups.pop()
    const server = await startEditorServer(root)
    cleanups.push(() => server.close())
    expect(await (await fetch(`${DESKTOP_EDITOR_ORIGIN}/`)).text()).toContain("Desktop editor")
    await Promise.all([server.close(), server.close()])
    const replacement = await startEditorServer(root)
    cleanups.push(() => replacement.close())
    expect((await fetch(`${DESKTOP_EDITOR_ORIGIN}/`)).status).toBe(200)
  })

  it("enforces exact host, origin, method, path and header limits without automation routes", async () => {
    const server = await startEditorServer(await fixture())
    cleanups.push(() => server.close())
    expect(await rawStatus("/", { Host: "localhost:43115" })).toBe(403)
    expect(await rawStatus("/", { Origin: "https://attacker.invalid" })).toBe(403)
    expect(await rawStatus("/", { Origin: "null" })).toBe(403)
    expect(await rawStatus("/", { Origin: [DESKTOP_EDITOR_ORIGIN, DESKTOP_EDITOR_ORIGIN] })).toBe(
      400,
    )
    expect(await rawStatus("//attacker.invalid/index.html")).toBe(400)
    expect(await rawStatus("http://attacker.invalid/index.html")).toBe(400)
    expect(await rawStatus(`/${"a".repeat(4096)}`)).toBe(414)
    expect(await rawStatus("/", { "X-Large": "a".repeat(8192) })).toBe(431)
    expect(await rawStatus("/assets/%2e%2e%2fprivate.json")).toBe(404)
    expect((await fetch(`${DESKTOP_EDITOR_ORIGIN}/`, { method: "POST", body: "x" })).status).toBe(
      405,
    )
    for (const path of ["/mcp", "/__vibeshape/automation/status"])
      expect((await fetch(`${DESKTOP_EDITOR_ORIGIN}${path}`)).status).toBe(404)
    expect(await (await fetch(`${DESKTOP_EDITOR_ORIGIN}/`)).text()).not.toContain(
      "vibeshape-local-automation",
    )
    const panel = await fetch(`${DESKTOP_EDITOR_ORIGIN}/assets/ui-panel-runtime-Abc123_-.js`, {
      headers: { Origin: "null" },
    })
    expect(panel.status).toBe(200)
    expect(panel.headers.get("access-control-allow-origin")).toBe("*")
    const head = await fetch(`${DESKTOP_EDITOR_ORIGIN}/assets/kernel.wasm`, { method: "HEAD" })
    expect(head.headers.get("content-type")).toBe("application/wasm")
    expect(await head.text()).toBe("")
  })

  it("serves a streamed WASM response from the bundled server in Node without Bun globals", async () => {
    const root = await fixture()
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "editor-server.ts")],
      target: "node",
      format: "esm",
      outdir: join(root, "node-host"),
    })
    expect(build.success).toBe(true)
    const output = build.outputs[0]
    if (!output) throw new Error("The Node host bundle was not generated.")
    const child = Bun.spawn(
      [
        "node",
        "--input-type=module",
        "-e",
        `import {startEditorServer} from ${JSON.stringify(pathToFileURL(output.path).href)};
         if (typeof Bun !== "undefined") throw new Error("Unexpected Bun runtime");
         const host = await startEditorServer(${JSON.stringify(root)});
         process.on("SIGTERM", async () => { await host.close(); process.exit(0); });
         console.log("ready");`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    cleanups.push(async () => {
      child.kill("SIGTERM")
      await child.exited
    })
    const stderr = new Response(child.stderr).text()
    const reader = child.stdout.getReader()
    const first = await Promise.race([
      reader.read(),
      child.exited.then(async (code) => {
        throw new Error(`Node host exited ${code}: ${await stderr}`)
      }),
    ])
    reader.releaseLock()
    expect(new TextDecoder().decode(first.value)).toContain("ready")
    const wasm = await fetch(`${DESKTOP_EDITOR_ORIGIN}/assets/kernel.wasm`)
    expect(wasm.headers.get("content-type")).toBe("application/wasm")
    const body = new Uint8Array(await wasm.arrayBuffer())
    expect(body.byteLength).toBe(1024 * 1024)
    expect(body.every((value) => value === 73)).toBe(true)
    child.kill("SIGTERM")
    expect(await child.exited).toBe(0)
    cleanups.pop()
    expect(await stderr).toBe("")
    const replacement = await startEditorServer(root)
    cleanups.push(() => replacement.close())
    expect((await fetch(`${DESKTOP_EDITOR_ORIGIN}/`)).status).toBe(200)
  })
})
