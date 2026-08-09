import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerRequest,
  type DocumentWorkerTerminalResponse,
  documentRebuildSnapshotSchema,
  documentWorkerDocumentIdSchema,
  documentWorkerRequestSchema,
  type GeometryExportFormat,
} from "@vibeshape/protocol"
import {
  type DocumentWorkerClientErrorCode,
  DocumentWorkerRequestError,
  type DocumentWorkerRequestOptions,
} from "./client-core"

type RebuildRequest = Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>
type RebuildResponse = Extract<DocumentWorkerTerminalResponse, { type: "documentRebuilt" }>
type HealthResponse = Extract<DocumentWorkerTerminalResponse, { type: "health" }>
type DisposalResponse = Extract<DocumentWorkerTerminalResponse, { type: "documentDisposed" }>
type ExportResponse = Extract<DocumentWorkerTerminalResponse, { type: "documentExported" }>
type SketchResponse = Extract<DocumentWorkerTerminalResponse, { type: "sketchSolved" }>
type SolveSketchRequest = Extract<DocumentWorkerRequest, { type: "solveSketch" }>

export type DocumentWorkerRebuildInput = Readonly<{
  document: unknown
  mesh: unknown
}>

export type DocumentWorkerSolveSketchInput = Readonly<
  Pick<SolveSketchRequest, "sketchId"> &
    Partial<Pick<SolveSketchRequest, "continuation" | "draggedPoints">>
>

export interface DocumentWorkerClientPort {
  request(
    input: DocumentWorkerRequest,
    options?: DocumentWorkerRequestOptions,
  ): Promise<DocumentWorkerTerminalResponse>
  terminate(): void
}

export type DocumentWorkerClientFactory = () => DocumentWorkerClientPort

export type DocumentWorkerSessionOptions = Readonly<{
  initialGeneration?: number
  retryRecoverableFailure?: boolean
}>

type RecoverySnapshot = Pick<RebuildRequest, "document" | "mesh">

const recoverableClientCodes = new Set<DocumentWorkerClientErrorCode>([
  "request-timeout",
  "worker-terminated",
  "worker-error",
  "message-error",
  "invalid-response",
  "mismatched-response-envelope",
  "mismatched-response-type",
])

function isRecoverableFailure(error: unknown) {
  if (!(error instanceof DocumentWorkerRequestError)) return false
  if (recoverableClientCodes.has(error.code)) return true
  return (
    error.code === "worker-failure" &&
    error.response?.type === "failure" &&
    error.response.diagnostic.retryable
  )
}

function parseGeneration(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new RangeError("Document worker generation must be a non-negative safe integer.")
  }
  return Number(value)
}

export class DocumentWorkerSession {
  readonly #documentId: string
  readonly #retryRecoverableFailure: boolean
  #client: DocumentWorkerClientPort
  #closed = false
  #generation: number
  #lastSuccessfulSnapshot: RecoverySnapshot | null = null
  #operationQueue: Promise<void> = Promise.resolve()

  constructor(
    documentId: string,
    private readonly clientFactory: DocumentWorkerClientFactory,
    options: DocumentWorkerSessionOptions = {},
  ) {
    this.#documentId = documentWorkerDocumentIdSchema.parse(documentId)
    this.#generation = parseGeneration(options.initialGeneration ?? 1)
    this.#retryRecoverableFailure = options.retryRecoverableFailure ?? true
    this.#client = this.clientFactory()
  }

  get generation() {
    return this.#generation
  }

  rebuild(input: DocumentWorkerRebuildInput, options: DocumentWorkerRequestOptions = {}) {
    return this.#enqueue(() => this.#rebuildWithRecovery(input, options))
  }

  exportDocument(format: GeometryExportFormat, options: DocumentWorkerRequestOptions = {}) {
    return this.#enqueue(() => this.#exportWithRecovery(format, options))
  }

  solveSketch(input: DocumentWorkerSolveSketchInput, options: DocumentWorkerRequestOptions = {}) {
    return this.#enqueue(() => this.#solveSketchWithRecovery(input, options))
  }

