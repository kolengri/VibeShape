import {
  boxFeatureType,
  chamferFeatureParametersSchema,
  chamferFeatureType,
  chamferFeatureTypeV2,
  computeFeatureContentHash,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  documentCoreModule,
  type FeatureContentIdentity,
  featureContentIdentitySchema,
  featureCoreModule,
  featureIdSchema,
  featureParametersSchema,
  filletFeatureParametersSchema,
  filletFeatureType,
  filletFeatureTypeV2,
  holeFeatureType,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  GeometryWorkerClient,
  GeometryWorkerRequestError,
} from "@vibeshape/geometry-worker/client"
import {
  geometryLifecycleOperationSchema,
  holeFeatureContentParametersSchema,
  serializeFeatureContentIdentity,
} from "@vibeshape/protocol"
import { createKernelSpikeParameters } from "@vibeshape/test-models"
import { isError } from "is-what"
import { z } from "zod"
import { evaluateBodyOutputFixture } from "./body-output-fixture"
import SelectedGeometryWorker from "./selected-geometry-worker?worker"

type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>
type KernelResponse = Extract<TerminalResponse, { type: "kernelSpikeCompleted" }>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>
type FeatureResponse = Extract<TerminalResponse, { type: "featureEvaluated" }>
type HoleEvidence = {
  blindForward: FeatureResponse
  blindReverse: FeatureResponse
  throughAll: FeatureResponse
  throughReverse: FeatureResponse
  multiCenter: FeatureResponse
  smallBlind: FeatureResponse
  rotatedFrame: FeatureResponse
  rejected: string[]
  sourceVolume: number
  sourceVolumeAfter: number
}

interface GeometryWorkerRestartEvidence {
  beforeTermination: HealthResponse
  afterInitialization: HealthResponse
  result: KernelResponse
  disposal: DisposalResponse
}

interface GeometrySpikeHarnessState {
  state: "running" | "passed" | "failed"
  result: KernelResponse | null
  results: KernelResponse[]
  health: HealthResponse | null
  disposal: DisposalResponse | null
  restart: GeometryWorkerRestartEvidence | null
  progress: string[]
  error: string | null
  edgeTreatments: {
    fillet: FeatureResponse
    chamfer: FeatureResponse
    rejected: string[]
    sourceVolume: number
    retainedShapeCounts: number[]
  } | null
  selectedEdgeTreatments: {
    fillet: FeatureResponse
    chamfer: FeatureResponse
    twoEdgeFillet: FeatureResponse
    sourceVolumeAfter: number
    sourceVolume: number
    rejected: string[]
  } | null
  holes: HoleEvidence | null
  bodyOutputs: Awaited<ReturnType<typeof evaluateBodyOutputFixture>> | null
}

const booleanQueryParameterSchema = z.enum(["true", "false"]).transform((value) => value === "true")

declare global {
  interface Window {
    __VIBESHAPE_GEOMETRY_SPIKE__: GeometrySpikeHarnessState
  }
}

function isResponseType<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): response is Extract<TerminalResponse, { type: Type }> {
  return response.type === type
}

function expectResponse<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): Extract<TerminalResponse, { type: Type }> {
  if (!isResponseType(response, type)) {
    throw new Error(`Expected ${type}, received ${response.type}.`)
  }

  return response
}

function requireStatusElement() {
  const element = document.querySelector<HTMLElement>("#status")

  if (!element) {
    throw new Error("The geometry spike status element is missing.")
  }

  return element
}

const statusElement = requireStatusElement()
const documentId = "occt-worker-spike"
const generation = 1
const state: GeometrySpikeHarnessState = {
  state: "running",
  result: null,
  results: [],
  health: null,
  disposal: null,
  restart: null,
  progress: [],
  error: null,
  edgeTreatments: null,
  selectedEdgeTreatments: null,
  holes: null,
  bodyOutputs: null,
}

window.__VIBESHAPE_GEOMETRY_SPIKE__ = state

function readPositiveIntegerParameter(name: string, fallback: number, maximum: number) {
  const requested = new URLSearchParams(window.location.search).get(name)

  if (requested === null) {
    return fallback
  }

  const value = Number(requested)

  assertBoundedInteger(name, value, maximum)
  return value
}

