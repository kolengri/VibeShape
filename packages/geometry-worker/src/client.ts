import {
  GEOMETRY_PROTOCOL_VERSION,
  type GeometryProgressStage,
  type GeometryRequestEnvelope,
  type GeometryTerminalResponse,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
  geometryWorkerRequestSchema,
  geometryWorkerResponseSchema,
} from "@vibeshape/protocol"
import { isError } from "is-what"
import GeometryWorkerConstructor from "./worker-entry?worker"

interface WorkerLike {
  postMessage(message: GeometryWorkerRequest): void
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
  terminate(): void
}

type PendingRequest = {
  generation: number
  resolve: (response: GeometryTerminalResponse) => void
  reject: (error: Error) => void
  onProgress?: (stage: GeometryProgressStage, fraction: number) => void
  timeoutId: ReturnType<typeof setTimeout>
}

export class GeometryWorkerRequestError extends Error {
  constructor(
    message: string,
    readonly response?: GeometryTerminalResponse,
  ) {
    super(message)
    this.name = "GeometryWorkerRequestError"
  }
}

export function createGeometryRequestEnvelope(
  documentId: string,
  generation: number,
  revision = 0,
): GeometryRequestEnvelope {
  return {
    protocolVersion: GEOMETRY_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    documentId,
    revision,
    generation,
  }
}

export class GeometryWorkerClient {
  readonly #pending = new Map<string, PendingRequest>()
  readonly #handleMessage = (event: MessageEvent<unknown>) => this.#onMessage(event.data)

  constructor(private readonly worker: WorkerLike = new GeometryWorkerConstructor()) {
    this.worker.addEventListener("message", this.#handleMessage)
  }

  request(
    input: GeometryWorkerRequest,
    options: {
      timeoutMs?: number
      onProgress?: (stage: GeometryProgressStage, fraction: number) => void
    } = {},
  ) {
    const request = geometryWorkerRequestSchema.parse(input)
    const timeoutMs = options.timeoutMs ?? 120_000

    return new Promise<GeometryTerminalResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(request.requestId)
        reject(new GeometryWorkerRequestError(`Geometry request timed out after ${timeoutMs} ms.`))
      }, timeoutMs)

      const pending: PendingRequest = {
        generation: request.generation,
        resolve,
        reject,
        timeoutId,
      }

      if (options.onProgress) {
        pending.onProgress = options.onProgress
      }

      this.#pending.set(request.requestId, pending)
      this.worker.postMessage(request)
    })
  }

  terminate() {
    this.worker.removeEventListener("message", this.#handleMessage)
    this.worker.terminate()
    this.#rejectAll(new GeometryWorkerRequestError("Geometry worker terminated."))
  }

  #onMessage(input: unknown) {
    const parsed = geometryWorkerResponseSchema.safeParse(input)

    if (!parsed.success) {
      this.#rejectAll(
        new GeometryWorkerRequestError("Geometry worker returned an invalid response."),
      )
      return
    }

    this.#handleResponse(parsed.data)
  }

  #handleResponse(response: GeometryWorkerResponse) {
    const pending = this.#pending.get(response.requestId)

    if (!pending) {
      return
    }

    if (response.generation !== pending.generation) {
      this.#finish(
        response.requestId,
        new GeometryWorkerRequestError("Geometry worker returned a mismatched generation."),
      )
      return
    }

    this.#handlePendingResponse(response, pending)
  }

  #handlePendingResponse(response: GeometryWorkerResponse, pending: PendingRequest) {
    if (response.type === "progress") {
      pending.onProgress?.(response.stage, response.fraction)
      return
    }

    this.#finishTerminal(response)
  }

  #finishTerminal(response: GeometryTerminalResponse) {
    if (response.type === "failure") {
      this.#finish(
        response.requestId,
        new GeometryWorkerRequestError(response.diagnostic.message, response),
      )
      return
    }

    if (response.type === "requestCancelled") {
      this.#finish(
        response.requestId,
        new GeometryWorkerRequestError(`Geometry request was ${response.reason}.`, response),
      )
      return
    }

    this.#finish(response.requestId, response)
  }

  #finish(requestId: string, outcome: GeometryTerminalResponse | Error) {
    const pending = this.#pending.get(requestId)

    if (!pending) {
      return
    }

    clearTimeout(pending.timeoutId)
    this.#pending.delete(requestId)

    if (isError(outcome)) {
      pending.reject(outcome)
    } else {
      pending.resolve(outcome)
    }
  }

  #rejectAll(error: Error) {
    for (const [requestId, pending] of this.#pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
      this.#pending.delete(requestId)
    }
  }
}

export function createGeometryWorkerClient() {
  return new GeometryWorkerClient()
}
