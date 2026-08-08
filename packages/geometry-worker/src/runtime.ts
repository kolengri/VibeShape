import {
  GEOMETRY_PROTOCOL_VERSION,
  type GeometryDiagnosticCode,
  type GeometryProgressStage,
  type GeometryRequestEnvelope,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
  geometryWorkerRequestSchema,
  geometryWorkerResponseSchema,
} from "@vibeshape/protocol"
import { isAnyObject, isError, isInteger, isString } from "is-what"
import type { GeometryKernelEngine } from "./engine"

export interface GeometryWorkerEndpoint {
  postMessage(message: GeometryWorkerResponse, transfer?: Transferable[]): void
}

function readNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function readIdentifier(value: unknown, fallback: string) {
  return isString(value) && value.trim().length > 0 ? value.slice(0, 128) : fallback
}

function fallbackEnvelope(value: unknown): GeometryRequestEnvelope {
  const record = isAnyObject(value) ? value : {}

  return {
    protocolVersion: GEOMETRY_PROTOCOL_VERSION,
    requestId: readIdentifier(record.requestId, "invalid-request"),
    documentId: readIdentifier(record.documentId, "unknown-document"),
    revision: readNonNegativeInteger(record.revision),
    generation: readNonNegativeInteger(record.generation),
  }
}

function errorMessage(error: unknown) {
  return isError(error) ? error.message : "Unknown geometry worker failure."
}

function transferablesFor(response: GeometryWorkerResponse): Transferable[] {
  if (response.type !== "kernelSpikeCompleted") {
    return []
  }

  return [
    response.mesh.positions.buffer,
    response.mesh.normals.buffer,
    response.mesh.indices.buffer,
    response.mesh.triangleFaceIds.buffer,
    response.exchange.stepFile.buffer,
  ].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
}