function assertBoundedInteger(name: string, value: number, maximum: number) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`)
  }

  if (value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`)
  }
}

function createSpikeParameters() {
  const parameters = createKernelSpikeParameters()
  const searchParameters = new URLSearchParams(window.location.search)
  const lifecycleIterations = readPositiveIntegerParameter(
    "lifecycleIterations",
    parameters.lifecycleIterations,
    1_000,
  )
  const requestedOperation = searchParameters.get("lifecycleOperation")
  const lifecycleOperation = geometryLifecycleOperationSchema.parse(
    requestedOperation ?? parameters.lifecycleOperation,
  )
  const requestedPurge = searchParameters.get("purgeAfterLifecycle")
  const purgeAfterLifecycle = requestedPurge
    ? booleanQueryParameterSchema.parse(requestedPurge)
    : parameters.purgeAfterLifecycle

  return { ...parameters, lifecycleIterations, lifecycleOperation, purgeAfterLifecycle }
}

async function initializeEngine(client: GeometryWorkerClient) {
  const initialized = await client.request({
    ...createGeometryRequestEnvelope(documentId, generation),
    type: "initializeEngine",
  })
  return expectResponse(initialized, "initialized")
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function featureRegistry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const registry = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!registry.ok) throw new Error(registry.diagnostic.message)
  return registry.registry
}

const boxFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const filletFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3131")
const chamferFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3132")
const selectedFilletFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3133")
const selectedChamferFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3134")
const twoEdgeFilletFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3135")
const holeBlindForwardId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3141")
const holeBlindReverseId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3142")
const holeThroughAllId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3143")
const holeMultiCenterId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3144")
const holeRotatedId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3145")
const holeNoOpId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3146")
const holeSplitId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3147")
const holeEmptyId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3148")

const holeFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}

function holeIdentity(
  parameters: unknown,
  boxContentHash: string,
  environment: FeatureContentIdentity["environment"],
): FeatureContentIdentity {
  return {
    schemaVersion: 0,
    feature: {
      schemaVersion: 0,
      type: holeFeatureType.type,
      parameters: featureParametersSchema.parse(
        holeFeatureContentParametersSchema.parse(parameters),
      ),
      inputs: [boxContentHash],
      references: [],
    },
    environment,
  }
}

async function evaluateFixtureBox(
  client: GeometryWorkerClient,
  content: Readonly<{ identity: FeatureContentIdentity; contentHash: string }>,
) {
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "evaluateFeature",
      featureId: boxFeatureId,
      content: featureContentIdentitySchema.parse(content.identity),
      contentHash: content.contentHash,
      dependencies: [],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }),
    "featureEvaluated",
  )
}

