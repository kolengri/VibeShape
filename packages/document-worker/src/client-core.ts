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
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
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
    readonly response?: DocumentWorkerTerminalResponse,
  ) {
    super(message)
    this.name = "DocumentWorkerRequestError"
  }
}

export class DocumentWorkerClient {
  readonly #pending = new Map<string, PendingRequest>()
  readonly #handleMessage = (event: MessageEvent<unknown>) => this.#onMessage(event.data)

  constructor(private readonly worker: DocumentWorkerLike) {
    this.worker.addEventListener("message", this.#handleMessage)
  }

  request(
    input: DocumentWorkerRequest,
    options: {
      timeoutMs?: number
      onProgress?: (progress: ProgressResponse) => void
    } = {},
  ) {
    const request = documentWorkerRequestSchema.parse(input)
    const timeoutMs = options.timeoutMs ?? 120_000
    if (this.#pending.has(request.requestId)) {
      return Promise.reject(
        new DocumentWorkerRequestError(
          `Document request ID is already pending: ${request.requestId}.`,
        ),
      )
    }
    return new Promise<DocumentWorkerTerminalResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(request.requestId)
        reject(new DocumentWorkerRequestError(`Document request timed out after ${timeoutMs} ms.`))
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
    this.worker.removeEventListener("message", this.#handleMessage)
    this.worker.terminate()
    this.#rejectAll(new DocumentWorkerRequestError("Document worker terminated."))
  }

  #onMessage(input: unknown) {
    const parsed = documentWorkerResponseSchema.safeParse(input)
    if (!parsed.success) {
      this.#rejectAll(
        new DocumentWorkerRequestError("Document worker returned an invalid response."),
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
        new DocumentWorkerRequestError("Document worker returned a mismatched response envelope."),
      )
      return
    }
    if (response.type === "progress") {
      if (pending.requestType !== "rebuildDocument") {
        this.#reject(
          response.requestId,
          new DocumentWorkerRequestError("Document worker returned a mismatched response type."),
        )
        return
      }
      pending.onProgress?.(response)
      return
    }
    if (!this.#matchesRequestType(pending.requestType, response.type)) {
      this.#reject(
        response.requestId,
        new DocumentWorkerRequestError("Document worker returned a mismatched response type."),
      )
      return
    }
    this.#finish(response.requestId, response)
  }

  #matchesRequestType(
    requestType: DocumentWorkerRequest["type"],
    responseType: DocumentWorkerTerminalResponse["type"],
  ) {
    return (
      responseType === "failure" ||
      (requestType === "rebuildDocument" && responseType === "documentRebuilt") ||
      (requestType === "disposeDocument" && responseType === "documentDisposed") ||
      (requestType === "healthCheck" && responseType === "health")
    )
  }

  #finish(requestId: string, response: DocumentWorkerTerminalResponse) {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeoutId)
    this.#pending.delete(requestId)
    if (response.type === "failure") {
      pending.reject(new DocumentWorkerRequestError(response.diagnostic.message, response))
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
