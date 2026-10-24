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
): Promise<ProjectBackupResult> {
  const request = projectBackupRequestSchema.parse({ ...input, schemaVersion: 0 })
  return new Promise((resolve, reject) => {
    const worker = createWorker()
    const cleanup = () => {
      clearTimeout(timeout)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    const fail = (message: string) => {
      cleanup()
      reject(new Error(message))
    }
    const timeout = setTimeout(() => fail("The native project backup timed out."), 300_000)
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const progress = projectBackupProgressSchema.safeParse(event.data)
      if (progress.success) {
        if (
          progress.data.documentId !== request.documentId ||
          progress.data.revision !== request.revision
        ) {
          fail("The backup worker returned progress for a different project revision.")
          return
        }
        onProgress?.(progress.data.stage)
        return
      }
      cleanup()
      const result = projectBackupResponseSchema.safeParse(event.data)
      if (!result.success) reject(new Error("The backup worker returned an invalid response."))
      else if (
        result.data.ok &&
        (result.data.documentId !== request.documentId || result.data.revision !== request.revision)
      )
        reject(new Error("The backup worker returned a different project revision."))
      else resolve(result.data)
    }
    worker.onerror = () => fail("The native project backup worker could not run.")
    worker.onmessageerror = () => fail("The native project backup could not be received.")
    try {
      worker.postMessage(request)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