async function holeFixture(
  client: GeometryWorkerClient,
  environment: FeatureContentIdentity["environment"],
): Promise<HoleEvidence> {
  const boxIdentity: FeatureContentIdentity = {
    schemaVersion: 0,
    feature: {
      schemaVersion: 0,
      type: boxFeatureType.type,
      parameters: { width: 20, depth: 20, height: 20, centered: false, origin: [0, 0, 0] },
      inputs: [],
      references: [],
    },
    environment,
  }
  const boxContentHash = await sha256(serializeFeatureContentIdentity(boxIdentity))
  const box = await evaluateFixtureBox(client, {
    identity: boxIdentity,
    contentHash: boxContentHash,
  })
  const common = { frame: holeFrame, diameter: 2, direction: "forward" as const }
  const cases = [
    {
      id: holeBlindForwardId,
      parameters: { ...common, centers: [[0, 0, 10]], extent: "blind", depth: 1 },
    },
    {
      id: holeBlindReverseId,
      parameters: {
        ...common,
        direction: "reverse",
        centers: [[0, 0, 10]],
        extent: "blind",
        depth: 1,
      },
    },
    {
      id: holeThroughAllId,
      parameters: { ...common, centers: [[0, 0, 10]], extent: "through-all" },
    },
    {
      id: holeBlindReverseId,
      parameters: { ...common, direction: "reverse", centers: [[0, 0, 10]], extent: "through-all" },
    },
    {
      id: holeBlindForwardId,
      parameters: { ...common, diameter: 0.01, centers: [[0, 0, 10]], extent: "blind", depth: 1 },
    },
    {
      id: holeMultiCenterId,
      parameters: {
        ...common,
        centers: [
          [-5, -5, 10],
          [5, 5, 10],
        ],
        extent: "through-all",
      },
    },
    {
      id: holeRotatedId,
      parameters: {
        ...common,
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, Math.SQRT1_2, Math.SQRT1_2],
          normal: [0, -Math.SQRT1_2, Math.SQRT1_2],
        },
        centers: [[0, 0, 10]],
        extent: "through-all",
      },
    },
  ] as const
  const [
    blindForward,
    blindReverse,
    throughAll,
    throughReverse,
    smallBlind,
    multiCenter,
    rotatedFrame,
  ] = await evaluateHoleCases(client, environment, cases, boxContentHash)
  const rejected = await evaluateRejectedHoleCases(client, environment, boxContentHash, [
    ["no-op", holeNoOpId, { ...common, centers: [[0, 0, 30]], extent: "through-all" }],
    [
      "split",
      holeSplitId,
      { ...common, diameter: 22, centers: [[0, 0, 0]], extent: "through-all" },
    ],
    [
      "empty",
      holeEmptyId,
      { ...common, diameter: 30, centers: [[0, 0, 0]], extent: "blind", depth: 100 },
    ],
  ])
  const sourceAfter = await evaluateFixtureBox(client, {
    identity: boxIdentity,
    contentHash: boxContentHash,
  })
  return {
    blindForward: requiredHoleResult(blindForward),
    blindReverse: requiredHoleResult(blindReverse),
    throughAll: requiredHoleResult(throughAll),
    throughReverse: requiredHoleResult(throughReverse),
    multiCenter: requiredHoleResult(multiCenter),
    smallBlind: requiredHoleResult(smallBlind),
    rotatedFrame: requiredHoleResult(rotatedFrame),
    rejected,
    sourceVolume: box.shape.volume,
    sourceVolumeAfter: sourceAfter.shape.volume,
  }
}

function requiredHoleResult(result: FeatureResponse | undefined) {
  if (!result) throw new Error("Hole fixture did not produce every requested result.")
  return result
}

type HoleCase = Readonly<{ id: string; parameters: unknown }>

async function evaluateHoleCases(
  client: GeometryWorkerClient,
  environment: FeatureContentIdentity["environment"],
  cases: readonly HoleCase[],
  boxContentHash: string,
) {
  const results: FeatureResponse[] = []
  for (const { id, parameters } of cases) {
    results.push(await evaluateHoleCase(client, environment, id, parameters, boxContentHash))
  }
  return results
}

async function evaluateRejectedHoleCases(
  client: GeometryWorkerClient,
  environment: FeatureContentIdentity["environment"],
  boxContentHash: string,
  cases: readonly (readonly [string, string, unknown])[],
) {
  const rejected: string[] = []
  for (const [label, id, parameters] of cases) {
    rejected.push(
      await evaluateRejectedHoleCase(client, environment, label, id, parameters, boxContentHash),
    )
  }
  return rejected
}

async function evaluateHoleCase(
  client: GeometryWorkerClient,
  environment: FeatureContentIdentity["environment"],
  id: string,
  parameters: unknown,
  boxContentHash: string,
) {
  const identity = holeIdentity(parameters, boxContentHash, environment)
  const contentHash = await sha256(serializeFeatureContentIdentity(identity))
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "evaluateFeature",
      featureId: id,
      content: identity,
      contentHash,
      dependencies: [{ featureId: boxFeatureId, contentHash: boxContentHash }],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }),
    "featureEvaluated",
  )
}

async function evaluateRejectedHoleCase(
  client: GeometryWorkerClient,
  environment: FeatureContentIdentity["environment"],
  label: string,
  id: string,
  parameters: unknown,
  boxContentHash: string,
) {
  return evaluateHoleCase(client, environment, id, parameters, boxContentHash).then(
    () => {
      throw new Error(`Expected Hole case ${label} to fail.`)
    },
    (error: unknown) => {
      if (error instanceof GeometryWorkerRequestError && error.response?.type === "failure") {
        return `${label}:${error.response.diagnostic.code}`
      }
      throw error
    },
  )
}

