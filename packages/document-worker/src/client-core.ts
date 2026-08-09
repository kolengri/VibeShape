import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse,
  type DocumentWorkerTerminalResponse,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
} from "@vibeshape/protocol"

export interface DocumentWorkerLike {
  postMessage(message: DocumentWorkerRequest): void
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
  terminate(): void
}

type ProgressResponse = Extract<DocumentWorkerResponse, { type: "progress" }>

type PendingRequest = {
  documentId: string
  revision: number
  generation: number
  requestType: DocumentWorkerRequest["type"]
  resolve: (response: DocumentWorkerTerminalResponse) => void
  reject: (error: Error) => void
  onProgress?: (progress: ProgressResponse) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const terminalResponseTypeByRequest = {
  rebuildDocument: "documentRebuilt",
  solveSketch: "sketchSolved",
  exportDocument: "documentExported",
  disposeDocument: "documentDisposed",
  healthCheck: "health",
} as const satisfies Record<
  DocumentWorkerRequest["type"],
  Exclude<DocumentWorkerTerminalResponse["type"], "failure">
>

export type DocumentWorkerClientErrorCode =
  | "duplicate-request"
  | "request-timeout"
  | "worker-terminated"
  | "worker-error"
  | "message-error"
  | "invalid-response"
  | "mismatched-response-envelope"
  | "mismatched-response-type"
  | "worker-failure"

export type DocumentWorkerRequestOptions = {
  timeoutMs?: number
  onProgress?: (progress: ProgressResponse) => void
}

export function createDocumentRequestEnvelope(
  documentId: string,
  generation: number,
  revision = 0,
) {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    documentId,
    revision,
    generation,
  } as const
}

export class DocumentWorkerRequestError extends Error {
  constructor(
    message: string,
    readonly code: DocumentWorkerClientErrorCode,
    readonly response?: DocumentWorkerTerminalResponse,
  ) {
    super(message)
    this.name = "DocumentWorkerRequestError"
  }
}

export class DocumentWorkerClient {
  readonly #pending = new Map<string, PendingRequest>()
  readonly #handleMessage = (event: MessageEvent<unknown>) => this.#onMessage(event.data)
  readonly #handleError = (event: ErrorEvent) => {
    this.#available = false
    this.#rejectAll(
      new DocumentWorkerRequestError(
        event.message || "Document worker execution failed.",
        "worker-error",
      ),
    )
  }
  readonly #handleMessageError = () => {
    this.#available = false
    this.#rejectAll(
      new DocumentWorkerRequestError(
        "Document worker could not deserialize a message.",
        "message-error",
      ),
    )
  }
  #available = true
  #terminated = false

  constructor(private readonly worker: DocumentWorkerLike) {
    this.worker.addEventListener("message", this.#handleMessage)
    this.worker.addEventListener("error", this.#handleError)
    this.worker.addEventListener("messageerror", this.#handleMessageError)
  }

  request(input: DocumentWorkerRequest, options: DocumentWorkerRequestOptions = {}) {
    const request = documentWorkerRequestSchema.parse(input)
    const timeoutMs = options.timeoutMs ?? 120_000
    if (!this.#available) {
      return Promise.reject(
        new DocumentWorkerRequestError("Document worker is unavailable.", "worker-terminated"),
      )
    }
    if (this.#pending.has(request.requestId)) {
      return Promise.reject(
        new DocumentWorkerRequestError(
          `Document request ID is already pending: ${request.requestId}.`,
          "duplicate-request",
        ),
      )
    }
    return new Promise<DocumentWorkerTerminalResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(request.requestId)
        reject(
          new DocumentWorkerRequestError(
            `Document request timed out after ${timeoutMs} ms.`,
            "request-timeout",
          ),
        )
      }, timeoutMs)
      this.#pending.set(request.requestId, {
        documentId: request.documentId,
        revision: request.revision,
        generation: request.generation,
        requestType: request.type,
        resolve,
        reject,
        timeoutId,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      })
      this.worker.postMessage(request)
    })
  }

  terminate() {
    if (this.#terminated) return
    this.#terminated = true
    this.#available = false
    this.worker.removeEventListener("message", this.#handleMessage)
    this.worker.removeEventListener("error", this.#handleError)
    this.worker.removeEventListener("messageerror", this.#handleMessageError)
    this.worker.terminate()
    this.#rejectAll(
      new DocumentWorkerRequestError("Document worker terminated.", "worker-terminated"),
    )
  }

  #onMessage(input: unknown) {
    const parsed = documentWorkerResponseSchema.safeParse(input)
    if (!parsed.success) {
      this.#available = false
      this.#rejectAll(
        new DocumentWorkerRequestError(
          "Document worker returned an invalid response.",
          "invalid-response",
        ),
      )
      return
    }
    this.#handleResponse(parsed.data)
  }

  #handleResponse(response: DocumentWorkerResponse) {
    const pending = this.#pending.get(response.requestId)
    if (!pending) return
    if (
      response.documentId !== pending.documentId ||
      response.revision !== pending.revision ||
      response.generation !== pending.generation
    ) {
      this.#reject(
        response.requestId,
        new DocumentWorkerRequestError(
          "Document worker returned a mismatched response envelope.",
          "mismatched-response-envelope",
        ),
      )
      return
    }
    if (response.type === "progress") {
      if (pending.requestType !== "rebuildDocument") {
        this.#reject(
          response.requestId,
          new DocumentWorkerRequestError(
            "Document worker returned a mismatched response type.",
            "mismatched-response-type",
          ),
        )
        return
      }
      pending.onProgress?.(response)
      return
    }
    if (!this.#matchesRequestType(pending.requestType, response.type)) {
      this.#reject(
        response.requestId,
        new DocumentWorkerRequestError(
          "Document worker returned a mismatched response type.",
          "mismatched-response-type",
        ),
      )
      return
    }
    this.#finish(response.requestId, response)
  }

  #matchesRequestType(
    requestType: DocumentWorkerRequest["type"],
    responseType: DocumentWorkerTerminalResponse["type"],
  ) {
    return responseType === "failure" || terminalResponseTypeByRequest[requestType] === responseType
  }

  #finish(requestId: string, response: DocumentWorkerTerminalResponse) {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeoutId)
    this.#pending.delete(requestId)
    if (response.type === "failure") {
      pending.reject(
        new DocumentWorkerRequestError(response.diagnostic.message, "worker-failure", response),
      )
      return
    }
    pending.resolve(response)
  }

  #reject(requestId: string, error: Error) {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeoutId)
    this.#pending.delete(requestId)
    pending.reject(error)
  }

  #rejectAll(error: Error) {
    for (const [requestId, pending] of this.#pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
      this.#pending.delete(requestId)
    }
  }
}
