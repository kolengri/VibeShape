import {
  type DocumentFeatureRebuildResult,
  type FeatureGeometryRecord,
  type FeatureRebuildState,
  rebuildDocumentFeatures,
} from "@vibeshape/application/feature-rebuild"
import {
  createFeatureTypeRegistry,
  createModuleRegistry,
  documentCoreModule,
  type FeatureTypeRegistry,
  featureCoreModule,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import type { GeometryKernelEngine } from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerDiagnosticCode,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse,
  documentWorkerDiagnosticCodeSchema,
  documentWorkerDocumentIdSchema,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
} from "@vibeshape/protocol"
import { isAnyObject, isError, isInteger, isString } from "is-what"

export interface DocumentWorkerEndpoint {
  postMessage(message: DocumentWorkerResponse, transfer?: Transferable[]): void
}

function createBuiltInFeatureRegistry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function readNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function readIdentifier(value: unknown, fallback: string) {
  return isString(value) && value.trim().length > 0 ? value.slice(0, 128) : fallback
}

function readDocumentId(value: unknown) {
  const parsed = documentWorkerDocumentIdSchema.safeParse(value)
  return parsed.success ? parsed.data : "00000000-0000-7000-8000-000000000000"
}

function fallbackEnvelope(value: unknown) {
  const record = isAnyObject(value) ? value : {}
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: readIdentifier(record.requestId, "invalid-request"),
    documentId: readDocumentId(record.documentId),
    revision: readNonNegativeInteger(record.revision),
    generation: readNonNegativeInteger(record.generation),
  } as const
}

function requestEnvelope(input: {
  protocolVersion: typeof DOCUMENT_PROTOCOL_VERSION
  requestId: string
  documentId: string
  revision: number
  generation: number
}) {
  return {
    protocolVersion: input.protocolVersion,
    requestId: input.requestId,
    documentId: input.documentId,
    revision: input.revision,
    generation: input.generation,
  }
}

