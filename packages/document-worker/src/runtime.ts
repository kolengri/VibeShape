import { AssemblyMaterializationCache } from "@vibeshape/application/assembly-materialization"
import {
  type DocumentFeatureRebuildResult,
  type FeatureGeometryEvaluationPort,
  type FeatureGeometryRecord,
  type FeatureRebuildState,
  rebuildDocumentFeatures,
  resolveDocumentFeatureParameters,
} from "@vibeshape/application/feature-rebuild"
import { terminalBodyGeometry } from "@vibeshape/application/model-bodies"
import {
  createFeatureTypeRegistry,
  createModuleRegistry,
  type DocumentSnapshot,
  documentCoreModule,
  documentSnapshotSchema,
  type FeatureTypeRegistry,
  featureCoreModule,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  referenceGeometryFeatureTypeHandlers,
  referenceGeometryModule,
  type SketchRecord,
  sketchRecordSchema,
} from "@vibeshape/domain"
import type { AssemblyConstraintSolvePort } from "@vibeshape/domain/assembly-mates"
import { meshImportFeatureType } from "@vibeshape/domain/part-design-mesh-import"
import { writeThreeMfMeshes } from "@vibeshape/formats/three-mf-meshes"
import type {
  DocumentPrintMeshExportInput,
  DocumentPrintMeshExportResult,
  GeometryKernelEngine,
} from "@vibeshape/geometry-worker/engine"
import { preparePrintMeshes } from "@vibeshape/print-analysis"
import type { PrintPreparationSettings } from "@vibeshape/protocol"
import {
  assemblyConstraintFailureSchema,
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerDiagnosticCode,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse,
  documentWorkerDiagnosticCodeSchema,
  documentWorkerDocumentIdSchema,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
  type FeatureEvaluationDependency,
} from "@vibeshape/protocol"
import type { SketchCompilationInput, SolveSketchRecordResult } from "@vibeshape/sketch-solver"
import { isAnyObject, isError, isInteger, isString } from "is-what"
import { exportAssemblyRuntime } from "./assembly-export"
import { AssemblyMaterializationError, inspectAssemblyRuntime } from "./assembly-inspection"
import { exportBodyName, selectExportBodies } from "./export-bodies"
import {
  type ExternalModelMaterializationCache,
  inspectExternalModelReferenceHealth,
  resolveExternalSketchGeometry,
  type SketchSolveCache,
} from "./external-sketch-references"
import {
  createDocumentFeatureContentPreparer,
  shouldPrepareDocumentFeatureContent,
} from "./extrusion-content"
import {
  collectDocumentPrintMeshes,
  exportDocumentMeshStl,
  exportIncludesMesh,
} from "./mesh-source-export"
import { inspectMeshSource, rebuildImportedMesh } from "./mesh-source-import"
import { createSketchDisplayRecords } from "./sketch-display"
import { validateRebuildSourceMaterialization } from "./source-materialization"

export interface DocumentWorkerEndpoint {
  postMessage(message: DocumentWorkerResponse, transfer?: Transferable[]): void
}

export type SketchSolvePort = (
  input: SketchCompilationInput,
) => SolveSketchRecordResult | Promise<SolveSketchRecordResult>

type SolveSketchRequest = Extract<DocumentWorkerRequest, { type: "solveSketch" }>
type RebuildDocumentSnapshot = Extract<
  DocumentWorkerRequest,
  { type: "rebuildDocument" }
>["document"]
type SketchContextResult =
  | {
      ok: true
      document: DocumentSnapshot
      sketch: SketchRecord
      variables: SketchCompilationInput["variables"]
    }
  | {
      ok: false
      code: DocumentWorkerDiagnosticCode
      message: string
      retryable: boolean
    }

function createBuiltInFeatureRegistry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    partDesignModule,
    referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, [
    ...partDesignFeatureTypeHandlers,
    ...referenceGeometryFeatureTypeHandlers,
  ])
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
  return structuredClone(record)
}

