import type { SectionCapSource } from "./section-cap"
import { parseSectionCaps, type SectionCapRequest } from "./section-cap-protocol"
import type { ViewerSection } from "./section-view"

export type SectionCapWorker = {
  postMessage: (request: SectionCapRequest, transfer: ArrayBuffer[]) => void
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
  terminate: () => void
}

type CapJob = {
  id: number
  section: ViewerSection
  receive: ((caps: readonly (Float32Array | null)[]) => void) | null
}

type Connection = {
  worker: SectionCapWorker
  onMessage: EventListener
  onError: EventListener
}

/** One active computation and one latest pending section; copies geometry once per worker lifetime. */
export class SectionCapClient {
  readonly #createWorker: () => SectionCapWorker
  readonly #onError: (error: Error) => void
  #connection: Connection | null = null
  #sources: readonly SectionCapSource[] = []
  #maxLengths: readonly number[] = []
  #active: CapJob | null = null
  #queued: CapJob | null = null
  #nextId = 0
  #uploaded = false
  #failed = false
  #disposed = false

  constructor(createWorker: () => SectionCapWorker, onError: (error: Error) => void) {
    this.#createWorker = createWorker
    this.#onError = onError
  }

  setSources(sources: readonly SectionCapSource[]) {
    if (this.#disposed) return
    this.clear()
    this.#sources = sources
  }

  compute(section: ViewerSection, receive: NonNullable<CapJob["receive"]>) {
    if (this.#disposed || this.#failed) return
    if (this.#active) this.#active.receive = null
    this.#queued = { id: ++this.#nextId, section: { ...section }, receive }
    this.#pump()
  }

  clear() {
    this.#active = this.#queued = null
    this.#maxLengths = []
    this.#uploaded = this.#failed = false
    const connection = this.#connection
    this.#connection = null
    if (!connection) return
    const { worker, onMessage, onError } = connection
    worker.removeEventListener("message", onMessage)
    worker.removeEventListener("error", onError)
    worker.removeEventListener("messageerror", onError)
    worker.terminate()
  }

  dispose() {
    this.#disposed = true
    this.clear()
    this.#sources = []
  }

  #connect() {
    const worker = this.#createWorker()
    const onMessage: EventListener = (event) => {
      if (this.#connection?.worker !== worker) return
      this.#receive(event instanceof MessageEvent ? event.data : undefined)
    }
    const onError: EventListener = (event) => {
      if (this.#connection?.worker !== worker) return
      event.preventDefault()
      this.#fail(new Error("Section cap worker failed."))
    }
    this.#connection = { worker, onMessage, onError }
    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    worker.addEventListener("messageerror", onError)
    return worker
  }

  #pump() {
    if (this.#active || !this.#queued || this.#disposed || this.#failed) return
    const job = this.#queued
    this.#queued = null
    this.#active = job
    try {
      const worker = this.#connection?.worker ?? this.#connect()
      const { sources, transfer } = this.#prepareSources()
      worker.postMessage(
        { version: 1, type: "computeSectionCaps", jobId: job.id, section: job.section, sources },
        transfer,
      )
    } catch (cause) {
      this.#fail(new Error("Could not start section cap computation.", { cause }))
    }
  }

  #prepareSources() {
    if (this.#uploaded) return { sources: null, transfer: [] }
    const sources = this.#sources.map((source) => ({
      positions: new Float32Array(source.positions),
      indices: new Uint32Array(source.indices),
    }))
    this.#maxLengths = sources.map((source) => source.indices.length * 6)
    const transfer: ArrayBuffer[] = []
    for (const source of sources) transfer.push(source.positions.buffer, source.indices.buffer)
    this.#uploaded = true
    return { sources, transfer }
  }

  #receive(value: unknown) {
    const job = this.#active
    let caps: readonly (Float32Array | null)[]
    try {
      if (!job) throw new Error("Unexpected section cap response.")
      caps = parseSectionCaps(value, job.id, this.#maxLengths)
    } catch (cause) {
      this.#fail(new Error("Invalid section cap response.", { cause }))
      return
    }
    this.#active = null
    job.receive?.(caps)
    this.#pump()
  }

  #fail(error: Error) {
    this.clear()
    this.#failed = true
    this.#onError(error)
  }
}
