import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import {
  extrusionFeatureContentParametersSchema,
  type FeatureContentEnvironment,
  featureContentIdentitySchema,
  type GeometryTerminalResponse,
  serializeFeatureContentIdentity,
} from "@vibeshape/protocol"
import { topologySpikeScenarios } from "@vibeshape/test-models"
import { isError } from "is-what"

type TopologyResponse = Extract<GeometryTerminalResponse, { type: "topologySpikeCompleted" }>
type FeatureResponse = Extract<GeometryTerminalResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<GeometryTerminalResponse, { type: "health" }>

interface TopologyScenarioResult {
  name: string
  missingBaselineRoles: string[]
  result: TopologyResponse
}

interface TopologySpikeHarnessState {
  state: "running" | "passed" | "failed"
  currentScenario: string | null
  scenarios: TopologyScenarioResult[]
  featureScenarios: Array<{ name: string; result: FeatureResponse }>
  health: HealthResponse | null
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_TOPOLOGY_SPIKE__: TopologySpikeHarnessState
  }
}

function requireStatusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The topology spike status element is missing.")
  return element
}

function requireResponse<Type extends GeometryTerminalResponse["type"]>(
  response: GeometryTerminalResponse,
  type: Type,
): Extract<GeometryTerminalResponse, { type: Type }> {
  if (response.type !== type) {
    throw new Error(`Expected ${type}, received ${response.type}.`)
  }
  return response as Extract<GeometryTerminalResponse, { type: Type }>
}

const statusElement = requireStatusElement()
const documentId = "topology-spike"
const state: TopologySpikeHarnessState = {
  state: "running",
  currentScenario: null,
  scenarios: [],
  featureScenarios: [],
  health: null,
  error: null,
}
window.__VIBESHAPE_TOPOLOGY_SPIKE__ = state

async function initialize(client: GeometryWorkerClient) {
  const response = await client.request({
    ...createGeometryRequestEnvelope(documentId, 0),
    type: "initializeEngine",
  })
  return requireResponse(response, "initialized").engine.featureContentEnvironment
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

const boxFeatureType = {
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: "org.vibeshape.feature.part-design.box",
  schemaVersion: 1,
} as const

const extrusionFeatureType = {
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: "org.vibeshape.feature.part-design.extrusion",
  schemaVersion: 2,
} as const

const featureIds = {
  box: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  extrusion: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
} as const

const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const pointIds = {
  first: "0195b5ac-b220-7a2c-8c33-67a36a7f3202",
  second: "0195b5ac-b220-7a2c-8c33-67a36a7f3203",
  third: "0195b5ac-b220-7a2c-8c33-67a36a7f3204",
  coincident: "0195b5ac-b220-7a2c-8c33-67a36a7f3205",
} as const
const lineIds = {
  first: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
  second: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
  third: "0195b5ac-b220-7a2c-8c33-67a36a7f3213",
} as const

function extrusionParameters(size: number, distance: number, coincident = false) {
  return extrusionFeatureContentParametersSchema.parse({
    sketchId,
    plane: "xy",
    outer: {
      sourceEntityIds: [lineIds.first, lineIds.second, lineIds.third],
      segments: [
        {
          entityId: lineIds.first,
          type: "line",
          startPointId: pointIds.first,
          endPointId: pointIds.second,
          start: [0, 0],
          end: [size, 0],
        },
        {
          entityId: lineIds.second,
          type: "line",
          startPointId: coincident ? pointIds.coincident : pointIds.second,
          endPointId: pointIds.third,
          start: [size, 0],
          end: [0, size],
        },
        {
          entityId: lineIds.third,
          type: "line",
          startPointId: pointIds.third,
          endPointId: pointIds.first,
          start: [0, size],
          end: [0, 0],
        },
      ],
    },
    holes: [],
    distance,
    symmetric: false,
    operation: "new",
  })
}

async function evaluateFeature(
  client: GeometryWorkerClient,
  generation: number,
  environment: FeatureContentEnvironment,
  scenario: {
    name: string
    featureId: string
    type: typeof boxFeatureType | typeof extrusionFeatureType
    parameters: unknown
  },
) {
  state.currentScenario = scenario.name
  statusElement.textContent = `Running ${scenario.name}…`
  const content = featureContentIdentitySchema.parse({
    schemaVersion: 0 as const,
    feature: {
      schemaVersion: 0 as const,
      type: scenario.type,
      parameters: scenario.parameters,
      inputs: [],
      references: [],
    },
    environment,
  })
  const response = await client.request({
    ...createGeometryRequestEnvelope(documentId, generation),
    type: "evaluateFeature",
    featureId: scenario.featureId,
    content,
    contentHash: await sha256(serializeFeatureContentIdentity(content)),
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  })
  state.featureScenarios.push({
    name: scenario.name,
    result: requireResponse(response, "featureEvaluated"),
  })
}

async function runFeatureScenarios(
  client: GeometryWorkerClient,
  environment: FeatureContentEnvironment,
) {
  const scenarios = [
    {
      name: "box-baseline",
      featureId: featureIds.box,
      type: boxFeatureType,
      parameters: { width: 20, depth: 10, height: 8, centered: false, origin: [0, 0, 0] },
    },
    {
      name: "box-edited",
      featureId: featureIds.box,
      type: boxFeatureType,
      parameters: { width: 40, depth: 30, height: 16, centered: false, origin: [0, 0, 0] },
    },
    {
      name: "extrusion-baseline",
      featureId: featureIds.extrusion,
      type: extrusionFeatureType,
      parameters: extrusionParameters(20, 10),
    },
    {
      name: "extrusion-edited",
      featureId: featureIds.extrusion,
      type: extrusionFeatureType,
      parameters: extrusionParameters(35, 25),
    },
    {
      name: "extrusion-coincident-points",
      featureId: featureIds.extrusion,
      type: extrusionFeatureType,
      parameters: extrusionParameters(20, 10, true),
    },
  ]
  for (const [index, scenario] of scenarios.entries()) {
    await evaluateFeature(client, topologySpikeScenarios.length + index + 1, environment, scenario)
  }
}

async function runScenarios(client: GeometryWorkerClient) {
  for (const [index, scenario] of topologySpikeScenarios.entries()) {
    state.currentScenario = scenario.name
    statusElement.textContent = `Running ${scenario.name}…`
    const response = await client.request({
      ...createGeometryRequestEnvelope(documentId, index + 1),
      type: "runTopologySpike",
      parameters: scenario.parameters,
    })
    state.scenarios.push({
      name: scenario.name,
      missingBaselineRoles: scenario.missingBaselineRoles,
      result: requireResponse(response, "topologySpikeCompleted"),
    })
  }
}

async function runSpike() {
  const client = createGeometryWorkerClient()
  try {
    const environment = await initialize(client)
    await runScenarios(client)
    await runFeatureScenarios(client, environment)
    state.health = requireResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, topologySpikeScenarios.length + 1),
        type: "healthCheck",
      }),
      "health",
    )
    await client.request({
      ...createGeometryRequestEnvelope(documentId, topologySpikeScenarios.length + 1),
      type: "disposeDocument",
    })
    state.currentScenario = null
    state.state = "passed"
    statusElement.dataset.state = "passed"
    statusElement.textContent = "Topology reference corpus completed."
  } catch (error) {
    state.state = "failed"
    state.error = isError(error) ? error.message : String(error)
    statusElement.dataset.state = "failed"
    statusElement.textContent = state.error
  } finally {
    client.terminate()
  }
}

void runSpike()