function transferablesFor(response: DocumentWorkerResponse) {
  if (response.type === "documentExported" || response.type === "assemblyExported") {
    return [response.file.buffer as ArrayBuffer]
  }
  if (response.type !== "documentRebuilt") return []
  return [
    ...new Set([
      ...response.geometry.flatMap(({ geometry }) =>
        [geometry.mesh, ...(geometry.bodies ?? []).map(({ mesh }) => mesh)].flatMap((mesh) => [
          mesh.positions.buffer as ArrayBuffer,
          ...(mesh.precisePositions ? [mesh.precisePositions.buffer as ArrayBuffer] : []),
          mesh.normals.buffer as ArrayBuffer,
          mesh.indices.buffer as ArrayBuffer,
          mesh.triangleFaceIds.buffer as ArrayBuffer,
        ]),
      ),
      ...response.sketches.flatMap((sketch) => [
        sketch.curvePositions.buffer as ArrayBuffer,
        sketch.constructionCurvePositions.buffer as ArrayBuffer,
        sketch.pointPositions.buffer as ArrayBuffer,
        sketch.constructionPointPositions.buffer as ArrayBuffer,
      ]),
    ]),
  ]
}

type TextureExportRequestOptions = Pick<
  DocumentPrintMeshExportInput,
  "surfaceTextures" | "textureQuality" | "meshQuality"
>

function textureExportOptions(
  request: Pick<
    Extract<DocumentWorkerRequest, { type: "exportDocument" }>,
    "surfaceTextures" | "textureQuality" | "meshQuality"
  >,
): TextureExportRequestOptions {
  return {
    ...(request.surfaceTextures ? { surfaceTextures: request.surfaceTextures } : {}),
    ...(request.textureQuality ? { textureQuality: request.textureQuality } : {}),
    ...(request.meshQuality ? { meshQuality: request.meshQuality } : {}),
  }
}

function validatePrintMeshExportIdentity(
  result: DocumentPrintMeshExportResult,
  features: readonly FeatureEvaluationDependency[],
) {
  if (
    result.meshes.length !== features.length ||
    result.meshes.some(
      (mesh, index) =>
        mesh.featureId !== features[index]?.featureId ||
        mesh.outputRole !== features[index]?.outputRole,
    )
  )
    throw new Error("Print mesh export returned mismatched feature bodies.")
}

async function exportThreeMfDocument(
  engine: GeometryKernelEngine,
  document: RebuildDocumentSnapshot,
  state: FeatureRebuildState,
  features: readonly FeatureEvaluationDependency[],
  names: ReadonlyMap<string, string>,
  settings?: PrintPreparationSettings,
  textureOptions?: TextureExportRequestOptions,
) {
  const result = await collectDocumentPrintMeshes(
    engine,
    document.id,
    state,
    features,
    textureOptions,
  )
  validatePrintMeshExportIdentity(result, features)
  const labels = new Map(document.features.map(({ id, label }) => [id, label]))
  const meshes = result.meshes.map((mesh, index) => ({
    name: exportBodyName(mesh, names) ?? labels.get(mesh.featureId) ?? `Body ${index + 1}`,
    vertices: [...mesh.vertices],
    triangles: [...mesh.triangles],
  }))
  const printPreparation = settings ? preparePrintMeshes({ meshes, settings }) : undefined
  const exported = writeThreeMfMeshes({
    title: document.name,
    meshes: printPreparation?.meshes ?? meshes,
    assembly: meshes.length > 1 || Boolean(printPreparation),
  })
  return {
    file: exported.bytes,
    bodyCount: result.meshes.length,
    ...(printPreparation ? { printPreparation } : {}),
  }
}

