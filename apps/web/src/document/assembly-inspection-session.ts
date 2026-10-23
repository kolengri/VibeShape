import type { DocumentWorkerSession } from "@vibeshape/document-worker/session"
import type { InspectAssemblyInput } from "@vibeshape/protocol"

type Worker = Pick<DocumentWorkerSession, "inspectAssembly" | "terminate">

/** One revision-scoped worker; cancelled queued work cannot terminate another request. */
export class AssemblyInspectionSession {
  #key: string | null = null
  #epoch = 0
  #worker: Worker | null = null
  #queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly createWorker: (documentId: string) => Worker) {}

  retain(authority: { id: string; revision: number } | null | undefined) {
    const key = authority ? `${authority.id}:${authority.revision}` : null
    if (this.#key === key) return
    this.dispose()
    this.#key = key
  }

  dispose() {
    this.#epoch += 1
    this.#worker?.terminate()
    this.#worker = null
    this.#key = null
  }

  #assertCurrent(epoch: number, signal?: AbortSignal) {
    if (signal?.aborted || this.#epoch !== epoch)
      throw new Error("Assembly inspection was cancelled.")
  }

  inspect(documentId: string, revision: number, input: InspectAssemblyInput, signal?: AbortSignal) {
    this.retain({ id: documentId, revision })
    const epoch = this.#epoch
    const operation = this.#queue.then(async () => {
      this.#assertCurrent(epoch, signal)
      this.#worker ??= this.createWorker(documentId)
      const worker = this.#worker
      const cancel = () => {
        if (this.#worker !== worker) return
        worker.terminate()
        this.#worker = null
      }
      signal?.addEventListener("abort", cancel, { once: true })
      try {
        const result = await worker.inspectAssembly(input, revision)
        this.#assertCurrent(epoch, signal)
        return result
      } catch (error) {
        cancel()
        throw error
      } finally {
        signal?.removeEventListener("abort", cancel)
      }
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }
}
