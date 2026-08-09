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
import type { SketchCompilationInput, SolveSketchRecordResult } from "@vibeshape/sketch-solver"
import { isAnyObject, isError, isInteger, isString } from "is-what"

export interface DocumentWorkerEndpoint {
  postMessage(message: DocumentWorkerResponse, transfer?: Transferable[]): void
}

export type SketchSolvePort = (
  input: SketchCompilationInput,
) => SolveSketchRecordResult | Promise<SolveSketchRecordResult>

type SolveSketchRequest = Extract<DocumentWorkerRequest, { type: "solveSketch" }>
type SketchContextResult =
  | {
      ok: true
      sketch: SketchCompilationInput["sketch"]
      variables: SketchCompilationInput["variables"]
    }
  | {
      ok: false
      code: DocumentWorkerDiagnosticCode
      message: string
      retryable: boolean
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
  if (response.type === "documentExported") {
    return [response.file.buffer as ArrayBuffer]
  }
  if (response.type !== "documentRebuilt") return []
  return response.geometry.flatMap(({ geometry }) => [
    geometry.mesh.positions.buffer as ArrayBuffer,
    geometry.mesh.normals.buffer as ArrayBuffer,
    geometry.mesh.indices.buffer as ArrayBuffer,
    geometry.mesh.triangleFaceIds.buffer as ArrayBuffer,
  ])
}

function terminalExportFeatures(state: FeatureRebuildState) {
  const successfulHashes = new Map(
    state.evaluation.records.flatMap((record) =>
      record.status === "succeeded" ? [[record.featureId, record.contentHash] as const] : [],
    ),
  )
  const consumedFeatureIds = new Set<string>()
  for (const feature of state.features) {
    if (!successfulHashes.has(feature.id)) continue
    for (const dependencyId of feature.dependencies) {
      if (successfulHashes.has(dependencyId)) consumedFeatureIds.add(dependencyId)
    }
  }
  const solidFeatureIds = new Set(
    state.geometry.flatMap((record) =>
      record.geometry.shape.solidCount > 0 ? [record.featureId] : [],
    ),
  )

  return state.features.flatMap((feature) => {
    const contentHash = successfulHashes.get(feature.id)
    return contentHash && solidFeatureIds.has(feature.id) && !consumedFeatureIds.has(feature.id)
      ? [{ featureId: feature.id, contentHash }]
      : []
  })
}

function retainedFeatureContent(state: FeatureRebuildState) {
  return state.evaluation.records.flatMap((record) =>
    record.status === "succeeded"
      ? [{ featureId: record.featureId, contentHash: record.contentHash }]
      : [],
  )
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
  readonly #documents = new Map<
    string,
    Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>["document"]
  >()
  readonly #latestGenerations = new Map<string, number>()
  #operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly engine: GeometryKernelEngine,
    private readonly endpoint: DocumentWorkerEndpoint,
    private readonly registry: FeatureTypeRegistry = createBuiltInFeatureRegistry(),
    private readonly solveSketch: SketchSolvePort | null = null,
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
      if (request.type === "exportDocument") {
        await this.#exportDocument(request)
        return
      }
      if (request.type === "solveSketch") {
        await this.#solveSketch(request)
        return
      }
      const ownedShapeCount = this.engine.disposeDocument(request.documentId)
      this.#states.delete(request.documentId)
      this.#documents.delete(request.documentId)
      this.#post({ ...requestEnvelope(request), type: "documentDisposed", ownedShapeCount })
    } catch (error) {
      this.#postFailure(request, "internal-error", errorMessage(error), false)
    }
  }

  async #exportDocument(request: Extract<DocumentWorkerRequest, { type: "exportDocument" }>) {
    const state = this.#states.get(request.documentId)
    if (!state || state.revision !== request.revision || state.generation !== request.generation) {
      this.#postFailure(
        request,
        "export-state-unavailable",
        "The requested document revision does not have current rebuilt geometry.",
        true,
      )
      return
    }

    const features = terminalExportFeatures(state)
    if (features.length === 0) {
      this.#postFailure(
        request,
        "no-exportable-bodies",
        "The current document does not contain a terminal solid body to export.",
        false,
      )
      return
    }

    try {
      const exported = await this.engine.exportDocument({
        documentId: request.documentId,
        features,
        format: request.format,
      })
      this.#post({
        ...requestEnvelope(request),
        type: "documentExported",
        format: request.format,
        file: exported.file,
        bodyCount: exported.bodyCount,
      })
    } catch (error) {
      this.#postFailure(request, "export-failed", errorMessage(error), true)
    }
  }

  #sketchContext(request: SolveSketchRequest): SketchContextResult {
    const state = this.#states.get(request.documentId)
    const document = this.#documents.get(request.documentId)
    if (
      !state ||
      !document ||
      state.revision !== request.revision ||
      state.generation !== request.generation
    ) {
      return {
        ok: false,
        code: "sketch-state-unavailable",
        message: "The requested document revision does not have current sketch state.",
        retryable: true,
      }
    }
    const sketch = document.sketches.find((candidate) => candidate.id === request.sketchId)
    if (!sketch) {
      return {
        ok: false,
        code: "sketch-not-found",
        message: "The requested sketch does not exist.",
        retryable: false,
      }
    }
    return { ok: true, sketch, variables: document.variables }
  }

  #postSketchResult(request: SolveSketchRequest, result: SolveSketchRecordResult) {
    if (!result.ok) {
      this.#postFailure(request, "sketch-solve-invalid", result.diagnostic.message, false)
      return
    }
    if (
      result.solution.sketchId !== request.sketchId ||
      result.solution.sourceRevision !== request.revision
    ) {
      this.#postFailure(
        request,
        "sketch-solve-failed",
        "The sketch solver returned a mismatched solution identity.",
        true,
      )
      return
    }
    this.#post({ ...requestEnvelope(request), type: "sketchSolved", solution: result.solution })
  }

  async #solveSketch(request: SolveSketchRequest) {
    const context = this.#sketchContext(request)
    if (!context.ok) {
      this.#postFailure(request, context.code, context.message, context.retryable)
      return
    }
    if (!this.solveSketch) {
      this.#postFailure(
        request,
        "sketch-solver-unavailable",
        "The production sketch solver is not available in this build.",
        false,
      )
      return
    }
    try {
      const result = await this.solveSketch({
        revision: request.revision,
        sketch: context.sketch,
        variables: context.variables,
        continuation: request.continuation,
        draggedPoints: request.draggedPoints,
      })
      this.#postSketchResult(request, result)
    } catch (error) {
      this.#postFailure(request, "sketch-solve-failed", errorMessage(error), true)
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

    this.engine.synchronizeDocumentFeatures(request.documentId, retainedFeatureContent(result))
    this.#states.set(request.documentId, result)
    this.#documents.set(request.documentId, request.document)
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
  options: Readonly<{ registry?: FeatureTypeRegistry; solveSketch?: SketchSolvePort }> = {},
) {
  return new DocumentWorkerRuntime(
    engine,
    endpoint,
    options.registry ?? createBuiltInFeatureRegistry(),
    options.solveSketch ?? null,
  )
}
