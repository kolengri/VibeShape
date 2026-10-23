import {
  type EdgePreparationRequest,
  type PreparedMeshData,
  parsePreparedMeshData,
} from "./edge-preparation-schema"

export type EdgePreparationSource = Readonly<{
  positions: Float32Array
  indices: Uint32Array
  preparePicking?: boolean
}>

export type EdgePreparationJob = Readonly<{
  result: Promise<PreparedMeshData>
  cancel: () => void
}>

export type EdgePreparationPort = Readonly<{
  prepare: (owner: object, source: EdgePreparationSource) => EdgePreparationJob
}>

export type EdgePreparationWorker = {
  postMessage: (request: EdgePreparationRequest, transfer: ArrayBuffer[]) => void
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
  terminate: () => void
}

type PendingJob = {
  id: number
  owner: object
  source: EdgePreparationSource | null
  maxOutputLength: number
  settled: boolean
  resolve: (data: PreparedMeshData) => void
  reject: (error: Error) => void
}

export class EdgePreparationCancelledError extends Error {
  constructor() {
    super("Edge preparation was cancelled.")
    this.name = "EdgePreparationCancelledError"
  }
}

/** One active transfer plus current owners only. Queued snapshots are copied only at dispatch. */
export class EdgePreparationClient implements EdgePreparationPort {
  readonly #createWorker: () => EdgePreparationWorker
  readonly #onError: (error: Error) => void
  readonly #queued = new Map<object, PendingJob>()
  #worker: EdgePreparationWorker | null = null
  #active: PendingJob | null = null
  #nextId = 0
  #failure: Error | null = null
  #disposed = false

  constructor(createWorker: () => EdgePreparationWorker, onError: (error: Error) => void) {
    this.#createWorker = createWorker
    this.#onError = onError
  }

  prepare(owner: object, source: EdgePreparationSource): EdgePreparationJob {
    const previous = this.#queued.get(owner)
    if (previous) this.#cancel(previous)
    if (this.#active?.owner === owner) this.#cancel(this.#active)
    let task: PendingJob
    const result = new Promise<PreparedMeshData>((resolve, reject) => {
      task = {
        id: ++this.#nextId,
        owner,
        source,
        maxOutputLength: source.indices.length * 6,
        settled: false,
        resolve,
        reject,
      }
      if (this.#disposed || this.#failure) {
        this.#reject(task, this.#failure ?? new EdgePreparationCancelledError())
      } else {
        this.#queued.set(owner, task)
      }
    })
    this.#pump()
    return { result, cancel: () => this.#cancel(task) }
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#settleAll(new EdgePreparationCancelledError())
    this.#releaseWorker()
  }

  #cancel(task: PendingJob) {
    if (this.#queued.get(task.owner) === task) this.#queued.delete(task.owner)
    this.#reject(task, new EdgePreparationCancelledError())
    // An active computation cannot be interrupted; discard its eventual result before dispatching next.
  }

  #reject(task: PendingJob, error: Error) {
    task.source = null
    if (task.settled) return
    task.settled = true
    task.reject(error)
  }

  #pump() {
    if (this.#active || this.#disposed || this.#failure) return
    const task = this.#queued.values().next().value
    if (!task?.source) return
    this.#queued.delete(task.owner)
    this.#active = task
    try {
      if (!this.#worker) {
        this.#worker = this.#createWorker()
        this.#worker.addEventListener("message", this.#onMessage)
        this.#worker.addEventListener("error", this.#onWorkerError)
        this.#worker.addEventListener("messageerror", this.#onWorkerError)
      }
      // Original model buffers remain attached for rendering and authoritative synchronous picking.
      const preparePicking = task.source.preparePicking ?? false
      const positions = new Float32Array(task.source.positions)
      const indices = new Uint32Array(task.source.indices)
      task.source = null
      this.#worker.postMessage(
        { version: 1, type: "prepareEdges", jobId: task.id, positions, indices, preparePicking },
        [positions.buffer, indices.buffer],
      )
    } catch (cause) {
      this.#fail(new Error("Could not start edge preparation.", { cause }))
    }
  }

  readonly #onMessage: EventListener = (event) => {
    if (this.#disposed || this.#failure) return
    const task = this.#active
    if (!task) {
      this.#fail(new Error("Unexpected edge preparation response."))
      return
    }
    try {
      const data = parsePreparedMeshData(
        event instanceof MessageEvent ? event.data : undefined,
        task.id,
        task.maxOutputLength,
      )
      this.#active = null
      if (!task.settled) {
        task.settled = true
        task.resolve(data)
      }
      this.#pump()
    } catch (cause) {
      this.#fail(new Error("Invalid edge preparation response.", { cause }))
    }
  }

  readonly #onWorkerError: EventListener = (event) => {
    event.preventDefault()
    this.#fail(new Error("Edge preparation worker failed."))
  }

  #fail(error: Error) {
    if (this.#disposed || this.#failure) return
    this.#failure = error
    this.#settleAll(error)
    this.#releaseWorker()
    this.#onError(error)
  }

  #settleAll(error: Error) {
    if (this.#active) this.#reject(this.#active, error)
    this.#active = null
    for (const task of this.#queued.values()) this.#reject(task, error)
    this.#queued.clear()
  }

  #releaseWorker() {
    this.#worker?.removeEventListener("message", this.#onMessage)
    this.#worker?.removeEventListener("error", this.#onWorkerError)
    this.#worker?.removeEventListener("messageerror", this.#onWorkerError)
    this.#worker?.terminate()
    this.#worker = null
  }
}
