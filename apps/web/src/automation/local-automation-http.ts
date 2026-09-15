import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"

// Keep the timeout active through body consumption, not only response headers.
export async function localAutomationRequest(
  path: string,
  body: unknown,
  token?: string,
  keepalive = false,
) {
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