  restartAndRecover(options: DocumentWorkerRequestOptions = {}) {
    return this.#enqueue(async () => {
      this.#assertOpen()
      this.#replaceClient()
      if (!this.#lastSuccessfulSnapshot) return null
      return this.#rebuildOnce(this.#lastSuccessfulSnapshot, options)
    })
  }

  health(revision = this.#lastSuccessfulSnapshot?.document.revision ?? 0) {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const response = await this.#client.request({
        ...this.#envelope(revision),
        type: "healthCheck",
      })
      if (response.type !== "health") {
        throw new DocumentWorkerRequestError(
          `Expected a health response, received ${response.type}.`,
          "mismatched-response-type",
        )
      }
      return response
    })
  }

  dispose(revision = this.#lastSuccessfulSnapshot?.document.revision ?? 0) {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const response = await this.#client.request({
        ...this.#envelope(revision),
        type: "disposeDocument",
      })
      if (response.type !== "documentDisposed") {
        throw new DocumentWorkerRequestError(
          `Expected a disposal response, received ${response.type}.`,
          "mismatched-response-type",
        )
      }
      this.#lastSuccessfulSnapshot = null
      return response
    })
  }

  terminate() {
    if (this.#closed) return
    this.#closed = true
    this.#lastSuccessfulSnapshot = null
    this.#client.terminate()
  }

  async #rebuildWithRecovery(
    input: DocumentWorkerRebuildInput,
    options: DocumentWorkerRequestOptions,
  ) {
    this.#assertOpen()
    try {
      return await this.#rebuildOnce(input, options)
    } catch (error) {
      if (!this.#retryRecoverableFailure || !isRecoverableFailure(error)) throw error
      this.#replaceClient()
      return this.#rebuildOnce(input, options)
    }
  }

  async #exportWithRecovery(format: GeometryExportFormat, options: DocumentWorkerRequestOptions) {
    this.#assertOpen()
    if (!this.#lastSuccessfulSnapshot) {
      throw new DocumentWorkerRequestError(
        "Document export requires a successfully rebuilt snapshot.",
        "mismatched-response-type",
      )
    }
    try {
      return await this.#exportOnce(format, options)
    } catch (error) {
      if (!this.#retryRecoverableFailure || !isRecoverableFailure(error)) throw error
      this.#replaceClient()
      await this.#rebuildOnce(this.#lastSuccessfulSnapshot, options)
      return this.#exportOnce(format, options)
    }
  }

  async #solveSketchWithRecovery(
    input: DocumentWorkerSolveSketchInput,
    options: DocumentWorkerRequestOptions,
  ) {
    this.#assertOpen()
    if (!this.#lastSuccessfulSnapshot) {
      throw new DocumentWorkerRequestError(
        "Sketch solving requires a successfully rebuilt snapshot.",
        "mismatched-response-type",
      )
    }
    try {
      return await this.#solveSketchOnce(input, options)
    } catch (error) {
      if (!this.#retryRecoverableFailure || !isRecoverableFailure(error)) throw error
      this.#replaceClient()
      await this.#rebuildOnce(this.#lastSuccessfulSnapshot, options)
      return this.#solveSketchOnce(input, options)
    }
  }

  async #solveSketchOnce(
    input: DocumentWorkerSolveSketchInput,
    options: DocumentWorkerRequestOptions,
  ): Promise<SketchResponse> {
    const revision = this.#lastSuccessfulSnapshot?.document.revision
    if (revision === undefined) {
      throw new DocumentWorkerRequestError(
        "Sketch solving requires a successfully rebuilt snapshot.",
        "mismatched-response-type",
      )
    }
    const request = documentWorkerRequestSchema.parse({
      ...this.#envelope(revision),
      type: "solveSketch",
      sketchId: input.sketchId,
      continuation: input.continuation ?? null,
      draggedPoints: input.draggedPoints ?? [],
    })
    if (request.type !== "solveSketch") {
      throw new TypeError("Document worker sketch request validation returned an invalid type.")
    }
    const response = await this.#client.request(request, options)
    if (response.type !== "sketchSolved") {
      throw new DocumentWorkerRequestError(
        `Expected a sketch response, received ${response.type}.`,
        "mismatched-response-type",
      )
    }
    return response
  }

  async #exportOnce(
    format: GeometryExportFormat,
    options: DocumentWorkerRequestOptions,
  ): Promise<ExportResponse> {
    const revision = this.#lastSuccessfulSnapshot?.document.revision
    if (revision === undefined) {
      throw new DocumentWorkerRequestError(
        "Document export requires a successfully rebuilt snapshot.",
        "mismatched-response-type",
      )
    }
    const request = documentWorkerRequestSchema.parse({
      ...this.#envelope(revision),
      type: "exportDocument",
      format,
    })
    if (request.type !== "exportDocument") {
      throw new TypeError("Document worker export request validation returned an invalid type.")
    }
    const response = await this.#client.request(request, options)
    if (response.type !== "documentExported") {
      throw new DocumentWorkerRequestError(
        `Expected a document export response, received ${response.type}.`,
        "mismatched-response-type",
      )
    }
    return response
  }

  async #rebuildOnce(
    input: DocumentWorkerRebuildInput,
    options: DocumentWorkerRequestOptions,
  ): Promise<RebuildResponse> {
    const document = documentRebuildSnapshotSchema.parse(input.document)
    const request = documentWorkerRequestSchema.parse({
      ...this.#envelope(document.revision),
      type: "rebuildDocument",
      document,
      mesh: input.mesh,
    })
    if (request.type !== "rebuildDocument") {
      throw new TypeError("Document worker rebuild request validation returned an invalid type.")
    }
    const response = await this.#client.request(request, options)
    if (response.type !== "documentRebuilt") {
      throw new DocumentWorkerRequestError(
        `Expected a document rebuild response, received ${response.type}.`,
        "mismatched-response-type",
      )
    }
    this.#lastSuccessfulSnapshot = { document: request.document, mesh: request.mesh }
    return response
  }

  #replaceClient() {
    if (this.#generation >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Document worker generation cannot be incremented safely.")
    }
    this.#client.terminate()
    this.#generation += 1
    this.#client = this.clientFactory()
  }

  #envelope(revision: number) {
    return {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      documentId: this.#documentId,
      revision,
      generation: this.#generation,
    }
  }

  #assertOpen() {
    if (this.#closed) throw new Error("Document worker session is closed.")
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operationQueue.then(operation)
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export type DocumentWorkerRebuildResponse = RebuildResponse
export type DocumentWorkerHealthResponse = HealthResponse
export type DocumentWorkerDisposalResponse = DisposalResponse
export type DocumentWorkerExportResponse = ExportResponse
export type DocumentWorkerSketchResponse = SketchResponse
