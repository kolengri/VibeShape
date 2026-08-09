import {
  type DocumentFeatureRebuildResult,
  type FeatureGeometryEvaluationPort,
  rebuildDocumentFeatures,
} from "@vibeshape/application/feature-rebuild"
import {
  booleanFeatureType,
  boxFeatureType,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  cylinderFeatureType,
  documentCoreModule,
  type FeatureId,
  type FeatureRecord,
  featureCoreModule,
  featureIdSchema,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import { createGeometryFeatureEvaluationPort } from "../geometry/feature-evaluation-port"

type SuccessfulRebuild = Extract<DocumentFeatureRebuildResult, { ok: true }>
type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>

type RebuildSummary = {
  records: SuccessfulRebuild["evaluation"]["records"]
  dirtyFeatureIds: readonly FeatureId[]
  evaluatedFeatureIds: readonly FeatureId[]
  reusedFeatureIds: readonly FeatureId[]
  geometry: readonly {
    featureId: FeatureId
    contentHash: string
    volume: number
    brepHit: boolean
  }[]
}

interface FeatureRebuildHarnessState {
  state: "running" | "passed" | "failed"
  initial: RebuildSummary | null
  reused: RebuildSummary | null
  changed: RebuildSummary | null
  requestFeatureIds: FeatureId[]
  progress: string[]
  health: HealthResponse | null
  disposal: DisposalResponse | null
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_FEATURE_REBUILD__: FeatureRebuildHarnessState
  }
}

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureIds = {
  box: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101"),
  cylinder: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102"),
  boolean: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103"),
} as const
const generation = 1

const state: FeatureRebuildHarnessState = {
  state: "running",
  initial: null,
  reused: null,
  changed: null,
  requestFeatureIds: [],
  progress: [],
  health: null,
  disposal: null,
  error: null,
}

window.__VIBESHAPE_FEATURE_REBUILD__ = state

function statusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The feature rebuild status element is missing.")
  return element
}

function expectResponse<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): Extract<TerminalResponse, { type: Type }> {
  if (response.type !== type) throw new Error(`Expected ${type}, received ${response.type}.`)
  return response as Extract<TerminalResponse, { type: Type }>
}

function featureRegistry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function documentSnapshot(cylinderHeight: number, revision: number) {
  const box: FeatureRecord = {
    schemaVersion: 0,
    id: featureIds.box,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(25.4),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
  const cylinder: FeatureRecord = {
    schemaVersion: 0,
    id: featureIds.cylinder,
    type: cylinderFeatureType.type,
    parameters: {
      radius: createLengthQuantity(5),
      height: createLengthQuantity(cylinderHeight),
      centered: true,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
  const boolean: FeatureRecord = {
    schemaVersion: 0,
    id: featureIds.boolean,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies: [featureIds.box, featureIds.cylinder],
    references: [],
    suppressed: false,
  }
  return {
    schemaVersion: 0,
    id: documentId,
    revision,
    name: "Feature rebuild harness",
    features: [boolean, cylinder, box],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  } as const
}

async function sha256(canonicalPayload: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function observedPort(port: FeatureGeometryEvaluationPort): FeatureGeometryEvaluationPort {
  return (request) => {
    state.requestFeatureIds.push(request.featureId)
    return port(request)
  }
}

function summary(result: DocumentFeatureRebuildResult) {
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return {
    records: result.evaluation.records,
    dirtyFeatureIds: result.evaluation.dirtyFeatureIds,
    evaluatedFeatureIds: result.evaluation.evaluatedFeatureIds,
    reusedFeatureIds: result.evaluation.reusedFeatureIds,
    geometry: result.geometry.map(({ featureId, contentHash, geometry }) => ({
      featureId,
      contentHash,
      volume: geometry.shape.volume,
      brepHit: geometry.cache.brepHit,
    })),
  }
}

async function run() {
  const client = createGeometryWorkerClient()
  const status = statusElement()
  try {
    const initialized = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "initializeEngine",
      }),
      "initialized",
    )
    const evaluateGeometry = observedPort(createGeometryFeatureEvaluationPort(client))
    const initialDocument = documentSnapshot(60, 1)
    const common = {
      generation,
      registry: featureRegistry(),
      environment: initialized.engine.featureContentEnvironment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash: sha256,
      evaluateGeometry,
      onProgress(featureId: FeatureId, stage: string) {
        state.progress.push(`${featureId}:${stage}`)
      },
    } as const

    const initialResult = await rebuildDocumentFeatures({
      ...common,
      document: initialDocument,
    })
    state.initial = summary(initialResult)
    if (!initialResult.ok) throw new Error(initialResult.diagnostic.message)

    const reusedResult = await rebuildDocumentFeatures({
      ...common,
      document: initialDocument,
      previous: initialResult,
    })
    state.reused = summary(reusedResult)

    const changedResult = await rebuildDocumentFeatures({
      ...common,
      document: documentSnapshot(20, 2),
      previous: initialResult,
    })
    state.changed = summary(changedResult)

    state.health = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation, 2),
        type: "healthCheck",
      }),
      "health",
    )
    state.disposal = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation, 2),
        type: "disposeDocument",
      }),
      "documentDisposed",
    )
    state.state = "passed"
    status.dataset.state = "passed"
    status.textContent = "Feature rebuild coordination passed."
  } catch (error) {
    state.state = "failed"
    state.error = error instanceof Error ? error.message : "Unknown feature rebuild failure."
    status.dataset.state = "failed"
    status.textContent = state.error
  } finally {
    client.terminate()
  }
}

void run()