async function evaluateEdgeTreatments(client: GeometryWorkerClient, environment: unknown) {
  const registry = featureRegistry()
  const box = {
    schemaVersion: 0 as const,
    id: boxFeatureId,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(20),
      height: createLengthQuantity(20),
      centered: false,
      origin: {
        x: createLengthQuantity(0),
        y: createLengthQuantity(0),
        z: createLengthQuantity(0),
      },
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label: "Fixture box",
  }
  const boxContent = await computeFeatureContentHash(
    registry,
    { feature: box, dependencies: [], environment },
    sha256,
  )
  if (!boxContent.ok) throw new Error(boxContent.diagnostic.message)
  const boxDependency = { featureId: boxFeatureId, contentHash: boxContent.contentHash }

  async function evaluate(kind: "fillet" | "chamfer", featureId: string, size = 1) {
    const type = kind === "fillet" ? filletFeatureType : chamferFeatureType
    const parameters =
      kind === "fillet"
        ? filletFeatureParametersSchema.parse({ radius: createLengthQuantity(size) })
        : chamferFeatureParametersSchema.parse({ distance: createLengthQuantity(size) })
    const feature = {
      ...box,
      id: featureId,
      type: type.type,
      parameters,
      dependencies: [boxFeatureId],
    }
    const content = await computeFeatureContentHash(
      registry,
      { feature, dependencies: [boxDependency], environment },
      sha256,
    )
    if (!content.ok) throw new Error(content.diagnostic.message)
    return expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "evaluateFeature",
        featureId,
        content: featureContentIdentitySchema.parse(content.identity),
        contentHash: content.contentHash,
        dependencies: [boxDependency],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      }),
      "featureEvaluated",
    )
  }

  const boxResult = await evaluateFixtureBox(client, boxContent)
  const fillet = await evaluate("fillet", filletFeatureId)
  const chamfer = await evaluate("chamfer", chamferFeatureId)
  if (
    !(fillet.shape.volume < boxResult.shape.volume && chamfer.shape.volume < boxResult.shape.volume)
  ) {
    throw new Error("Edge treatments must reduce the fixture box volume.")
  }
  const repeated = await repeatEdgeTreatments(client, evaluate)
  return { fillet, chamfer, sourceVolume: boxResult.shape.volume, ...repeated }
}

async function selectedEdgeFixture(client: GeometryWorkerClient, environment: unknown) {
  const registry = featureRegistry()
  const boxContent = await computeFeatureContentHash(
    registry,
    {
      feature: {
        schemaVersion: 0,
        id: boxFeatureId,
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(20),
          depth: createLengthQuantity(20),
          height: createLengthQuantity(20),
          centered: false,
          origin: {
            x: createLengthQuantity(0),
            y: createLengthQuantity(0),
            z: createLengthQuantity(0),
          },
        },
        dependencies: [],
        references: [],
        suppressed: false,
        label: "Fixture box",
      },
      dependencies: [],
      environment,
    },
    sha256,
  )
  if (!boxContent.ok) throw new Error(boxContent.diagnostic.message)
  const boxDependency = { featureId: boxFeatureId, contentHash: boxContent.contentHash }
  const boxResult = await evaluateFixtureBox(client, boxContent)
  const edges = boxResult.topologyCandidates.filter((candidate) => candidate.kind === "edge")
  if (edges.length < 2) throw new Error("Selected-edge fixture requires at least two box edges.")
  return { registry, boxDependency, boxContent, boxResult, edges }
}

function selectedFixtureReferences(selected: FeatureResponse["topologyCandidates"]) {
  return selected.map(({ kind, semanticRole, lineageTokens, signature }) => ({
    schemaVersion: 0 as const,
    kind,
    ...(semanticRole ? { semanticRole } : {}),
    ...(lineageTokens[0] ? { lineageToken: lineageTokens[0] } : {}),
    signature,
    featureId: boxFeatureId,
  }))
}

