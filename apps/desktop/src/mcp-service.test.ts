import { afterEach, describe, expect, it } from "bun:test"
import { once } from "node:events"
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { DESKTOP_MCP_DESCRIPTOR_NAME } from "@vibeshape/automation-api/desktop-host"
import { vi } from "../../../tests/unit/support/bun-test"
import { startEditorServer } from "./editor-server"
import { publishMcpDescriptor, readMcpDescriptor } from "./mcp-descriptor"
import { createDesktopMcpService } from "./mcp-service"

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function host() {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-native-mcp-"))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const editor = join(directory, "editor")
  await mkdir(editor)
  await writeFile(
    join(editor, "index.html"),
    "<html><head></head><body>Existing editor</body></html>",
  )
  const reserve = createServer()
  reserve.listen(0, "127.0.0.1")
  await once(reserve, "listening")
  const address = reserve.address()
  if (!address || typeof address === "string") throw new Error("Missing isolated test port.")
  const origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => reserve.close(() => resolve()))
  const service = createDesktopMcpService(origin)
  const http = await startEditorServer(editor, { origin, mcp: service })
  cleanups.push(() => http.close())
  const descriptorPath = join(directory, DESKTOP_MCP_DESCRIPTOR_NAME)
  await service.publish(descriptorPath)
  const descriptor = await readMcpDescriptor(descriptorPath)
  const headers = {
    Authorization: `Bearer ${descriptor.token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }
  return { directory, origin, service, http, descriptorPath, descriptor, headers }
}

async function connect(context: Awaited<ReturnType<typeof host>>, name = "native-test") {
  const client = new Client({ name, version: "1.0" })
  const transport = new StreamableHTTPClientTransport(new URL(context.descriptor.endpoint), {
    requestInit: { headers: context.headers },
  })
  cleanups.push(() => client.close())
  await client.connect(transport as Transport)
  return { client, transport }
}

function initialization() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "replacement", version: "1" },
    },
  }
}

function browser(context: Awaited<ReturnType<typeof host>>, route = "status", body: unknown = {}) {
  return fetch(`${context.origin}/__vibeshape/automation/${route}`, {
    method: "POST",
    headers: { Origin: context.origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("app-owned native MCP attachment", () => {
  it("discovers existing tools before consent, reserves one client and revokes it when its stream closes", async () => {
    const context = await host()
    expect((await lstat(context.descriptorPath)).mode & 0o777).toBe(0o600)
    expect(await (await fetch(context.origin)).text()).toContain(
      'name="vibeshape-local-automation"',
    )
    const { client } = await connect(context)
    expect(
      (await client.request({ method: "tools/list" }, ListToolsResultSchema)).tools.some(
        (tool) => tool.name === "model_info",
      ),
    ).toBe(true)
    expect((await client.readResource({ uri: "vibeshape://session" })).contents[0]).toMatchObject({
      text: JSON.stringify({ schemaVersion: 1, editorUrl: context.origin, paired: false }),
    })
    expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
    const denied = await fetch(context.descriptor.endpoint, {
      method: "POST",
      headers: context.headers,
      body: JSON.stringify(initialization()),
    })
    expect(denied.status).toBe(409)
    const grant = await browser(context, "connect", {
      protocolVersion: 1,
      document: { id: "0195b5ac-b220-7a2c-8c33-67a36a7f6101", name: "Open project", revision: 4 },
    })
    expect(grant.status).toBe(200)
    expect(await (await browser(context)).json()).toMatchObject({
      client: { name: "native-test" },
      paired: true,
    })
    await client.close()
    await vi.waitFor(async () =>
      expect(await (await browser(context)).json()).toMatchObject({ client: null, paired: false }),
    )
    const replacement = await connect(context, "next-client")
    expect(
      (await replacement.client.request({ method: "tools/list" }, ListToolsResultSchema)).tools
        .length,
    ).toBeGreaterThan(0)
    await context.http.close()
    await expect(readFile(context.descriptorPath)).rejects.toThrow()
  })

  it("denies missing tokens, browser origins and oversized input without claiming a client", async () => {
    const context = await host()
    for (const headers of [
      { "Content-Type": "application/json" },
      { ...context.headers, Origin: context.origin },
      { ...context.headers, Origin: "null" },
      { ...context.headers, Host: "attacker.invalid" },
    ]) {
      const result = await fetch(context.descriptor.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(initialization()),
      })
      expect(result.status).toBe(403)
    }
    const oversized = await fetch(context.descriptor.endpoint, {
      method: "POST",
      headers: context.headers,
      body: "x".repeat(256 * 1024 + 1),
    })
    expect(oversized.status).toBe(413)
    expect(await (await browser(context)).json()).toMatchObject({ client: null, paired: false })
    expect(
      (
        await (
          await connect(context)
        ).client.request({ method: "tools/list" }, ListToolsResultSchema)
      ).tools.length,
    ).toBeGreaterThan(0)
  })

  it("reads only private, owned descriptors and never follows symlinks", async () => {
    const context = await host()
    const link = join(context.directory, "linked.json")
    await symlink(context.descriptorPath, link)
    await expect(readMcpDescriptor(link)).rejects.toThrow()
    await chmod(context.descriptorPath, 0o644)
    await expect(readMcpDescriptor(context.descriptorPath)).rejects.toThrow("private file")
    await chmod(context.descriptorPath, 0o600)
    await writeFile(context.descriptorPath, "x".repeat(4097))
    await expect(readMcpDescriptor(context.descriptorPath)).rejects.toThrow()
  })

  it("does not remove a descriptor replaced by another launch", async () => {
    const context = await host()
    const remove = await publishMcpDescriptor(context.descriptorPath, {
      ...context.descriptor,
      token: "a".repeat(64),
    })
    await context.http.close()
    expect((await readMcpDescriptor(context.descriptorPath)).token).toBe("a".repeat(64))
    await remove()
    await expect(readFile(context.descriptorPath)).rejects.toThrow()
  })
})
