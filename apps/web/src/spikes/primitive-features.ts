import {
  booleanFeatureType,
  boxFeatureType,
  computeFeatureContentHash,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  cylinderFeatureType,
  documentCoreModule,
  extrusionFeatureType,
  type FeatureId,
  featureCoreModule,
  featureIdSchema,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
  GeometryWorkerRequestError,
} from "@vibeshape/geometry-worker/client"
import {
  extrusionFeatureContentParametersSchema,
  featureContentIdentitySchema,
} from "@vibeshape/protocol"
import { isError } from "is-what"

type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>
type FeatureResponse = Extract<TerminalResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>

interface FeatureEvaluationHarnessState {
  state: "running" | "passed" | "failed"
  box: FeatureResponse | null
  cachedBox: FeatureResponse | null
  cylinder: FeatureResponse | null
  extrusion: FeatureResponse | null
  ellipseExtrusion: FeatureResponse | null
  extrusionAdd: FeatureResponse | null
  extrusionIntersect: FeatureResponse | null
  extrusionRemove: FeatureResponse | null
  boolean: FeatureResponse | null
  cachedBoolean: FeatureResponse | null
  invalidBooleanDiagnostic: string | null
  missingDependencyDiagnostic: string | null
  health: HealthResponse | null
  disposal: DisposalResponse | null
  progress: string[]
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_PRIMITIVE_FEATURES__: FeatureEvaluationHarnessState
  }
}

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const boxFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const cylinderFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const booleanFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103")
const identicalToolFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3104")
const missingBooleanFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3105")
const extrusionFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3106")
const extrusionAddFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3107")
const extrusionRemoveFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3108")
const extrusionIntersectFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3109")
const ellipseExtrusionFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3110")
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const profileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3302",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3303",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3304",
] as const
const ellipseProfileEntityId = "0195b5ac-b220-7a2c-8c33-67a36a7f3310"
const generation = 1
const state: FeatureEvaluationHarnessState = {
  state: "running",
  box: null,
  cachedBox: null,
  cylinder: null,
  extrusion: null,
  ellipseExtrusion: null,
  extrusionAdd: null,
  extrusionIntersect: null,
  extrusionRemove: null,
  boolean: null,
  cachedBoolean: null,
  invalidBooleanDiagnostic: null,
  missingDependencyDiagnostic: null,
  health: null,
  disposal: null,
  progress: [],
  error: null,
}

function extrusionFeature(
  featureId: FeatureId,
  operation: "add" | "intersect" | "new" | "remove",
  dependencies: readonly FeatureId[],
  contentParameters: ReturnType<typeof extrusionFeatureContentParametersSchema.parse>,
) {
  return {
    schemaVersion: 0,
    id: featureId,
    type: extrusionFeatureType.type,
    parameters: {
      profile: {
        schemaVersion: 0,
        sketchId,
        outerBoundaryEntityIds: contentParameters.outer.sourceEntityIds,
        holeBoundaryEntityIds: contentParameters.holes.map(
          ({ sourceEntityIds }) => sourceEntityIds,
        ),
      },
      distance: createLengthQuantity(contentParameters.distance),
      symmetric: contentParameters.symmetric,
      operation,
    },
    dependencies,
    references: [],
    suppressed: false,
  }
}

const extrusionContentParameters = extrusionFeatureContentParametersSchema.parse({
  sketchId,
  plane: "xz",
  outer: {
    sourceEntityIds: profileEntityIds,
    segments: [
      { entityId: profileEntityIds[0], type: "line", start: [0, 0], end: [20, 0] },
      { entityId: profileEntityIds[1], type: "line", start: [20, 0], end: [20, 10] },
      { entityId: profileEntityIds[2], type: "line", start: [20, 10], end: [0, 10] },
      { entityId: profileEntityIds[3], type: "line", start: [0, 10], end: [0, 0] },
    ],
  },
  holes: [],
  distance: 18,
  symmetric: true,
  operation: "new",
})

const ellipseExtrusionContentParameters = extrusionFeatureContentParametersSchema.parse({
  sketchId,
  plane: "xy",
  outer: {
    sourceEntityIds: [ellipseProfileEntityId],
    segments: [
      {
        entityId: ellipseProfileEntityId,
        type: "ellipse",
        center: [0, 0],
        primaryAxisPoint: [5, 0],
        secondaryAxisPoint: [0, 10],
      },
    ],
  },
  holes: [],
  distance: 12,
  symmetric: false,
  operation: "new",
})

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