function selectedTreatmentEvaluator(
  client: GeometryWorkerClient,
  environment: unknown,
  fixture: Awaited<ReturnType<typeof selectedEdgeFixture>>,
) {
  const { registry, boxDependency } = fixture
  return async function evaluate(
    kind: "fillet" | "chamfer",
    id: string,
    selected: FeatureResponse["topologyCandidates"],
    selectedReferences = selectedFixtureReferences(selected),
  ) {
    const type = kind === "fillet" ? filletFeatureTypeV2 : chamferFeatureTypeV2
    const parameters =
      kind === "fillet"
        ? filletFeatureParametersSchema.parse({ radius: createLengthQuantity(1) })
        : chamferFeatureParametersSchema.parse({ distance: createLengthQuantity(1) })
    const feature = {
      schemaVersion: 0 as const,
      id,
      type: type.type,
      parameters,
      dependencies: [boxFeatureId],
      references: selectedReferences,
      suppressed: false,
      label: "Selected edge treatment",
    }
    const content = await computeFeatureContentHash(
      registry,
      { feature, dependencies: [boxDependency], environment },
      sha256,
    )
    if (!content.ok) throw new Error(content.diagnostic.message)
    return expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "evaluateFeature",
        featureId: id,
        content: featureContentIdentitySchema.parse(content.identity),
        contentHash: content.contentHash,
        dependencies: [boxDependency],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      }),
      "featureEvaluated",
    )
  }
}

function requireSemanticFixtureEdge(edges: FeatureResponse["topologyCandidates"], role: string) {
  const edge = edges.find((candidate) => candidate.semanticRole === role)
  if (!edge) throw new Error(`Selected-edge fixture lost semantic edge ${role}.`)
  return edge
}

async function evaluateSelectedEdgeTreatments(client: GeometryWorkerClient, environment: unknown) {
  const fixture = await selectedEdgeFixture(client, environment)
  const { boxContent, boxResult, edges } = fixture
  const semanticEdge = requireSemanticFixtureEdge(edges, "primitive.box.edge.z.x-min.y-min")
  const evaluate = selectedTreatmentEvaluator(client, environment, fixture)
  const [semanticReference] = selectedFixtureReferences([semanticEdge])
  if (!semanticReference) throw new Error("Selected-edge fixture requires an authored reference.")
  const rejected: string[] = []
  for (const [label, invalidReferences, id] of [
    [
      "missing",
      [{ ...semanticReference, semanticRole: "missing.edge" }],
      "0195b5ac-b220-7a2c-8c33-67a36a7f3136",
    ],
    [
      "duplicate",
      [...selectedFixtureReferences([semanticEdge]), ...selectedFixtureReferences([semanticEdge])],
      "0195b5ac-b220-7a2c-8c33-67a36a7f3137",
    ],
  ] as const) {
    try {
      await evaluate("fillet", id, [semanticEdge], [...invalidReferences])
    } catch {
      rejected.push(label)
    }
  }
  const secondEdge = requireSemanticFixtureEdge(edges, "primitive.box.edge.z.x-max.y-max")
  const fillet = await evaluate("fillet", selectedFilletFeatureId, [semanticEdge])
  const chamfer = await evaluate("chamfer", selectedChamferFeatureId, [semanticEdge])
  const twoEdgeFillet = await evaluate("fillet", twoEdgeFilletFeatureId, [semanticEdge, secondEdge])
  const sourceAfter = await evaluateFixtureBox(client, boxContent)
  return {
    fillet,
    chamfer,
    twoEdgeFillet,
    sourceVolume: boxResult.shape.volume,
    sourceVolumeAfter: sourceAfter.shape.volume,
    rejected,
  }
}

type EvaluateEdgeTreatment = (
  kind: "fillet" | "chamfer",
  id: string,
  size?: number,
) => Promise<FeatureResponse>

async function requireInvalidEdgeTreatment(
  evaluate: EvaluateEdgeTreatment,
  kind: "fillet" | "chamfer",
  id: string,
) {
  try {
    await evaluate(kind, id, 100)
  } catch (error) {
    z.object({
      response: z.object({
        type: z.literal("failure"),
        diagnostic: z.object({
          code: z.literal("invalid-feature-geometry"),
        }),
      }),
    }).parse(error)
    return
  }
  throw new Error("Excessive edge treatment unexpectedly succeeded.")
}

