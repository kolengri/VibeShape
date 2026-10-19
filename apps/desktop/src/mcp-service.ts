import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { DESKTOP_MCP_PATH } from "@vibeshape/automation-api/desktop-host"
import {
  BrowserRequestError,
  createBrowserBroker,
  createExportResources,
  createLocalMcpAdapter,
  readBrowserJson,
} from "@vibeshape/mcp-server/local-host"
import { publishMcpDescriptor } from "./mcp-descriptor"

type Client = {
  server: ReturnType<typeof createLocalMcpAdapter>
  transport: StreamableHTTPServerTransport
  lease: ReturnType<typeof setTimeout>
  stream?: ServerResponse
  released: Promise<void>
  resolveReleased: () => void
}

function reject(response: ServerResponse, status: number, message: string) {
  response.req.resume()
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  response.end(JSON.stringify({ error: message }))
}

export function createDesktopMcpService(origin: string) {
  const url = new URL(origin)
  const token = randomBytes(32).toString("hex")
  const resources = createExportResources()
  const broker = createBrowserBroker({ origin, onRevoke: resources.clear })
  let client: Client | null = null
  let disposed = false
  let requests = 0
  let removeDescriptor: (() => Promise<void>) | undefined

  async function release(owner: Client) {
    if (client !== owner) return
    client = null
    clearTimeout(owner.lease)
    broker.setClient(null)
    resources.clear()
    owner.resolveReleased()
    await owner.server.close()
  }

  function authenticate(request: IncomingMessage) {
    if (request.headers.host !== url.host || request.headers.origin !== undefined) return false
    if (request.headersDistinct.authorization?.length !== 1) return false
    const supplied = request.headers.authorization ?? ""
    const expected = `Bearer ${token}`
    return (
      supplied.length === expected.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
  }

  async function initialize(request: IncomingMessage, response: ServerResponse, body: unknown) {
    if (!InitializeRequestSchema.safeParse(body).success)
      return reject(response, 400, "Initialize an MCP session first.")
    if (client)
      return reject(
        response,
        409,
        "Another MCP client is attached to VibeShape. Disconnect it first.",
      )
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
    const server = createLocalMcpAdapter(broker, resources)
    let resolveReleased = () => {}
    const released = new Promise<void>((resolve) => {
      resolveReleased = resolve
    })
    const owner: Client = {
      server,
      transport,
      lease: setTimeout(() => void release(owner), 10_000),
      released,
      resolveReleased,
    }
    // Reserve before connecting or reading the client's initialization response.
    client = owner
    server.onclose = () => void release(owner)
    try {
      // The SDK Node wrapper widens optional callbacks under exactOptionalPropertyTypes.
      await server.connect(transport as Transport)
      await transport.handleRequest(request, response, body)
    } finally {
      if (!transport.sessionId) await release(owner)
    }
  }

  async function dispatch(request: IncomingMessage, response: ServerResponse, body: unknown) {
    const session = request.headers["mcp-session-id"]
    if (!session) return initialize(request, response, body)
    const owner = client
    if (!owner || session !== owner.transport.sessionId)
      return reject(response, 404, "The native MCP session is unavailable.")
    if (request.method === "GET") {
      if (owner.stream) return reject(response, 409, "The native MCP connection is already active.")
      owner.stream = response
      clearTimeout(owner.lease)
      response.once("close", () => void release(owner))
    }
    await owner.transport.handleRequest(request, response, body)
  }

  function requestStatus(request: IncomingMessage) {
    if (disposed) return { status: 503, message: "Native MCP is closed." }
    if (!authenticate(request))
      return { status: 403, message: "The native MCP attachment is not authorized." }
    if (!["GET", "POST", "DELETE"].includes(request.method ?? ""))
      return { status: 405, message: "Use MCP POST, GET or DELETE requests." }
    if (requests >= 8) return { status: 429, message: "Too many native MCP requests are active." }
    return null
  }

  function requestFailure(response: ServerResponse, error: unknown) {
    if (response.headersSent) response.end()
    else if (error instanceof BrowserRequestError) reject(response, error.status, error.message)
    else reject(response, 500, "The native MCP request failed.")
  }

  return {
    handleBrowser: broker.handle,
    isClientAttached() {
      return client !== null
    },
    whenClientReleased() {
      return client?.released ?? Promise.resolve()
    },
    handles(path: string) {
      return path.split("?", 1)[0] === DESKTOP_MCP_PATH
    },
    async handle(request: IncomingMessage, response: ServerResponse, incoming: Request) {
      const denied = requestStatus(request)
      if (denied) return reject(response, denied.status, denied.message)
      requests += 1
      try {
        const body =
          request.method === "POST" ? await readBrowserJson(incoming, 256 * 1024) : undefined
        await dispatch(request, response, body)
      } catch (error) {
        requestFailure(response, error)
      } finally {
        requests -= 1
      }
    },
    async publish(path: string) {
      if (disposed || removeDescriptor)
        throw new Error("Native MCP descriptor publication is unavailable.")
      removeDescriptor = await publishMcpDescriptor(path, {
        protocolVersion: 1,
        endpoint: new URL(DESKTOP_MCP_PATH, origin).href,
        token,
        pid: process.pid,
      })
    },
    async close() {
      if (disposed) return
      disposed = true
      if (client) await release(client)
      broker.dispose()
      resources.clear()
      await removeDescriptor?.()
    },
  }
}