function errorMessage(error: unknown) {
  if (isError(error)) return error.message
  if (isString(error)) return error
  if (isAnyObject(error) && isString(error.message)) return error.message
  return "Document worker operation failed."
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function cloneGeometry(record: FeatureGeometryRecord): FeatureGeometryRecord {
  return {
    ...record,
    geometry: {
      ...record.geometry,
      mesh: {
        positions: record.geometry.mesh.positions.slice(),
        normals: record.geometry.mesh.normals.slice(),
        indices: record.geometry.mesh.indices.slice(),
        triangleFaceIds: record.geometry.mesh.triangleFaceIds.slice(),
      },
    },
  }
}

function transferablesFor(response: DocumentWorkerResponse) {
  if (response.type !== "documentRebuilt") return []
  return response.geometry.flatMap(({ geometry }) => [
    geometry.mesh.positions.buffer as ArrayBuffer,
    geometry.mesh.normals.buffer as ArrayBuffer,
    geometry.mesh.indices.buffer as ArrayBuffer,
    geometry.mesh.triangleFaceIds.buffer as ArrayBuffer,
  ])
}

function topLevelFailure(result: Extract<DocumentFeatureRebuildResult, { ok: false }>) {
  const code = documentWorkerDiagnosticCodeSchema.safeParse(result.diagnostic.code)
  return {
    code: code.success ? code.data : ("internal-error" as const),
    message: result.diagnostic.message,
  }
}

export class DocumentWorkerRuntime {
  readonly #states = new Map<string, FeatureRebuildState>()
  readonly #latestGenerations = new Map<string, number>()
  #operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly engine: GeometryKernelEngine,
    private readonly endpoint: DocumentWorkerEndpoint,
    private readonly registry: FeatureTypeRegistry = createBuiltInFeatureRegistry(),
  ) {}

  async handle(input: unknown) {
    const request = this.#parseRequest(input)
    if (!request) return
    if (request.type === "healthCheck") {
      this.#postHealth(request)
      return
    }
    if (request.type === "rebuildDocument") this.#trackGeneration(request)
    const operation = this.#operationQueue.then(() => this.#dispatchSafely(request))
    this.#operationQueue = operation.catch(() => undefined)
    await operation
  }

  #parseRequest(input: unknown): DocumentWorkerRequest | null {
    const parsed = documentWorkerRequestSchema.safeParse(input)
    if (parsed.success) return parsed.data
    const unsupportedVersion =
      isAnyObject(input) &&
      isInteger(input.protocolVersion) &&
      input.protocolVersion !== DOCUMENT_PROTOCOL_VERSION
    this.#postFailure(
      fallbackEnvelope(input),
      unsupportedVersion ? "unsupported-protocol-version" : "invalid-request",
      unsupportedVersion
        ? `Unsupported document protocol version: ${String(input.protocolVersion)}.`
        : "Document worker request failed runtime validation.",
      false,
    )
    return null
  }

  #trackGeneration(request: Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>) {
    const previous = this.#latestGenerations.get(request.documentId) ?? -1
    this.#latestGenerations.set(request.documentId, Math.max(previous, request.generation))
  }

  #isStale(request: Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>) {
    return request.generation < (this.#latestGenerations.get(request.documentId) ?? -1)
  }

  async #dispatchSafely(request: DocumentWorkerRequest) {
    try {
      if (request.type === "rebuildDocument") {
        await this.#rebuild(request)
        return
      }
      const ownedShapeCount = this.engine.disposeDocument(request.documentId)
      this.#states.delete(request.documentId)
      this.#post({ ...requestEnvelope(request), type: "documentDisposed", ownedShapeCount })
    } catch (error) {
      this.#postFailure(request, "internal-error", errorMessage(error), false)
    }
  }

  async #rebuild(request: Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>) {
    if (this.#isStale(request)) {
      this.#postFailure(request, "stale-generation", "The rebuild generation is stale.", false)
      return
    }

    let engine: Awaited<ReturnType<GeometryKernelEngine["initialize"]>>
    try {
      engine = await this.engine.initialize()
    } catch (error) {
      this.#postFailure(request, "engine-initialization-failed", errorMessage(error), true)
      return
    }
    const result = await rebuildDocumentFeatures({
      document: request.document,
      generation: request.generation,
      registry: this.registry,
      environment: engine.featureContentEnvironment,
      mesh: request.mesh,
      hash: sha256,
      evaluateGeometry: async (evaluation) => {
        const evaluated = await this.engine.evaluateFeature(
          { ...evaluation, dependencies: [...evaluation.dependencies] },
          (stage, fraction) => {
            evaluation.onProgress?.(stage, fraction)
          },
        )
        return evaluated.ok
          ? { ok: true, geometry: evaluated.result }
          : { ok: false, diagnosticCode: evaluated.diagnostic.code }
      },
      onProgress: (featureId, stage, fraction) => {
        this.#post({ ...requestEnvelope(request), type: "progress", featureId, stage, fraction })
      },
      ...(this.#states.has(request.documentId)
        ? { previous: this.#states.get(request.documentId) as FeatureRebuildState }
        : {}),
    })
    if (this.#isStale(request)) {
      this.#postFailure(request, "stale-generation", "The rebuild generation became stale.", false)
      return
    }
    if (!result.ok) {
      const failure = topLevelFailure(result)
      this.#postFailure(request, failure.code, failure.message, false)
      return
    }

    this.#states.set(request.documentId, result)
    this.#post({
      ...requestEnvelope(request),
      type: "documentRebuilt",
      evaluation: result.evaluation,
      geometry: result.geometry.map(cloneGeometry),
    })
  }

  #postHealth(request: Extract<DocumentWorkerRequest, { type: "healthCheck" }>) {
    const health = this.engine.getHealth()
    this.#post({
      ...requestEnvelope(request),
      type: "health",
      initialized: health.initialized,
      activeDocuments: this.#states.size,
      ownedShapeCount: health.ownedShapeCount,
      wasmHeapBytes: health.wasmHeapBytes,
    })
  }

  #postFailure(
    envelope: Parameters<typeof requestEnvelope>[0],
    code: DocumentWorkerDiagnosticCode,
    message: string,
    retryable: boolean,
  ) {
    const boundedMessage = message.length > 0 ? message.slice(0, 1_024) : "Document worker failed."
    this.#post({
      ...requestEnvelope(envelope),
      type: "failure",
      diagnostic: { code, message: boundedMessage, retryable },
    })
  }

  #post(input: unknown) {
    const response = documentWorkerResponseSchema.parse(input)
    this.endpoint.postMessage(response, transferablesFor(response))
  }
}

export function createDocumentWorkerRuntime(
  engine: GeometryKernelEngine,
  endpoint: DocumentWorkerEndpoint,
  registry?: FeatureTypeRegistry,
) {
  return registry
    ? new DocumentWorkerRuntime(engine, endpoint, registry)
    : new DocumentWorkerRuntime(engine, endpoint)
}
