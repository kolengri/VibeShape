import {
  type PlanarParserRequest,
  planarParserRequestSchema,
  planarParserResponseSchema,
} from "./parser-contract"

function createParserWorker() {
  return new Worker(new URL("./parser-worker.ts", import.meta.url), { type: "module" })
}
export class PlanarParserError extends Error {
  constructor(
    readonly code: "timeout" | "contract" | "unavailable",
    message: string,
  ) {
    super(message)
  }
}
export function inspectPlanarSource(
  input: PlanarParserRequest["input"],
  signal: AbortSignal,
  createWorker = createParserWorker,
) {
  if (signal.aborted) return Promise.reject(new DOMException("Inspection canceled.", "AbortError"))
  const request = planarParserRequestSchema.parse({
    schemaVersion: 0,
    input: { ...input, bytes: Uint8Array.from(input.bytes) },
  })
  return new Promise<ReturnType<typeof planarParserResponseSchema.parse>>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Inspection canceled.", "AbortError"))
      return
    }
    const worker = createWorker()
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      worker.terminate()
    }
    const abort = () => {
      cleanup()
      reject(new DOMException("Inspection canceled.", "AbortError"))
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new PlanarParserError("timeout", "Source inspection timed out."))
    }, 30000)
    signal.addEventListener("abort", abort, { once: true })
    worker.onmessage = (event: MessageEvent<unknown>) => {
      cleanup()
      const result = planarParserResponseSchema.safeParse(event.data)
      if (result.success) resolve(result.data)
      else
        reject(
          new PlanarParserError("contract", "The parser returned an invalid geometry contract."),
        )
    }
    worker.onerror = () => {
      cleanup()
      reject(new PlanarParserError("unavailable", "The source parser could not run."))
    }
    try {
      worker.postMessage(request, [request.input.bytes.buffer])
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
