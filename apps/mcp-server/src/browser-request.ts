export class BrowserRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function readBrowserJson(request: Request, limit: number): Promise<unknown> {
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new BrowserRequestError(413, "body-too-large", "The request body is too large.")
  const reader = request.body?.getReader()
  if (!reader)
    throw new BrowserRequestError(400, "invalid-body", "A JSON request body is required.")
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new BrowserRequestError(408, "body-timeout", "The request body did not finish in time."),
        ),
      5000,
    )
  })
  try {
    return await Promise.race([consume(), timeout])
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  async function consume() {
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > limit)
        throw new BrowserRequestError(413, "body-too-large", "The request body is too large.")
      chunks.push(part.value)
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown
    } catch {
      throw new BrowserRequestError(
        400,
        "invalid-body",
        "The request body must contain valid JSON.",
      )
    }
  }
}
