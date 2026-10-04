import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"

// Keep the timeout active through body consumption, not only response headers.
async function requestOnce(path: string, body: unknown, token?: string, keepalive = false) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(`${LOCAL_AUTOMATION_PATH}${path}`, {
      method: "POST",
      signal: controller.signal,
      keepalive,
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    reader = response.body?.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    while (reader) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 256 * 1024) throw new Error("The local automation response is too large.")
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    const data: unknown = text ? JSON.parse(text) : null
    return { ok: response.ok, status: response.status, data }
  } finally {
    controller.abort()
    void reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
    clearTimeout(timeout)
  }
}

export class LocalAutomationTransportError extends Error {}

// Only delivery envelopes are retried; CAD commands are never re-executed here.
export async function localAutomationRequest(
  path: string,
  body: unknown,
  token?: string,
  keepalive = false,
) {
  const delivery = ["/poll", "/result"].includes(path)
  const attempts = delivery && !keepalive ? 3 : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await requestOnce(path, body, token, keepalive)
      if (attempt + 1 === attempts || !transientStatus(response.status)) return response
    } catch (error) {
      if (!transportFailure(error)) throw error
      if (attempt + 1 === attempts)
        throw new LocalAutomationTransportError(
          "The local automation bridge is temporarily unavailable.",
        )
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
  throw new LocalAutomationTransportError("The local automation bridge is temporarily unavailable.")
}

function transientStatus(status: number) {
  return status >= 500 || status === 408 || status === 429
}
function transportFailure(error: unknown) {
  return (
    error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")
  )
}