export class GeometryWorkerRuntime {
  readonly #cancelledRequests = new Map<string, string>()
  readonly #activeDocuments = new Set<string>()
  readonly #latestGenerations = new Map<string, number>()
  #operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly engine: GeometryKernelEngine,
    private readonly endpoint: GeometryWorkerEndpoint,
  ) {}

  async handle(input: unknown) {
    const request = this.#parseRequest(input)

    if (!request) {
      return
    }

    if (request.type === "cancel") {
      this.#acceptCancellation(request)
      return
    }

    if (request.type === "healthCheck") {
      this.#postHealth(request)
      return
    }

    this.#trackGeneration(request)

    const operation = this.#operationQueue.then(() => this.#dispatchSafely(request))
    this.#operationQueue = operation.catch(() => undefined)
    await operation
  }

  #parseRequest(input: unknown): GeometryWorkerRequest | null {
    const parsed = geometryWorkerRequestSchema.safeParse(input)

    if (parsed.success) {
      return parsed.data
    }

    const envelope = fallbackEnvelope(input)
    const unsupportedVersion =
      isAnyObject(input) &&
      isInteger(input.protocolVersion) &&
      input.protocolVersion !== GEOMETRY_PROTOCOL_VERSION

    this.#postFailure(
      envelope,
      unsupportedVersion ? "unsupported-protocol-version" : "invalid-request",
      unsupportedVersion
        ? `Unsupported geometry protocol version: ${String(input.protocolVersion)}.`
        : "Geometry worker request failed runtime validation.",
      null,
      false,
    )
    return null
  }

  #acceptCancellation(request: Extract<GeometryWorkerRequest, { type: "cancel" }>) {
    this.#cancelledRequests.set(request.targetRequestId, request.documentId)
    this.#post({
      ...this.#envelope(request),
      type: "cancellationAccepted",
      targetRequestId: request.targetRequestId,
    })
  }

  #trackGeneration(request: GeometryWorkerRequest) {
    if (request.type !== "runKernelSpike") {
      return
    }

    const previousGeneration = this.#latestGenerations.get(request.documentId) ?? -1
    this.#latestGenerations.set(
      request.documentId,
      Math.max(previousGeneration, request.generation),
    )
  }

  async #dispatchSafely(
    request: Exclude<GeometryWorkerRequest, { type: "cancel" | "healthCheck" }>,
  ) {
    try {
      await this.#dispatch(request)
    } catch (error) {
      this.#postFailure(this.#envelope(request), "internal-error", errorMessage(error), null, false)
    }
  }

  async #dispatch(request: Exclude<GeometryWorkerRequest, { type: "cancel" | "healthCheck" }>) {
    if (request.type === "initializeEngine") {
      await this.#initialize(request)
      return
    }

    if (request.type === "disposeDocument") {
      const ownedShapeCount = this.engine.disposeDocument(request.documentId)
      this.#activeDocuments.delete(request.documentId)
      this.#latestGenerations.delete(request.documentId)
      this.#clearDocumentCancellations(request.documentId)
      this.#post({ ...this.#envelope(request), type: "documentDisposed", ownedShapeCount })
      return
    }

    await this.#runKernelSpike(request)
  }

  async #initialize(request: Extract<GeometryWorkerRequest, { type: "initializeEngine" }>) {
    this.#postProgress(request, "initializing", 0)

    try {
      const engine = await this.engine.initialize()
      this.#post({ ...this.#envelope(request), type: "initialized", engine })
    } catch (error) {
      this.#postFailure(
        this.#envelope(request),
        "kernel-initialization-failed",
        errorMessage(error),
        "initializing",
        true,
      )
    }
  }

  async #runKernelSpike(request: Extract<GeometryWorkerRequest, { type: "runKernelSpike" }>) {
    if (!this.engine.isInitialized()) {
      this.#postFailure(
        this.#envelope(request),
        "engine-not-initialized",
        "Initialize the geometry engine before running kernel operations.",
        null,
        true,
      )
      return
    }

    if (this.#cancelledRequests.delete(request.requestId)) {
      this.#postCancelled(request, "cancelled")
      return
    }

    if (this.#isStale(request)) {
      this.#postCancelled(request, "stale-generation")
      return
    }

    let currentStage: GeometryProgressStage | null = null
    this.#activeDocuments.add(request.documentId)

    try {
      const result = await this.engine.runKernelSpike(request.parameters, (stage, fraction) => {
        currentStage = stage
        this.#postProgress(request, stage, fraction)
      })

      if (this.#cancelledRequests.delete(request.requestId)) {
        this.#postCancelled(request, "cancelled")
        return
      }

      if (this.#isStale(request)) {
        this.#postCancelled(request, "stale-generation")
        return
      }

      this.#post({ ...this.#envelope(request), type: "kernelSpikeCompleted", ...result })
    } catch (error) {
      this.#postFailure(
        this.#envelope(request),
        "geometry-operation-failed",
        errorMessage(error),
        currentStage,
        false,
      )
    }
  }

  #postHealth(request: Extract<GeometryWorkerRequest, { type: "healthCheck" }>) {
    const health = this.engine.getHealth()
    this.#post({
      ...this.#envelope(request),
      type: "health",
      initialized: health.initialized,
      activeDocuments: this.#activeDocuments.size,
      ownedShapeCount: health.ownedShapeCount,
      wasmHeapBytes: health.wasmHeapBytes,
    })
  }

  #clearDocumentCancellations(documentId: string) {
    for (const [requestId, cancelledDocumentId] of this.#cancelledRequests) {
      if (cancelledDocumentId === documentId) {
        this.#cancelledRequests.delete(requestId)
      }
    }
  }

  #isStale(request: GeometryRequestEnvelope) {
    return request.generation < (this.#latestGenerations.get(request.documentId) ?? -1)
  }

  #postCancelled(request: GeometryRequestEnvelope, reason: "cancelled" | "stale-generation") {
    this.#post({
      ...this.#envelope(request),
      type: "requestCancelled",
      targetRequestId: request.requestId,
      reason,
    })
  }

  #postProgress(request: GeometryRequestEnvelope, stage: GeometryProgressStage, fraction: number) {
    this.#post({ ...this.#envelope(request), type: "progress", stage, fraction })
  }

  #postFailure(
    envelope: GeometryRequestEnvelope,
    code: GeometryDiagnosticCode,
    message: string,
    stage: GeometryProgressStage | null,
    retryable: boolean,
  ) {
    this.#post({
      ...envelope,
      type: "failure",
      diagnostic: { code, message, stage, retryable },
    })
  }

  #post(response: GeometryWorkerResponse) {
    const validated = geometryWorkerResponseSchema.parse(response)
    this.endpoint.postMessage(validated, transferablesFor(validated))
  }

  #envelope(request: GeometryRequestEnvelope): GeometryRequestEnvelope {
    return {
      protocolVersion: GEOMETRY_PROTOCOL_VERSION,
      requestId: request.requestId,
      documentId: request.documentId,
      revision: request.revision,
      generation: request.generation,
    }
  }
}

export function createGeometryWorkerRuntime(
  engine: GeometryKernelEngine,
  endpoint: GeometryWorkerEndpoint,
) {
  return new GeometryWorkerRuntime(engine, endpoint)
}