async function repeatEdgeTreatments(client: GeometryWorkerClient, evaluate: EvaluateEdgeTreatment) {
  const retainedShapeCounts: number[] = []
  for (let cycle = 0; cycle < 8; cycle += 1) {
    for (const [kind, id] of [
      ["fillet", filletFeatureId],
      ["chamfer", chamferFeatureId],
    ] as const) {
      await requireInvalidEdgeTreatment(evaluate, kind, id)
      await evaluate(kind, id)
    }
    retainedShapeCounts.push((await readHealth(client)).ownedShapeCount)
  }
  return { rejected: ["fillet", "chamfer"], retainedShapeCounts }
}

async function readHealth(client: GeometryWorkerClient) {
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "healthCheck",
    }),
    "health",
  )
}

async function disposeDocument(client: GeometryWorkerClient) {
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "disposeDocument",
    }),
    "documentDisposed",
  )
}

async function runKernelFixture(
  client: GeometryWorkerClient,
  lifecycleIterations: number | null,
  reportProgress: boolean,
) {
  const parameters = createSpikeParameters()
  const result = await client.request(
    {
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "runKernelSpike",
      parameters:
        lifecycleIterations === null ? parameters : { ...parameters, lifecycleIterations },
    },
    reportProgress
      ? {
          onProgress(stage, fraction) {
            state.progress.push(stage)
            statusElement.textContent = `${stage}: ${Math.round(fraction * 100)}%`
          },
        }
      : {},
  )

  return expectResponse(result, "kernelSpikeCompleted")
}

function primaryWorkerClient() {
  const query = new URLSearchParams(window.location.search)
  return query.get("selectedEdgeTreatments") === "true"
    ? new GeometryWorkerClient(new SelectedGeometryWorker())
    : createGeometryWorkerClient()
}

async function evaluateRequestedFixtures(
  client: GeometryWorkerClient,
  environment: FeatureContentIdentity["environment"],
) {
  const query = new URLSearchParams(window.location.search)
  const fixtures = {
    async edgeTreatments() {
      state.edgeTreatments = await evaluateEdgeTreatments(client, environment)
    },
    async selectedEdgeTreatments() {
      state.selectedEdgeTreatments = await evaluateSelectedEdgeTreatments(client, environment)
    },
    async holes() {
      state.holes = await holeFixture(client, environment)
    },
    async bodyOutputs() {
      state.bodyOutputs = await evaluateBodyOutputFixture({
        client,
        environment,
        documentId,
        generation,
        registry: featureRegistry(),
        hash: sha256,
      })
    },
  }
  for (const [queryKey, run] of Object.entries(fixtures)) {
    if (query.get(queryKey) === "true") await run()
  }
}

async function runPrimaryWorker() {
  const client = primaryWorkerClient()

  try {
    const initialized = await initializeEngine(client)
    await evaluateRequestedFixtures(client, initialized.engine.featureContentEnvironment)

    const lifecycleBatches = readPositiveIntegerParameter("lifecycleBatches", 1, 10)

    for (let batch = 0; batch < lifecycleBatches; batch += 1) {
      state.result = await runKernelFixture(client, null, true)
      state.results.push(state.result)
    }

    const beforeTermination = await readHealth(client)
    state.health = beforeTermination
    state.disposal = await disposeDocument(client)
    return beforeTermination
  } finally {
    client.terminate()
  }
}

async function runRestartedWorker(beforeTermination: HealthResponse) {
  const client = createGeometryWorkerClient()

  try {
    await initializeEngine(client)
    const afterInitialization = await readHealth(client)
    const result = await runKernelFixture(client, 1, false)
    const disposal = await disposeDocument(client)

    return { beforeTermination, afterInitialization, result, disposal }
  } finally {
    client.terminate()
  }
}

async function runSpike() {
  try {
    const beforeTermination = await runPrimaryWorker()
    state.restart = await runRestartedWorker(beforeTermination)

    state.state = "passed"
    statusElement.dataset.state = "passed"
    statusElement.textContent = "Geometry worker spike passed."
  } catch (error) {
    state.state = "failed"
    state.error = isError(error) ? error.message : "Unknown geometry spike failure."
    statusElement.dataset.state = "failed"
    statusElement.textContent = state.error
  }
}

void runSpike()
