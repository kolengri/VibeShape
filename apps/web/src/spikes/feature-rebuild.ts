import {
  createDocumentRequestEnvelope,
  createDocumentWorkerClient,
  type DocumentWorkerClient,
} from "@vibeshape/document-worker/client"
import {
  booleanFeatureType,
  boxFeatureType,
  createLengthQuantity,
  cylinderFeatureType,
  type FeatureRecord,
  featureIdSchema,
} from "@vibeshape/domain"
import { documentRebuildSnapshotSchema } from "@vibeshape/protocol"

type TerminalResponse = Awaited<ReturnType<DocumentWorkerClient["request"]>>
type SuccessfulRebuild = Extract<TerminalResponse, { type: "documentRebuilt" }>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>

type RebuildSummary = {
  records: SuccessfulRebuild["evaluation"]["records"]
  dirtyFeatureIds: readonly string[]
  evaluatedFeatureIds: readonly string[]
  reusedFeatureIds: readonly string[]
  geometry: readonly {
    featureId: string
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
  requestFeatureIds: string[]
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
  return documentRebuildSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision,
    name: "Feature rebuild harness",
    features: [boolean, cylinder, box],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  })
}

function summary(result: SuccessfulRebuild) {
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
  const client = createDocumentWorkerClient()
  const status = statusElement()
  try {
    const initialDocument = documentSnapshot(60, 1)
    const rebuild = async (document: ReturnType<typeof documentSnapshot>) => {
      const response = await client.request(
        {
          ...createDocumentRequestEnvelope(documentId, generation, document.revision),
          type: "rebuildDocument",
          document,
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        },
        {
          onProgress(progress) {
            state.progress.push(`${progress.featureId}:${progress.stage}`)
            if (progress.stage === "feature-validation") {
              state.requestFeatureIds.push(progress.featureId)
            }
          },
        },
      )
      return expectResponse(response, "documentRebuilt")
    }

    const initialResult = await rebuild(initialDocument)
    state.initial = summary(initialResult)

    const reusedResult = await rebuild(initialDocument)
    state.reused = summary(reusedResult)

    const changedResult = await rebuild(documentSnapshot(20, 2))
    state.changed = summary(changedResult)

    state.health = expectResponse(
      await client.request({
        ...createDocumentRequestEnvelope(documentId, generation, 2),
        type: "healthCheck",
      }),
      "health",
    )
    state.disposal = expectResponse(
      await client.request({
        ...createDocumentRequestEnvelope(documentId, generation, 2),
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
