import { createReadStream } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createStaticEditor } from "@vibeshape/mcp-server/static-editor"
import type { createDesktopMcpService } from "./mcp-service"

export const DESKTOP_EDITOR_ORIGIN = "http://127.0.0.1:43115"

function boundaryHeadersValid(request: IncomingMessage) {
  return (
    request.headersDistinct.host?.length === 1 && (request.headersDistinct.origin?.length ?? 0) <= 1
  )
}

function requestStatus(request: IncomingMessage) {
  const target = request.url ?? ""
  if (target.length > 4096) return 414
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("#")) return 400
  return boundaryHeadersValid(request) ? 200 : 400
}

function fetchHeaders(request: IncomingMessage) {
  const headers = new Headers()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]
    const value = request.rawHeaders[index + 1]
    if (name && value !== undefined) headers.append(name, value)
  }
  return headers
}

function requestBody(request: IncomingMessage) {
  let cleanup = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
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
      cleanup = () => {
        request.off("data", data)
        request.off("end", end)
        request.off("error", error)
      }
      request.on("data", data).once("end", end).once("error", error)
    },
    pull() {
      request.resume()
    },
    cancel() {
      cleanup()
      request.resume()
    },
  })
}

function webRequest(request: IncomingMessage, origin: string, signal: AbortSignal) {
  const method = request.method ?? "GET"
  return new Request(`${origin}${request.url}`, {
    method,
    headers: fetchHeaders(request),
    signal,
    ...(!["GET", "HEAD"].includes(method) ? { body: requestBody(request), duplex: "half" } : {}),
  })
}

async function respond(
  request: IncomingMessage,
  response: ServerResponse,
  serve: (request: Request) => Promise<Response>,
  origin: string,
  mcp?: ReturnType<typeof createDesktopMcpService>,
) {
  const status = requestStatus(request)
  if (status !== 200) {
    response.writeHead(status, { "Cache-Control": "no-store", Connection: "close" }).end()
    return
  }
  const controller = new AbortController()
  let incoming: Request | undefined
  request.once("aborted", () => controller.abort())
  response.once("close", () => {
    if (!response.writableEnded) controller.abort()
  })
  try {
    incoming = webRequest(request, origin, controller.signal)
    if (mcp?.handles(request.url ?? "")) {
      await mcp.handle(request, response, incoming)
      return
    }
    const result = await serve(incoming)
    response.writeHead(result.status, Object.fromEntries(result.headers))
    if (!result.body || request.method === "HEAD") response.end()
    else await pipeline(Readable.fromWeb(result.body), response, { signal: controller.signal })
  } catch {
    if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" }).end()
    else response.destroy()
  } finally {
    await incoming?.body?.cancel().catch(() => undefined)
  }
}

export async function startEditorServer(
  directory: string,
  options: { origin?: string; mcp?: ReturnType<typeof createDesktopMcpService> } = {},
) {
  const origin = new URL(options.origin ?? DESKTOP_EDITOR_ORIGIN)
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    Number(origin.port) < 1024 ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("The desktop editor requires an explicit loopback origin.")
  const serve = await createStaticEditor({
    directory,
    origin: origin.origin,
    ...(options.mcp ? { api: options.mcp.handleBrowser } : {}),
    fileBody: (path) => Readable.toWeb(createReadStream(path)),
  })
  const server = createServer(
    { maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000, keepAliveTimeout: 1000 },
    (request, response) => void respond(request, response, serve, origin.origin, options.mcp),
  )
  server.maxConnections = 16
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(Number(origin.port), "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  }).catch((cause: unknown) => {
    throw new Error(
      `VibeShape could not reserve ${origin.origin}. Close the app using this port and try again. The editor was not opened.`,
      { cause },
    )
  })
  let closing: Promise<void> | undefined
  return {
    close() {
      closing ??= (async () => {
        await options.mcp?.close()
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        })
      })()
      return closing
    },
  }
}
