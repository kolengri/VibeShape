import {
  motionArchiveRequestSchema,
  motionArchiveResponseSchema,
} from "./assembly-motion-archive-contract"

function createArchiveWorker() {
  return new Worker(new URL("./assembly-motion-archive-worker.ts", import.meta.url), {
    type: "module",
  })
}

/** Consumes disposable rendered-frame buffers; model geometry is never transferred. */
export async function archiveAssemblyMotionFrames(
  files: Record<string, Uint8Array>,
  signal: AbortSignal,
  createWorker = createArchiveWorker,
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const request = motionArchiveRequestSchema.parse({ schemaVersion: 0, files })
  return new Promise((resolve, reject) => {
    const worker = createWorker()
    let settled = false
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      complete()
    }
    const fail = () => finish(() => reject(new Error("Motion archive compression failed.")))
    const abort = () => finish(() => reject(signal.reason))
    const timeout = setTimeout(fail, 60_000)
    signal.addEventListener("abort", abort, { once: true })
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = motionArchiveResponseSchema.safeParse(event.data)
      if (!parsed.success || !parsed.data.ok) return fail()
      const archive = parsed.data.archive
      finish(() => resolve(archive))
    }
    worker.onerror = fail
    worker.onmessageerror = fail
    if (signal.aborted) {
      abort()
      return
    }
    try {
      const transfer = new Set<ArrayBuffer>()
      for (const bytes of Object.values(request.files)) {
        if (bytes.buffer instanceof ArrayBuffer) transfer.add(bytes.buffer)
      }
      worker.postMessage(request, [...transfer])
    } catch (error) {
      finish(() => reject(error))
    }
  })
}