function feature(
  kind: "boolean" | "box" | "cylinder",
  featureId: FeatureId,
  dependencies: readonly FeatureId[],
) {
  if (kind === "box") {
    return {
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
  }
  if (kind === "cylinder") {
    return {
      schemaVersion: 0,
      id: featureId,
      type: cylinderFeatureType.type,
      parameters: {
        radius: createLengthQuantity(5),
        height: createLengthQuantity(60),
        centered: true,
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }
  }
  return {
    schemaVersion: 0,
    id: featureId,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies,
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
  kind: "boolean" | "box" | "cylinder",
  featureId: FeatureId,
  environment: unknown,
  dependencies: readonly { featureId: FeatureId; contentHash: string }[] = [],
) {
  const content = await computeFeatureContentHash(
    featureRegistry(),
    {
      feature: feature(
        kind,
        featureId,
        dependencies.map(({ featureId: dependencyId }) => dependencyId),
      ),
      dependencies,
      environment,
    },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  const wireContent = featureContentIdentitySchema.parse(content.identity)

  return expectResponse(
    await client.request(
      {
        ...createGeometryRequestEnvelope(documentId, generation, 1),
        type: "evaluateFeature",
        featureId,
        content: wireContent,
        contentHash: content.contentHash,
        dependencies: [...dependencies],
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

async function evaluateExtrusion(
  client: GeometryWorkerClient,
  environment: unknown,
  featureId: FeatureId,
  operation: "add" | "intersect" | "new" | "remove",
  dependencies: readonly { featureId: FeatureId; contentHash: string }[],
  contentParameters = extrusionContentParameters,
) {
  const content = await computeFeatureContentHash(
    featureRegistry(),
    {
      feature: extrusionFeature(
        featureId,
        operation,
        dependencies.map(({ featureId: dependencyId }) => dependencyId),
        contentParameters,
      ),
      dependencies,
      environment,
      contentParameters: { ...contentParameters, operation },
    },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  return expectResponse(
    await client.request(
      {
        ...createGeometryRequestEnvelope(documentId, generation, 1),
        type: "evaluateFeature",
        featureId,
        content: featureContentIdentitySchema.parse(content.identity),
        contentHash: content.contentHash,
        dependencies: [...dependencies],
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

function featureFailureResponse(error: unknown) {
  if (!(error instanceof GeometryWorkerRequestError)) return null
  const response = error.response
  if (response?.type !== "failure") return null
  return response
}

async function expectedEvaluationFailure(
  operation: () => Promise<FeatureResponse>,
  unexpectedSuccessMessage: string,
) {
  try {
    await operation()
    throw new Error(unexpectedSuccessMessage)
  } catch (error) {
    const response = featureFailureResponse(error)
    if (!response) throw error
    return response.diagnostic.code
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
    const environment = initialized.engine.featureContentEnvironment
    const box = await evaluate(client, "box", boxFeatureId, environment)
    state.box = box
    state.cachedBox = await evaluate(client, "box", boxFeatureId, environment)
    const cylinder = await evaluate(client, "cylinder", cylinderFeatureId, environment)
    state.cylinder = cylinder
    state.extrusion = await evaluateExtrusion(client, environment, extrusionFeatureId, "new", [])
    state.ellipseExtrusion = await evaluateExtrusion(
      client,
      environment,
      ellipseExtrusionFeatureId,
      "new",
      [],
      ellipseExtrusionContentParameters,
    )
    const extrusionTarget = [{ featureId: boxFeatureId, contentHash: box.contentHash }]
    state.extrusionAdd = await evaluateExtrusion(
      client,
      environment,
      extrusionAddFeatureId,
      "add",
      extrusionTarget,
    )
    state.extrusionRemove = await evaluateExtrusion(
      client,
      environment,
      extrusionRemoveFeatureId,
      "remove",
      extrusionTarget,
    )
    state.extrusionIntersect = await evaluateExtrusion(
      client,
      environment,
      extrusionIntersectFeatureId,
      "intersect",
      extrusionTarget,
    )
    const booleanDependencies = [
      { featureId: boxFeatureId, contentHash: box.contentHash },
      { featureId: cylinderFeatureId, contentHash: cylinder.contentHash },
    ]
    state.boolean = await evaluate(
      client,
      "boolean",
      booleanFeatureId,
      environment,
      booleanDependencies,
    )
    const identicalTool = await evaluate(client, "box", identicalToolFeatureId, environment)
    state.invalidBooleanDiagnostic = await expectedEvaluationFailure(
      () =>
        evaluate(client, "boolean", booleanFeatureId, environment, [
          { featureId: boxFeatureId, contentHash: box.contentHash },
          { featureId: identicalToolFeatureId, contentHash: identicalTool.contentHash },
        ]),
      "Boolean evaluation unexpectedly accepted an empty subtraction result.",
    )
    state.cachedBoolean = await evaluate(
      client,
      "boolean",
      booleanFeatureId,
      environment,
      booleanDependencies,
    )
    state.missingDependencyDiagnostic = await expectedEvaluationFailure(
      () =>
        evaluate(client, "boolean", missingBooleanFeatureId, environment, [
          { featureId: boxFeatureId, contentHash: "d".repeat(64) },
          { featureId: cylinderFeatureId, contentHash: "e".repeat(64) },
        ]),
      "Boolean evaluation unexpectedly accepted unavailable dependency shapes.",
    )
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
    state.error = isError(error) ? error.message : "Unknown primitive feature failure."
    status.dataset.state = "failed"
    status.textContent = state.error
  } finally {
    client.terminate()
  }
}

void run()
