import {
  type ProjectBackupRequest,
  type ProjectBackupResult,
  type ProjectBackupStage,
  projectBackupProgressSchema,
  projectBackupRequestSchema,
  projectBackupResponseSchema,
} from "./project-backup-contract"

function createBackupWorker() {
  return new Worker(new URL("./project-backup-worker.ts", import.meta.url), { type: "module" })
}

export function exportProjectBackup(
  input: Omit<ProjectBackupRequest, "schemaVersion">,
  createWorker = createBackupWorker,
  onProgress?: (stage: ProjectBackupStage) => void,
  signal?: AbortSignal,
): Promise<ProjectBackupResult> {
  const request = projectBackupRequestSchema.parse({ ...input, schemaVersion: 0 })
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null
    let settled = false
    const cleanup = () => {
      settled = true
      signal?.removeEventListener("abort", abort)
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
      }
    }
    const fail = (error: unknown) => {
      if (settled) return
      cleanup()
      reject(error)
    }
    const abort = () =>
      fail(new DOMException("The native project backup was cancelled.", "AbortError"))
    const acceptResult = (data: unknown) => {
      const result = projectBackupResponseSchema.safeParse(data)
      if (!result.success) throw new Error("The backup worker returned an invalid response.")
      if (
        result.data.ok &&
        (result.data.documentId !== request.documentId || result.data.revision !== request.revision)
      )
        throw new Error("The backup worker returned a different project revision.")
      cleanup()
      resolve(result.data)
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      worker = createWorker()
      if (settled) {
        worker.terminate()
        return
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return
        try {
          const progress = projectBackupProgressSchema.safeParse(event.data)
          if (progress.success) {
            if (
              progress.data.documentId !== request.documentId ||
              progress.data.revision !== request.revision
            )
              throw new Error(
                "The backup worker returned progress for a different project revision.",
              )
            onProgress?.(progress.data.stage)
            return
          }
          acceptResult(event.data)
        } catch (error) {
          fail(error)
        }
      }
      worker.onerror = () => fail(new Error("The native project backup worker could not run."))
      worker.onmessageerror = () =>
        fail(new Error("The native project backup could not be received."))
      worker.postMessage(request)
    } catch (error) {
      fail(error)
    }
  })
}
