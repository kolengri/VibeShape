import { afterAll, beforeAll, expect, it } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fsUrlPrefix, verifyDevServerCheckout } from "./e2e-dev-server-checkout"

const vite = resolve(import.meta.dirname, "../apps/web/node_modules/vite/bin/vite.js")
// Real paths: Vite reports resolved locations, and macOS temporary directories are symlinked.
const fixture = realpathSync(mkdtempSync(join(tmpdir(), "vibeshape-e2e-server-")))
// Mirrors a checkout whose workspace contains another checkout, such as one under artifacts/.
const ancestor = join(fixture, "ancestor")
const nested = join(ancestor, "artifacts", "nested")
const sibling = join(fixture, "sibling")
let server: ChildProcess | undefined
let baseURL = ""

function write(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

async function freePort() {
  const probe = createServer()
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done))
  const address = probe.address()
  await new Promise((done) => probe.close(done))
  if (address === null || typeof address === "string") throw new Error("No TCP port was assigned.")
  return address.port
}

beforeAll(async () => {
  write(
    join(ancestor, "package.json"),
    JSON.stringify({
      name: "@vibeshape/root",
      private: true,
      workspaces: ["apps/*", "packages/*"],
    }),
  )
  write(join(ancestor, "packages/lib/index.ts"), "export const answer = 42\n")
  write(
    join(ancestor, "apps/web/index.html"),
    '<!doctype html><script type="module" src="/src/main.ts"></script>\n',
  )
  // The workspace import sits one module deep, like the editor's lazily mounted app.
  write(join(ancestor, "apps/web/src/main.ts"), 'import("/src/mount.ts")\n')
  write(
    join(ancestor, "apps/web/src/mount.ts"),
    'import { answer } from "../../../packages/lib/index.ts"\nconsole.log(answer)\n',
  )
  write(join(nested, "package.json"), JSON.stringify({ name: "@vibeshape/root", private: true }))
  mkdirSync(sibling, { recursive: true })
  const port = await freePort()
  baseURL = `http://127.0.0.1:${port}`
  server = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: join(ancestor, "apps/web"), stdio: "ignore" },
  )
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (
      await fetch(baseURL).then(
        (response) => response.ok,
        () => false,
      )
    )
      return
    await Bun.sleep(100)
  }
  throw new Error("The fixture Vite server did not start.")
}, 30_000)

afterAll(() => {
  server?.kill()
  rmSync(fixture, { recursive: true, force: true })
})

it("accepts the checkout whose modules the server transforms", async () => {
  await expect(verifyDevServerCheckout(baseURL, ancestor)).resolves.toBeUndefined()
})

it("rejects a checkout nested inside the serving workspace although its files are reachable", async () => {
  // Vite serves /@fs files anywhere in its workspace, so reachability cannot identify the checkout.
  const nestedManifest = await fetch(new URL(`${fsUrlPrefix(nested)}package.json`, baseURL))
  expect(nestedManifest.status).toBe(200)
  await expect(verifyDevServerCheckout(baseURL, nested)).rejects.toThrow(/not .*nested/)
})

it("rejects a sibling checkout and a server that is not a VibeShape editor", async () => {
  await expect(verifyDevServerCheckout(baseURL, sibling)).rejects.toThrow(/not .*sibling/)
  const foreign = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 404 }),
  })
  try {
    await expect(verifyDevServerCheckout(foreign.url.href, ancestor)).rejects.toThrow(
      /not a VibeShape editor/,
    )
  } finally {
    await foreign.stop(true)
  }
})

it("writes Windows drive paths as Vite /@fs URLs", () => {
  expect(fsUrlPrefix("C:\\work\\VibeShape")).toBe("/@fs/C:/work/VibeShape/")
  expect(fsUrlPrefix("/Users/me/VibeShape/")).toBe("/@fs/Users/me/VibeShape/")
})
