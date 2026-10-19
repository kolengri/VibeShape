import { createReadStream } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createStaticEditor } from "@vibeshape/mcp-server/static-editor"

export const DESKTOP_EDITOR_ORIGIN = "http://127.0.0.1:43115"

function boundaryHeadersValid(request: IncomingMessage) {
  return (
    request.headersDistinct.host?.length === 1 && (request.headersDistinct.origin?.length ?? 0) <= 1
  )
}

function requestStatus(request: IncomingMessage) {
  if (!["GET", "HEAD"].includes(request.method ?? "")) return 405
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

async function respond(
  request: IncomingMessage,
  response: ServerResponse,
  serve: (request: Request) => Promise<Response>,
) {
  const status = requestStatus(request)
  if (status !== 200) {
    response.writeHead(status, { "Cache-Control": "no-store", Connection: "close" }).end()
    return
  }
  const controller = new AbortController()
  request.once("aborted", () => controller.abort())
  response.once("close", () => {
    if (!response.writableEnded) controller.abort()
  })
  try {
    const result = await serve(
      new Request(`${DESKTOP_EDITOR_ORIGIN}${request.url}`, {
        method: request.method ?? "GET",
        headers: fetchHeaders(request),
        signal: controller.signal,
      }),
    )
    response.writeHead(result.status, Object.fromEntries(result.headers))
    if (!result.body || request.method === "HEAD") response.end()
    else await pipeline(Readable.fromWeb(result.body), response, { signal: controller.signal })
  } catch {
    if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" }).end()
    else response.destroy()
  }
}

export async function startEditorServer(directory: string) {
  const serve = await createStaticEditor({
    directory,
    origin: DESKTOP_EDITOR_ORIGIN,
    fileBody: (path) => Readable.toWeb(createReadStream(path)),
  })
  const server = createServer(
    { maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000, keepAliveTimeout: 1000 },
    (request, response) => void respond(request, response, serve),
  )
  server.maxConnections = 16
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(43115, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  }).catch((cause: unknown) => {
    throw new Error(
      "VibeShape could not reserve http://127.0.0.1:43115. Close the app using this port and try again. The editor was not opened.",
      { cause },
    )
  })
  let closing: Promise<void> | undefined
  return {
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
      return closing
    },
  }
}
