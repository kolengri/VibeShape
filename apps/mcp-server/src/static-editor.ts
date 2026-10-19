import { readFile, realpath, stat } from "node:fs/promises"
import { basename, extname, relative, resolve, sep } from "node:path"
import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"

type StaticFileBody = NonNullable<ConstructorParameters<typeof Response>[0]>

const policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": policy,
}
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
}
function staticRequestStatus(request: Request, origin: URL, url: URL) {
  if (url.origin !== origin.origin || request.headers.get("host") !== origin.host) return 403
  const requestedOrigin = request.headers.get("origin")
  if (
    requestedOrigin &&
    requestedOrigin !== origin.origin &&
    !(requestedOrigin === "null" && isPanelRuntime(url.pathname))
  )
    return 403
  return 200
}
function isPanelRuntime(pathname: string) {
  return /^\/assets\/ui-panel-runtime-[A-Za-z0-9_-]{8}\.js$/.test(pathname)
}
function fileHeaders(path: string, mimeType: string, panelRuntime: boolean) {
  // The pinned native binding uses dynamic JS generation inside its isolated document worker.
  // Keep the editor document strict; this exception is scoped to the built worker entry response.
  const worker = /^worker-entry-[A-Za-z0-9_-]{8}\.js$/.test(basename(path))
  return {
    ...headers,
    ...(panelRuntime
      ? { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }
      : {}),
    "Content-Type": mimeType,
    "Content-Security-Policy": worker
      ? policy.replace("'wasm-unsafe-eval'", "'unsafe-eval'")
      : policy,
  }
}
async function resolveStaticFile(root: string, pathname: string) {
  const decoded = decodeURIComponent(pathname)
  if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").includes(".."))
    return null
  const path = await realpath(resolve(root, decoded === "/" ? "index.html" : `.${decoded}`))
  if (!path.startsWith(`${root}${sep}`) || !(await stat(path)).isFile()) return null
  const mimeType = mimeTypes[extname(path)]
  return mimeType ? { path, mimeType } : null
}
export async function createStaticEditor(input: {
  directory: string
  origin: string
  api?: (request: Request) => Promise<Response>
  fileBody?: (path: string) => StaticFileBody | Promise<StaticFileBody>
}) {
  // Bun keeps its zero-copy file response; other hosts provide a streaming reader.
  const runtime = globalThis as typeof globalThis & { Bun?: { file(path: string): Blob } }
  const fileReader = input.fileBody ?? runtime.Bun?.file
  if (!fileReader) throw new Error("A static file body reader is required outside Bun.")
  const fileBody = fileReader
  const root = await realpath(input.directory)
  const indexPath = resolve(root, "index.html")
  const source = await readFile(indexPath, "utf8")
  const html = input.api
    ? source.replace("<head>", '<head><meta name="vibeshape-local-automation" content="1">')
    : source
  const origin = new URL(input.origin)
  async function serveFile(request: Request, url: URL) {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405, headers })
    try {
      const file = await resolveStaticFile(root, url.pathname)
      if (!file) return new Response(null, { status: 404, headers })
      const body =
        request.method === "HEAD"
          ? null
          : file.path === indexPath
            ? html
            : await fileBody(file.path)
      return new Response(body, {
        headers: fileHeaders(
          file.path,
          file.mimeType,
          isPanelRuntime(url.pathname) &&
            isPanelRuntime(`/${relative(root, file.path).split(sep).join("/")}`),
        ),
      })
    } catch {
      return new Response(null, { status: 404, headers })
    }
  }
  return (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const status = staticRequestStatus(request, origin, url)
    if (status !== 200) return Promise.resolve(new Response(null, { status, headers }))
    return url.pathname.startsWith(LOCAL_AUTOMATION_PATH)
      ? (input.api?.(request) ?? Promise.resolve(new Response(null, { status: 404, headers })))
      : serveFile(request, url)
  }
}
