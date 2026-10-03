import { REMOTE_MESSAGE_MAX_BYTES } from "@vibeshape/automation-api/remote-session"

export async function readBoundedBody(request: Request, limit = REMOTE_MESSAGE_MAX_BYTES) {
  const declared = request.headers.get("Content-Length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new RequestBudgetError("Request body exceeds its budget.")
  const reader = request.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > limit) {
      await reader.cancel()
      throw new RequestBudgetError("Request body exceeds its budget.")
    }
    chunks.push(next.value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)
}
export class RequestBudgetError extends Error {}
export async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}
export function pairingCode() {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
}
export function failure(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } })
}
export function escaped(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }
    return entities[character] ?? ""
  })
}
