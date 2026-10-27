import {
  type DocumentWorkerRequest,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
} from "@vibeshape/protocol"
import { BrowserWorkerStartupQueue } from "./browser-worker-startup-queue"
import { createDocumentRequestEnvelope, type DocumentWorkerLike } from "./client-core"

type WorkerEvents = {
  message: MessageEvent<unknown>
  error: ErrorEvent
  messageerror: MessageEvent<unknown>
}
type WorkerListeners = {
  [Kind in keyof WorkerEvents]: Set<(event: WorkerEvents[Kind]) => void>
}
type StartupPhase = "waiting" | "booting" | "ready" | "retired" | "finished"

class BrowserWorkerStartup implements DocumentWorkerLike {
  readonly #listeners: WorkerListeners = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  }
  // Health reads metadata only; this reserved ID never opens an authored document.
  readonly #health = documentWorkerRequestSchema.parse({
    ...createDocumentRequestEnvelope("00000000-0000-7000-8000-000000000000", 0),
    type: "healthCheck",
  })
  readonly #message = (event: MessageEvent<unknown>) => {
    if (this.#phase === "ready") this.#emit("message", event)
    else this.#acknowledge(event.data)
  }
  readonly #error = (event: ErrorEvent) => this.#nativeFailure("error", event)
  readonly #messageError = (event: MessageEvent<unknown>) =>
    this.#nativeFailure("messageerror", event)
  #phase: StartupPhase = "waiting"
  #cancelled = false
  #pending: DocumentWorkerRequest[] = []
  #native: DocumentWorkerLike | null = null
  #release: (() => void) | undefined
  #retire: (() => void) | undefined

  constructor(
    private readonly queue: BrowserWorkerStartupQueue,
    private readonly construct: () => DocumentWorkerLike,
  ) {
    // The core client must attach its error listeners before construction can fail.
    queueMicrotask(() => {
      if (this.#phase === "waiting") queue.enqueue(this)
    })
  }

  addEventListener<Kind extends keyof WorkerEvents>(
    type: Kind,
    listener: (event: WorkerEvents[Kind]) => void,
  ) {
    this.#listeners[type].add(listener)
  }

  removeEventListener<Kind extends keyof WorkerEvents>(
    type: Kind,
    listener: (event: WorkerEvents[Kind]) => void,
  ) {
    this.#listeners[type].delete(listener)
  }

  postMessage(message: DocumentWorkerRequest) {
    if (this.#cancelled) return
    if (this.#phase === "ready") this.#native?.postMessage(message)
    else this.#pending.push(message)
  }

  terminate() {
    this.#cancelled = true
    this.#pending = []
    this.#clearListeners()
    if (this.#phase === "waiting") this.#finish()
    if (this.#phase === "ready") this.#finish()
  }

  start(release: () => void, retire: () => void) {
    this.#release = release
    this.#retire = retire
    this.#phase = "booting"
    try {
      this.#native = this.construct()
    } catch {
      this.#fail("Document worker could not start in this browser.")
      this.#finish()
      return
    }
    this.#native.addEventListener("message", this.#message)
    this.#native.addEventListener("error", this.#error)
    this.#native.addEventListener("messageerror", this.#messageError)
    this.#sendHealth()
  }

  rejectWaiting() {
    this.#fail("Document worker startup capacity is unavailable.")
    this.#finish()
  }

  #sendHealth() {
    try {
      this.#native?.postMessage(this.#health)
    } catch {
      this.#retireStartup("Document worker startup health check could not be sent.")
    }
  }

  #acknowledge(input: unknown) {
    const parsed = documentWorkerResponseSchema.safeParse(input)
    if (!parsed.success) {
      this.#retireStartup("Document worker returned an invalid startup health response.")
      return
    }
    const response = parsed.data
    if (!this.#matchesHealth(response)) {
      this.#retireStartup("Document worker returned a mismatched startup health response.")
      return
    }
    this.#phase = "ready"
    this.#releaseSlot()
    if (this.#cancelled) this.#finish()
    else this.#flush()
  }

  #matchesHealth(response: ReturnType<typeof documentWorkerResponseSchema.parse>) {
    return (
      response.type === "health" &&
      [
        [response.protocolVersion, this.#health.protocolVersion],
        [response.requestId, this.#health.requestId],
        [response.documentId, this.#health.documentId],
        [response.revision, this.#health.revision],
        [response.generation, this.#health.generation],
      ].every(([actual, expected]) => actual === expected)
    )
  }

  #flush() {
    const pending = this.#pending
    this.#pending = []
    try {
      for (const message of pending) {
        if (this.#cancelled) return
        this.#native?.postMessage(message)
      }
    } catch {
      this.#fail("Document worker could not receive the queued request.")
      this.#finish()
    }
  }

  #nativeFailure<Kind extends "error" | "messageerror">(type: Kind, event: WorkerEvents[Kind]) {
    if (this.#phase === "ready") {
      this.#emit(type, event)
      return
    }
    this.#pending = []
    if (!this.#cancelled) this.#emit(type, event)
    this.#cancelled = true
    // A native startup error confirms compilation/execution has definitively failed.
    this.#finish()
  }

  #retireStartup(message: string) {
    this.#fail(message)
    if (this.#phase !== "booting") return
    this.#phase = "retired"
    this.#retire?.()
  }

  #fail(message: string) {
    this.#pending = []
    if (!this.#cancelled) this.#emit("error", new ErrorEvent("error", { message }))
    this.#cancelled = true
    this.#clearListeners()
  }

  #emit<Kind extends keyof WorkerEvents>(type: Kind, event: WorkerEvents[Kind]) {
    for (const listener of this.#listeners[type]) listener(event)
  }

  #clearListeners() {
    this.#listeners.message.clear()
    this.#listeners.error.clear()
    this.#listeners.messageerror.clear()
  }

  #releaseSlot() {
    this.#release?.()
    this.#release = undefined
    this.#retire = undefined
  }

  #finish() {
    this.#phase = "finished"
    this.queue.remove(this)
    this.#clearListeners()
    const native = this.#native
    this.#native = null
    if (native) this.#terminateNative(native)
    this.#releaseSlot()
  }

  #terminateNative(native: DocumentWorkerLike) {
    native.removeEventListener("message", this.#message)
    native.removeEventListener("error", this.#error)
    native.removeEventListener("messageerror", this.#messageError)
    native.terminate()
  }
}

/** Browser factories share one startup budget; core/custom worker ports remain unchanged. */
export function createBrowserWorkerStartupFactory(construct: () => DocumentWorkerLike) {
  const queue = new BrowserWorkerStartupQueue()
  return () => new BrowserWorkerStartup(queue, construct)
}
