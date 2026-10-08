import { afterEach, describe, expect, it } from "bun:test"
import { createServer, request as httpRequest } from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"
import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"
import { createDevelopmentBridge } from "./development-bridge"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function start() {
  let bridge: ReturnType<typeof createDevelopmentBridge>
  const http = createServer((request, response) => void bridge.handle(request, response))
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  const address = http.address()
  if (!address || typeof address === "string") throw new Error("The test server did not bind.")
  const origin = `http://127.0.0.1:${address.port}`
  bridge = createDevelopmentBridge(origin)
  cleanups.push(async () => {
    await bridge.close()
    http.closeAllConnections()
    if (!http.listening) return
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    )
  })
  return { origin, bridge }
}

async function connect(origin: string) {
  const client = new Client({ name: "dev-test", version: "1.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`))
  cleanups.push(() => client.close())
  await client.connect(transport as Transport)
  return { client, transport }
}

function initialize() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "another-client", version: "1.0" },
    },
  }
}

async function browserRequest(origin: string, path: string, body = {}) {
  return fetch(`${origin}${LOCAL_AUTOMATION_PATH}/${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("development MCP bridge", () => {
  it("discovers real tools and session resources while requiring browser pairing", async () => {
    const { origin } = await start()
    const { client } = await connect(origin)
    expect((await client.listTools()).tools.some(({ name }) => name === "model_info")).toBe(true)
    const resource = await client.readResource({ uri: "vibeshape://session" })
    expect(resource.contents[0]).toMatchObject({
      text: JSON.stringify({ schemaVersion: 1, editorUrl: origin, paired: false }),
    })
    expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      isError: true,
      structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
    })
  })

  it("revokes browser authority on HTTP session deletion and admits a replacement client", async () => {
    const { origin } = await start()
    const { client, transport } = await connect(origin)
    const response = await browserRequest(origin, "connect", {
      protocolVersion: 1,
      document: { id: "0195b5ac-b220-7a2c-8c33-67a36a7f6101", name: "Bracket", revision: 4 },
    })
    expect(response.status).toBe(200)
    expect((await client.readResource({ uri: "vibeshape://session" })).contents[0]).toMatchObject({
      text: JSON.stringify({ schemaVersion: 1, editorUrl: origin, paired: true }),
    })
    await transport.terminateSession()
    expect(await (await browserRequest(origin, "status")).json()).toMatchObject({
      client: null,
      paired: false,
    })
    const replacement = await connect(origin)
    expect((await replacement.client.listTools()).tools.length).toBeGreaterThan(0)
  })

  it.each([{ Origin: "https://untrusted.example" }, { Host: "untrusted.example" }])(
    "denies cross-origin and rebound-host requests before claiming the client: %j",
    async (headers) => {
      const { origin } = await start()
      const denied = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          `${origin}/mcp`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              ...headers,
            },
          },
          (response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          },
        )
        request.once("error", reject)
        request.end(JSON.stringify(initialize()))
      })
      expect(denied).toBe(403)
      expect(await (await browserRequest(origin, "status")).json()).toMatchObject({ client: null })
      expect((await (await connect(origin)).client.listTools()).tools.length).toBeGreaterThan(0)
    },
  )

  it("does not let a second initialization replace the active client", async () => {
    const { origin } = await start()
    const { client } = await connect(origin)
    const denied = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initialize()),
    })
    expect(denied.status).toBe(409)
    expect((await client.listTools()).tools.length).toBeGreaterThan(0)
  })

  it("bounds initialization bodies without retaining a failed client", async () => {
    const { origin } = await start()
    const denied = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(256 * 1024 + 1),
    })
    expect(denied.status).toBe(413)
    expect((await (await connect(origin)).client.listTools()).tools.length).toBeGreaterThan(0)
  })
})
