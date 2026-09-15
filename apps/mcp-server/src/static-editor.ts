import { readFile, realpath, stat } from "node:fs/promises"
import { basename, extname, resolve, sep } from "node:path"
import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"

const policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
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
}
function staticRequestStatus(request: Request, origin: URL, url: URL) {
  if (url.origin !== origin.origin || request.headers.get("host") !== origin.host) return 403
  const requestedOrigin = request.headers.get("origin")
  if (requestedOrigin && requestedOrigin !== origin.origin) return 403
  return 200
}
function fileHeaders(path: string, mimeType: string) {
  // The pinned native binding uses dynamic JS generation inside its isolated document worker.
  // Keep the editor document strict; this exception is scoped to the built worker entry response.
  const worker = /^worker-entry-[A-Za-z0-9_-]{8}\.js$/.test(basename(path))
  return {
    ...headers,
    "Content-Type": mimeType,
    "Content-Security-Policy": worker
      ? policy.replace("'wasm-unsafe-eval'", "'unsafe-eval'")
      : policy,
  }
}
async function resolveStaticFile(root: string, pathname: string) {
  const decoded = decodeURIComponent(pathname)
  if (decoded.includes("\\") || decoded.includes("\0")) return null
  const path = await realpath(resolve(root, decoded === "/" ? "index.html" : `.${decoded}`))
  if (!path.startsWith(`${root}${sep}`) || !(await stat(path)).isFile()) return null
  const mimeType = mimeTypes[extname(path)]
  return mimeType ? { path, mimeType } : null
}
export async function createStaticEditor(input: {
  directory: string
  origin: string
  api: (request: Request) => Promise<Response>
}) {
  const root = await realpath(input.directory)
  const indexPath = resolve(root, "index.html")
  const html = (await readFile(indexPath, "utf8")).replace(
    "<head>",
    '<head><meta name="vibeshape-local-automation" content="1">',
  )
  const origin = new URL(input.origin)
  async function serveFile(request: Request, url: URL) {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405, headers })
    try {
      const file = await resolveStaticFile(root, url.pathname)
      if (!file) return new Response(null, { status: 404, headers })
      const body =
        request.method === "HEAD" ? null : file.path === indexPath ? html : Bun.file(file.path)
      return new Response(body, {
        headers: fileHeaders(file.path, file.mimeType),
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
      ? input.api(request)
      : serveFile(request, url)
  }
}
