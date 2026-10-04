import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"
import { createBrowserBroker } from "./browser-broker"
import { BrowserRequestError, readBrowserJson } from "./browser-request"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

export const DEVELOPMENT_MCP_PATH = "/mcp"

function requestBody(request: IncomingMessage) {
  let cleanup = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = () => {
        request.off("data", data)
        request.off("end", end)
        request.off("error", error)
      }
      const data = (chunk: Buffer) => {
        controller.enqueue(chunk)
        request.pause()
      }
      const end = () => {
        cleanup()
        controller.close()
      }
      const error = (cause: Error) => {
        cleanup()
        controller.error(cause)
      }
      request.on("data", data).once("end", end).once("error", error)
    },
    pull() {
      request.resume()
    },
    cancel() {
      // Drain rejected input without destroying the socket before its error response is sent.
      cleanup()
      request.resume()
    },
  })
}

function webRequest(request: IncomingMessage, origin: string, signal: AbortSignal) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value)
  }
  const init: RequestInit & { duplex: "half" } = {
    method: request.method ?? "GET",
    headers,
    signal,
    duplex: "half",
    ...(request.method === "POST" ? { body: requestBody(request) } : {}),
  }
  return new Request(new URL(request.url ?? "/", origin).href, init)
}

function reject(response: ServerResponse, status: number, message: string) {
  response.req.resume()
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  })
  response.end(JSON.stringify({ error: message }))
}

function matchesOrigin(request: IncomingMessage, origin: URL) {
  return (
    request.headers.host === origin.host &&
    (request.headers.origin === undefined || request.headers.origin === origin.origin)
  )
}

function cancellation(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const disconnect = () => {
    if (!response.writableEnded) abort()
  }
  request.once("aborted", abort)
  response.once("close", disconnect)
  return {
    signal: controller.signal,
    release() {
      request.off("aborted", abort)
      response.off("close", disconnect)
    },
  }
}

function requestFailure(response: ServerResponse, error: unknown) {
  if (response.headersSent) return response.end()
  if (error instanceof BrowserRequestError) return reject(response, error.status, error.message)
  reject(response, 500, "The local request failed.")
}

export function createDevelopmentBridge(origin: string) {
  const url = new URL(origin)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("The development MCP bridge requires a loopback origin.")
  const resources = createExportResources()
  const broker = createBrowserBroker({ origin, onRevoke: resources.clear })
  type Client = {
    server: ReturnType<typeof createLocalMcpAdapter>
    transport: StreamableHTTPServerTransport
  }
  let client: Client | null = null
  let disposed = false
  let requests = 0

  async function mcp(request: IncomingMessage, response: ServerResponse, body: unknown) {
    if (disposed) return reject(response, 503, "The development MCP bridge is closed.")
    if (request.method === "GET") {
      response.setHeader("Allow", "POST, DELETE")
      reject(response, 405, "Use Streamable HTTP POST requests.")
      return
    }
    const sessionId = request.headers["mcp-session-id"]
    if (!sessionId) {
      if (!InitializeRequestSchema.safeParse(body).success) {
        reject(response, 400, "Initialize an MCP session first.")
        return
      }
      if (client) {
        reject(response, 409, "Another MCP client is connected. Terminate its session first.")
        return
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
      const server = createLocalMcpAdapter(broker, resources)
      const created = { server, transport }
      client = created
      server.onclose = () => {
        if (client !== created) return
        client = null
        broker.setClient(null)
        resources.clear()
      }
      try {
        // The SDK Node wrapper widens optional callbacks under exactOptionalPropertyTypes.
        await server.connect(transport as Transport)
        await transport.handleRequest(request, response, body)
      } finally {
        if (!transport.sessionId) await server.close()
      }
      return
    }
    if (!client || sessionId !== client.transport.sessionId) {
      reject(response, 404, "The MCP session is unavailable.")
      return
    }
    await client.transport.handleRequest(request, response, body)
  }

  function requestStatus(request: IncomingMessage) {
    if (disposed) return { status: 503, message: "The development MCP bridge is closed." }
    if (!matchesOrigin(request, url))
      return { status: 403, message: "The development MCP bridge requires its exact local origin." }
    if (requests >= 8) return { status: 429, message: "Too many local requests are active." }
    return null
  }

  async function dispatch(request: IncomingMessage, response: ServerResponse, incoming: Request) {
    if (new URL(incoming.url).pathname === DEVELOPMENT_MCP_PATH) {
      const body =
        request.method === "POST" ? await readBrowserJson(incoming, 256 * 1024) : undefined
      await mcp(request, response, body)
      return
    }
    const result = await broker.handle(incoming)
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(Buffer.from(await result.arrayBuffer()))
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const denied = requestStatus(request)
    if (denied) return reject(response, denied.status, denied.message)
    requests += 1
    const abort = cancellation(request, response)
    let incoming: Request | undefined
    try {
      incoming = webRequest(request, origin, abort.signal)
      await dispatch(request, response, incoming)
    } catch (error) {
      requestFailure(response, error)
    } finally {
      await incoming?.body?.cancel().catch(() => undefined)
      requests -= 1
      abort.release()
    }
  }

  return {
    handles(path: string) {
      const pathname = path.split("?", 1)[0]
      return pathname === DEVELOPMENT_MCP_PATH || pathname?.startsWith(`${LOCAL_AUTOMATION_PATH}/`)
    },
    handle,
    async close() {
      disposed = true
      broker.revoke()
      broker.dispose()
      resources.clear()
      await client?.server.close()
    },
  }
}