function terminalExportFeatures(state: FeatureRebuildState) {
  const bodies = terminalBodyGeometry(state)
  if (!bodies) throw new Error("Exact terminal body geometry is unavailable.")
  return bodies.map(({ featureId, contentHash, outputRole }) => ({
    featureId,
    contentHash,
    ...(outputRole === undefined ? {} : { outputRole }),
  }))
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
  readonly #assemblyCache = new AssemblyMaterializationCache()
  #assemblyCacheKey: string | null = null

  constructor(
    private readonly engine: GeometryKernelEngine,
    private readonly endpoint: DocumentWorkerEndpoint,
    private readonly registry: FeatureTypeRegistry = createBuiltInFeatureRegistry(),
    private readonly solveSketch: SketchSolvePort | null = null,
    private readonly solveAssembly: AssemblyConstraintSolvePort | undefined = undefined,
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
      if (request.type === "exportAssembly") {
        const exported = await exportAssemblyRuntime(
          this.engine,
          this.registry,
          this.solveSketch,
          request.input.assembly,
          request,
          request.input.settings,
          this.solveAssembly,
        )
        this.#post({
          ...requestEnvelope(request),
          type: "assemblyExported",
          format: request.input.settings.format,
          ...exported,
        })
        return
      }
      if (request.type === "inspectAssembly") {
        await this.#inspectAssembly(request)
        return
      }
      if (request.type === "inspectMeshImport") {
        const inspection = await inspectMeshSource(
          request.input.format,
          request.input.bytes,
          request.input.units,
        )
        this.#post({ ...requestEnvelope(request), type: "meshImportInspected", inspection })
        return
      }
      if (request.type === "inspectSourceImport") {
        await this.#inspectSource(request)
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
      this.#assemblyCache.clear()
      this.#assemblyCacheKey = null
      this.#states.delete(request.documentId)
      this.#documents.delete(request.documentId)
      this.#post({ ...requestEnvelope(request), type: "documentDisposed", ownedShapeCount })
    } catch (error) {
      this.#postOperationError(request, error)
    }
  }

  async #inspectAssembly(request: Extract<DocumentWorkerRequest, { type: "inspectAssembly" }>) {
    const key = `${request.documentId}:${request.revision}:${request.generation}`
    if (this.#assemblyCacheKey !== key) {
      this.#assemblyCache.clear()
      this.#assemblyCacheKey = key
    }
    const inspection = await inspectAssemblyRuntime(
      this.engine,
      this.registry,
      this.solveSketch,
      request.input,
      request,
      this.solveAssembly,
      this.#assemblyCache,
    )
    this.#post({ ...requestEnvelope(request), type: "assemblyInspected", inspection })
  }
  #postOperationError(request: DocumentWorkerRequest, error: unknown) {
    if (error instanceof AssemblyMaterializationError) {
      const assembly = { code: error.diagnostic.code, jointIds: error.diagnostic.jointIds ?? [] }
      this.#post({
        ...requestEnvelope(request),
        type: "failure",
        diagnostic: {
          code: "assembly-solve-failed",
          message: errorMessage(error),
          retryable: false,
          ...(assemblyConstraintFailureSchema.safeParse(assembly).success ? { assembly } : {}),
        },
      })
    } else this.#postFailure(request, "internal-error", errorMessage(error), false)
  }

  async #inspectSource(request: Extract<DocumentWorkerRequest, { type: "inspectSourceImport" }>) {
    if (!this.engine.inspectSourceImport) throw new Error("Exact source inspection is unavailable.")
    const inspection = await this.engine.inspectSourceImport(request.input)
    this.#post({ ...requestEnvelope(request), type: "sourceImportInspected", inspection })
  }

  #exportState(request: Extract<DocumentWorkerRequest, { type: "exportDocument" }>) {
    const state = this.#states.get(request.documentId)
    const document = this.#documents.get(request.documentId)
    if (
      !state ||
      !document ||
      state.revision !== request.revision ||
      state.generation !== request.generation
    )
      return null
    return { state, document }
  }

  async #exportDocument(request: Extract<DocumentWorkerRequest, { type: "exportDocument" }>) {
    const current = this.#exportState(request)
    if (!current) {
      this.#postFailure(
        request,
        "export-state-unavailable",
        "The requested document revision does not have current rebuilt geometry.",
        true,
      )
      return
    }

    const { state, document } = current
    try {
      const { features, names } = selectExportBodies(terminalExportFeatures(state), request.bodies)
      if (features.length === 0) {
        this.#postFailure(
          request,
          "no-exportable-bodies",
          "The current document does not contain a terminal solid body to export.",
          false,
        )
        return
      }

      const hasMeshes = exportIncludesMesh(state, features)
      if (hasMeshes && request.format === "step")
        throw new Error("STEP export requires exact solids. Export mesh parts as STL or 3MF.")
      const textureOptions = textureExportOptions(request)
      const exported =
        request.format === "3mf"
          ? await exportThreeMfDocument(
              this.engine,
              document,
              state,
              features,
              names,
              request.printPreparation,
              textureOptions,
            )
          : hasMeshes
            ? await exportDocumentMeshStl(this.engine, document.id, state, features, textureOptions)
            : await this.engine.exportDocument({
                documentId: request.documentId,
                features,
                format: request.format,
                ...textureOptions,
              })
      this.#post({
        ...requestEnvelope(request),
        type: "documentExported",
        format: request.format,
        file: exported.file,
        bodyCount: exported.bodyCount,
        ...("printPreparation" in exported ? { printPreparation: exported.printPreparation } : {}),
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
    const parsedDocument = documentSnapshotSchema.safeParse(document)
    if (!parsedDocument.success) {
      return {
        ok: false,
        code: "sketch-state-unavailable",
        message: "The requested document has invalid sketch state.",
        retryable: false,
      }
    }
    const candidate =
      request.draftSketch ??
      parsedDocument.data.sketches.find((candidate) => candidate.id === request.sketchId)
    const parsedSketch = sketchRecordSchema.safeParse(candidate)
    if (!parsedSketch.success) {
      return {
        ok: false,
        code: "sketch-not-found",
        message: "The requested sketch does not exist.",
        retryable: false,
      }
    }
    return {
      ok: true,
      document: parsedDocument.data,
      sketch: parsedSketch.data,
      variables: parsedDocument.data.variables,
    }
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
      const sectionPlanarFace = this.engine.sectionPlanarFace?.bind(this.engine)
      const externalGeometry = await resolveExternalSketchGeometry(
        context.document,
        context.sketch,
        this.solveSketch,
        resolveDocumentFeatureParameters(context.document, this.registry),
        new Map(),
        this.#states.get(request.documentId)?.geometry ?? [],
        sectionPlanarFace,
      )
      const result = await this.solveSketch({
        revision: request.revision,
        sketch: context.sketch,
        variables: context.variables,
        continuation: request.continuation,
        draggedPoints: request.draggedPoints,
        ...externalGeometry,
      })
      this.#postSketchResult(request, result)
    } catch (error) {
      this.#postFailure(request, "sketch-solve-failed", errorMessage(error), true)
    }
  }

  #evaluationPort(
    request: Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>,
    environment: Awaited<ReturnType<GeometryKernelEngine["initialize"]>>,
  ): FeatureGeometryEvaluationPort {
    return async (evaluation) => {
      const sourceAssetId = request.document.features.find(({ id }) => id === evaluation.featureId)
        ?.parameters.sourceAssetId
      const source = request.sourceAssets?.find(({ asset }) => asset.id === sourceAssetId)
      if (
        Object.entries(meshImportFeatureType.type).every(
          ([key, value]) =>
            evaluation.content.feature.type[key as keyof typeof meshImportFeatureType.type] ===
            value,
        )
      ) {
        try {
          return {
            ok: true,
            geometry: await rebuildImportedMesh(
              evaluation.content.feature.parameters,
              source,
              environment,
            ),
          }
        } catch {
          return { ok: false, diagnosticCode: "invalid-feature-geometry" }
        }
      }
      const evaluated = await this.engine.evaluateFeature(
        { ...evaluation, dependencies: [...evaluation.dependencies] },
        (stage, fraction) => evaluation.onProgress?.(stage, fraction),
        source,
      )
      return evaluated.ok
        ? { ok: true, geometry: evaluated.result }
        : {
            ok: false,
            diagnosticCode: evaluated.diagnostic.code,
            ...(evaluation.content.feature.type.typeId ===
              "org.vibeshape.feature.part-design.loft" &&
            evaluation.content.feature.type.schemaVersion === 3
              ? { diagnosticMessage: evaluated.diagnostic.message.slice(0, 1024) }
              : {}),
          }
    }
  }

  async #initializeRebuild(request: Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>) {
    try {
      await validateRebuildSourceMaterialization(
        documentSnapshotSchema.parse(request.document),
        request.sourceAssets ?? [],
      )
    } catch (error) {
      this.#postFailure(request, "invalid-document-snapshot", errorMessage(error), false)
      return null
    }
    let engine: Awaited<ReturnType<GeometryKernelEngine["initialize"]>>
    try {
      engine = await this.engine.initialize()
    } catch (error) {
      this.#postFailure(request, "engine-initialization-failed", errorMessage(error), true)
      return null
    }
    return engine
  }

  async #rebuild(request: Extract<DocumentWorkerRequest, { type: "rebuildDocument" }>) {
    if (this.#isStale(request)) {
      this.#postFailure(request, "stale-generation", "The rebuild generation is stale.", false)
      return
    }

    const engine = await this.#initializeRebuild(request)
    if (!engine) return
    const solvedBySketchId: SketchSolveCache = new Map()
    const modelMaterializationCache: ExternalModelMaterializationCache = new Map()
    const sectionPlanarFace = this.engine.sectionPlanarFace?.bind(this.engine)
    const result = await rebuildDocumentFeatures({
      document: request.document,
      generation: request.generation,
      registry: this.registry,
      environment: engine.featureContentEnvironment,
      mesh: request.mesh,
      hash: sha256,
      prepareFeatureContent: createDocumentFeatureContentPreparer(
        this.solveSketch,
        solvedBySketchId,
        sectionPlanarFace,
        modelMaterializationCache,
      ),
      shouldPrepareFeatureContent: shouldPrepareDocumentFeatureContent,
      evaluateGeometry: this.#evaluationPort(request, engine),
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

    const modelReferenceEvidence = await inspectExternalModelReferenceHealth(
      documentSnapshotSchema.parse(request.document),
      result.features,
      result.geometry,
      sectionPlanarFace,
      modelMaterializationCache,
      () => !this.#isStale(request),
    )
    if (this.#isStale(request)) {
      this.#postFailure(
        request,
        "stale-generation",
        "The model reference evidence generation became stale.",
        false,
      )
      return
    }

    const sketches = await createSketchDisplayRecords(
      documentSnapshotSchema.parse(request.document),
      this.solveSketch,
      solvedBySketchId,
      result.features,
      result.geometry,
      sectionPlanarFace,
      modelMaterializationCache,
    )
    if (this.#isStale(request)) {
      this.#postFailure(
        request,
        "stale-generation",
        "The sketch display generation became stale.",
        false,
      )
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
      sketches,
      modelReferenceEvidence,
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
  options: Readonly<{
    registry?: FeatureTypeRegistry
    solveSketch?: SketchSolvePort
    solveAssembly?: AssemblyConstraintSolvePort
  }> = {},
) {
  return new DocumentWorkerRuntime(
    engine,
    endpoint,
    options.registry ?? createBuiltInFeatureRegistry(),
    options.solveSketch ?? null,
    options.solveAssembly,
  )
}
