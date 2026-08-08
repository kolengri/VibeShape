import {
  boxFeatureType,
  computeFeatureContentHash,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  cylinderFeatureType,
  documentCoreModule,
  featureCoreModule,
  type FeatureId,
  featureIdSchema,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import { primitiveFeatureContentIdentitySchema } from "@vibeshape/protocol"

type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>
type FeatureResponse = Extract<TerminalResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>

interface PrimitiveFeatureHarnessState {
  state: "running" | "passed" | "failed"
  box: FeatureResponse | null
  cachedBox: FeatureResponse | null
  cylinder: FeatureResponse | null
  health: HealthResponse | null
  disposal: DisposalResponse | null
  progress: string[]
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_PRIMITIVE_FEATURES__: PrimitiveFeatureHarnessState
  }
}

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const boxFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const cylinderFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const generation = 1
const state: PrimitiveFeatureHarnessState = {
  state: "running",
  box: null,
  cachedBox: null,
  cylinder: null,
  health: null,
  disposal: null,
  progress: [],
  error: null,
}

window.__VIBESHAPE_PRIMITIVE_FEATURES__ = state

function statusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The primitive feature status element is missing.")
  return element
}

function expectResponse<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): Extract<TerminalResponse, { type: Type }> {
  if (response.type !== type) {
    throw new Error(`Expected ${type}, received ${response.type}.`)
  }
  return response as Extract<TerminalResponse, { type: Type }>
}

function featureRegistry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function feature(kind: "box" | "cylinder", featureId: FeatureId) {
  return kind === "box"
    ? {
        schemaVersion: 0,
        id: featureId,
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(2, "cm"),
          depth: createLengthQuantity(30),
          height: createLengthQuantity(1, "in"),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      }
    : {
        schemaVersion: 0,
        id: featureId,
        type: cylinderFeatureType.type,
        parameters: {
          radius: createLengthQuantity(5),
          height: createLengthQuantity(20),
          centered: true,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      }
}

async function sha256(canonicalPayload: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function evaluate(
  client: GeometryWorkerClient,
  kind: "box" | "cylinder",
  featureId: FeatureId,
  environment: unknown,
) {
  const content = await computeFeatureContentHash(
    featureRegistry(),
    { feature: feature(kind, featureId), dependencies: [], environment },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  const wireContent = primitiveFeatureContentIdentitySchema.parse(content.identity)

  return expectResponse(
    await client.request(
      {
        ...createGeometryRequestEnvelope(documentId, generation, 1),
        type: "evaluateFeature",
        featureId,
        content: wireContent,
        contentHash: content.contentHash,
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      },
      {
        onProgress(stage) {
          state.progress.push(stage)
        },
      },
    ),
    "featureEvaluated",
  )
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
    const environment = initialized.engine.featureContentEnvironment
    state.box = await evaluate(client, "box", boxFeatureId, environment)
    state.cachedBox = await evaluate(client, "box", boxFeatureId, environment)
    state.cylinder = await evaluate(client, "cylinder", cylinderFeatureId, environment)
    state.health = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "healthCheck",
      }),
      "health",
    )
    state.disposal = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "disposeDocument",
      }),
      "documentDisposed",
    )
    state.state = "passed"
    status.dataset.state = "passed"
    status.textContent = "Primitive feature evaluation passed."
  } catch (error) {
    state.state = "failed"
    state.error = error instanceof Error ? error.message : "Unknown primitive feature failure."
    status.dataset.state = "failed"
    status.textContent = state.error
  } finally {
    client.terminate()
  }
}

void run()
